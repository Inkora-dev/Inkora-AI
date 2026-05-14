import { readFile, readdir, writeFile, mkdir } from "fs/promises"
import path from "path"
import { exec } from "child_process"
import { promisify } from "util"
import { retrieveContext } from "./rag"
import { astSymbols, astFindDefinition } from "./ast"
import { bus } from "./bus"
import { log } from "./logger"

const execAsync = promisify(exec)

// Compose user abort signal with a per-call ms timeout (Node 18 compatible)
function withTimeout(signal: AbortSignal, ms: number): { signal: AbortSignal; clear: () => void } {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new DOMException(`Timeout après ${ms / 1000}s`, "TimeoutError")), ms)
    const onAbort = () => ctrl.abort(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
    const clear = () => {
        clearTimeout(timer)
        signal.removeEventListener("abort", onAbort)
    }
    return { signal: ctrl.signal, clear }
}

// ─── Event types (streamed to frontend as NDJSON) ─────────────────────────────

export type AgentEvent =
    | { type: "stream_chunk"; chunk: string }                          // token as it arrives
    | { type: "stream_commit"; as: "thought" | "answer"; text: string } // end of one Ollama call
    | { type: "tool_call"; name: string; args: Record<string, unknown> }
    | { type: "tool_result"; name: string; content: string; isError?: boolean }
    | { type: "error"; content: string }
    | { type: "done" }

// ─── Ollama message types ─────────────────────────────────────────────────────

interface OllamaToolCall {
    function: { name: string; arguments: Record<string, unknown> }
}

interface OllamaMessage {
    role: "system" | "user" | "assistant" | "tool"
    content: string
    tool_calls?: OllamaToolCall[]
}

// ─── Tool definitions (Ollama / OpenAI format) ────────────────────────────────

const TOOL_DEFINITIONS = [
    {
        type: "function",
        function: {
            name: "read_file",
            description: "Read the content of a file. Truncated to 200 lines for large files.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Absolute or relative path to the file" },
                },
                required: ["path"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "Write or overwrite a file with the given content. Creates parent directories if needed. Path must be inside the working directory.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path to the file to write (relative to working dir)" },
                    content: { type: "string", description: "Full content to write to the file" },
                },
                required: ["path", "content"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "list_dir",
            description: "List files and subdirectories. Skips node_modules, .git, dist, build.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path to the directory to list" },
                },
                required: ["path"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "search_code",
            description: "Search for a regex pattern recursively across source files.",
            parameters: {
                type: "object",
                properties: {
                    pattern: { type: "string", description: "Regex pattern to search for" },
                    dir: { type: "string", description: "Directory to search in (optional, defaults to working dir)" },
                },
                required: ["pattern"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "git_run",
            description: "Run a safe git command. Allowed subcommands: status, diff, log, show, branch, add, commit, stash, restore, tag, shortlog. Destructive flags (--hard, --force, -D) are blocked.",
            parameters: {
                type: "object",
                properties: {
                    args: { type: "string", description: "Git arguments (e.g. 'status', 'diff HEAD~1', 'log --oneline -10')" },
                },
                required: ["args"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "shell_run",
            description: "Run a whitelisted shell command (bash on Linux, cmd on Windows). Useful for npm, node, python, pytest, grep, find, df, ps, etc. Destructive commands (rm, sudo, dd) are blocked.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "The shell command to run" },
                },
                required: ["command"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "ast_symbols",
            description: "List all top-level symbols (functions, classes, interfaces, types, constants) in a source file with their line numbers. Much more precise than search_code for understanding file structure.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path to the source file (.ts, .tsx, .js, .py, .go, .rs)" },
                },
                required: ["path"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "ast_find_symbol",
            description: "Find where a symbol (function, class, type, interface) is defined across the project. Returns file paths and line numbers.",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Exact name of the symbol to find (e.g. 'handleRun', 'ChatPage', 'Message')" },
                    dir:  { type: "string", description: "Directory to search in (optional, defaults to working dir)" },
                },
                required: ["name"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "rag_search",
            description: "Search through RAG-indexed documents using semantic similarity. Use this when the user has uploaded documents and wants to query their content.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Natural language query to search for in indexed documents" },
                },
                required: ["query"],
            },
        },
    },
]

// ─── Security helpers ─────────────────────────────────────────────────────────

const SYSTEM_DIRS = ["/etc", "/sys", "/proc", "/usr/bin", "/usr/sbin", "/bin", "/sbin", "/boot", "/dev"]
const HOME_BLOCKED = [".ssh", ".bashrc", ".profile", ".zshrc", ".bash_profile", ".bash_logout", ".gnupg"]

export function validateWritePath(filePath: string, workDir: string): { safe: boolean; resolved: string; error?: string } {
    const base = path.resolve(workDir || process.cwd())
    const resolved = path.resolve(base, filePath)

    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
        return { safe: false, resolved, error: `Chemin hors du répertoire de travail (${base}). Utilisez des chemins relatifs.` }
    }
    if (SYSTEM_DIRS.some((d) => resolved.startsWith(d))) {
        return { safe: false, resolved, error: `Écriture dans un répertoire système refusée: ${resolved}` }
    }
    const home = process.env.HOME ?? ""
    if (home) {
        const rel = path.relative(home, resolved)
        if (!rel.startsWith("..") && HOME_BLOCKED.some((b) => rel === b || rel.startsWith(b + path.sep))) {
            return { safe: false, resolved, error: `Écriture dans ${filePath} refusée (fichier de configuration sensible).` }
        }
    }
    return { safe: true, resolved }
}

const GIT_ALLOWED = new Set(["status", "diff", "log", "show", "branch", "add", "commit", "stash", "restore", "tag", "shortlog", "describe"])
const GIT_BLOCKED_FLAGS = new Set(["--force", "-f", "--hard", "-D", "--delete", "--no-verify"])

const SHELL_ALLOWED = new Set([
    "ls", "find", "grep", "rg", "cat", "head", "tail", "wc", "sort", "uniq", "awk", "sed",
    "diff", "which", "pwd", "echo", "env", "date", "df", "du", "ps", "free", "lscpu", "uname",
    "node", "npm", "npx", "yarn", "pnpm",
    "python", "python3", "pip", "pip3", "pytest", "uvicorn",
    "cargo", "rustc", "go", "golangci-lint",
    "tsc", "eslint", "prettier",
    "jq", "curl", "wget",
    "make", "cmake", "ninja",
    "systemctl", "journalctl", "docker", "docker-compose",
])

const SHELL_BLOCKED_RE = [
    /\brm\s+-[rf]/, /\brm\s+\//, /\bsudo\b/, /\bsu\b\s/, /\bmkfs\b/, /\bshred\b/,
    /\bdd\b.*of=/, /:\(\)\s*\{.*:\|:.*\}/,
    /\bchmod\s+[0-7]{3,4}\s+\//, /\bmv\s+\S+\s+\/(?:etc|bin|usr|sys|proc)/,
]

const EXEC_SHELL: string = process.platform === "win32" ? "cmd.exe" : "/bin/bash"

// ─── Tool implementations ─────────────────────────────────────────────────────

type ToolResult = { content: string; isError?: boolean }
type ToolArgs = Record<string, unknown>

function str(v: unknown): string { return typeof v === "string" ? v : String(v ?? "") }

// Ollama sometimes returns tool call arguments as a JSON string instead of an object
function normalizeArgs(args: unknown): Record<string, unknown> {
    if (typeof args === "string") {
        try { return JSON.parse(args) as Record<string, unknown> } catch { return { value: args } }
    }
    if (args !== null && typeof args === "object" && !Array.isArray(args)) {
        return args as Record<string, unknown>
    }
    return {}
}

async function readFileTool(args: ToolArgs): Promise<ToolResult> {
    const filePath = str(args.path)
    if (!filePath) return { content: "Argument 'path' manquant.", isError: true }
    try {
        const content = await readFile(filePath, "utf-8")
        const lines = content.split("\n")
        const preview = lines.length > 200
            ? [...lines.slice(0, 200), `\n... (${lines.length - 200} lignes supplémentaires)`].join("\n")
            : content
        return { content: preview }
    } catch (err) {
        return { content: String(err), isError: true }
    }
}

async function writeFileTool(args: ToolArgs, workDir: string): Promise<ToolResult> {
    const filePath = str(args.path)
    const content = str(args.content)
    if (!filePath) return { content: "Argument 'path' manquant.", isError: true }

    const check = validateWritePath(filePath, workDir)
    if (!check.safe) return { content: check.error!, isError: true }

    try {
        await mkdir(path.dirname(check.resolved), { recursive: true })
        await writeFile(check.resolved, content, "utf-8")
        return { content: `Fichier écrit: ${check.resolved} (${content.split("\n").length} lignes, ${content.length} octets)` }
    } catch (err) {
        return { content: String(err), isError: true }
    }
}

async function listDirTool(args: ToolArgs): Promise<ToolResult> {
    const dirPath = str(args.path) || "."
    const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv"])
    const entries = await readdir(dirPath, { withFileTypes: true }).catch((err) => String(err))
    if (typeof entries === "string") return { content: entries, isError: true }
    const lines = entries
        .filter((e) => !e.name.startsWith(".") && !SKIP.has(e.name))
        .map((e) => `${e.isDirectory() ? "[dir] " : "      "}${e.name}`)
    return { content: lines.join("\n") || "(répertoire vide)" }
}

async function searchCodeTool(args: ToolArgs, workDir: string): Promise<ToolResult> {
    const pattern = str(args.pattern)
    if (!pattern) return { content: "Argument 'pattern' manquant.", isError: true }
    const dir = str(args.dir) || workDir || "."
    const results: string[] = []
    const EXT = /\.(ts|tsx|js|jsx|py|go|rs|md|json|yaml|yml|toml|html|css|sql|sh|txt)$/
    const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv"])

    async function walk(currentDir: string, depth: number): Promise<void> {
        if (depth > 6 || results.length >= 60) return
        const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => null)
        if (!entries) return
        for (const entry of entries) {
            if (entry.name.startsWith(".") || SKIP.has(entry.name) || entry.isSymbolicLink()) continue
            const fullPath = path.join(currentDir, entry.name)
            if (entry.isDirectory()) {
                await walk(fullPath, depth + 1)
            } else if (EXT.test(entry.name)) {
                const content = await readFile(fullPath, "utf-8").catch(() => "")
                let regex: RegExp
                try { regex = new RegExp(pattern, "i") } catch { return }
                content.split("\n").forEach((line, idx) => {
                    if (regex.test(line) && results.length < 60) {
                        results.push(`${fullPath}:${idx + 1}: ${line.trim()}`)
                    }
                })
            }
        }
    }

    await walk(path.resolve(dir), 0)
    return { content: results.length > 0 ? results.join("\n") : "Aucun résultat." }
}

async function gitRunTool(args: ToolArgs, workDir: string): Promise<ToolResult> {
    const rawArgs = str(args.args).trim()
    if (!rawArgs) return { content: "Arguments git manquants.", isError: true }

    const parts = rawArgs.split(/\s+/)
    const subcommand = parts[0].toLowerCase()

    if (!GIT_ALLOWED.has(subcommand)) {
        return { content: `Sous-commande git "${subcommand}" non autorisée. Autorisées: ${[...GIT_ALLOWED].join(", ")}`, isError: true }
    }
    const blockedFlag = parts.find((p) => GIT_BLOCKED_FLAGS.has(p))
    if (blockedFlag) {
        return { content: `Flag "${blockedFlag}" non autorisé.`, isError: true }
    }

    try {
        const cwd = workDir || process.cwd()
        const { stdout, stderr } = await execAsync(`git ${rawArgs}`, { cwd, timeout: 15_000 })
        const output = [stdout, stderr ? `stderr: ${stderr}` : ""].filter(Boolean).join("\n").trim()
        return { content: output || "(aucune sortie)" }
    } catch (err) {
        return { content: String(err), isError: true }
    }
}

async function shellRunTool(args: ToolArgs, workDir: string): Promise<ToolResult> {
    const command = str(args.command).trim()
    if (!command) return { content: "Commande manquante.", isError: true }

    for (const re of SHELL_BLOCKED_RE) {
        if (re.test(command)) {
            return { content: `Commande bloquée par la politique de sécurité (pattern: ${re.source}).`, isError: true }
        }
    }
    const firstWord = command.replace(/^(?:\w+=\S+\s+)+/, "").split(/[\s/]+/)[0]
    if (!SHELL_ALLOWED.has(firstWord)) {
        return { content: `Commande "${firstWord}" non autorisée. Autorisées: ${[...SHELL_ALLOWED].join(", ")}`, isError: true }
    }

    try {
        const cwd = workDir || process.cwd()
        const { stdout, stderr } = await execAsync(command, {
            cwd, timeout: 30_000, shell: EXEC_SHELL,
            env: { ...process.env, FORCE_COLOR: "0" },
        })
        const output = [stdout, stderr ? `stderr: ${stderr}` : ""].filter(Boolean).join("\n").trim()
        return { content: output.slice(0, 10_000) || "(aucune sortie)" }
    } catch (err) {
        return { content: (err instanceof Error ? err.message : String(err)).slice(0, 4_000), isError: true }
    }
}

async function astSymbolsTool(args: ToolArgs): Promise<ToolResult> {
    const filePath = str(args.path)
    if (!filePath) return { content: "Argument 'path' manquant.", isError: true }
    try {
        return { content: await astSymbols(filePath) }
    } catch (err) {
        return { content: String(err), isError: true }
    }
}

async function astFindSymbolTool(args: ToolArgs, workDir: string): Promise<ToolResult> {
    const name = str(args.name)
    if (!name) return { content: "Argument 'name' manquant.", isError: true }
    const dir = str(args.dir) || workDir || "."
    try {
        return { content: await astFindDefinition(name, dir) }
    } catch (err) {
        return { content: String(err), isError: true }
    }
}

async function ragSearchTool(args: ToolArgs, ollamaUrl: string): Promise<ToolResult> {
    const query = str(args.query)
    if (!query) return { content: "Argument 'query' manquant.", isError: true }
    try {
        const context = await retrieveContext(query, ollamaUrl)
        return { content: context || "Aucun document pertinent trouvé dans le store RAG. Vérifiez que des documents ont été indexés." }
    } catch (err) {
        return { content: String(err), isError: true }
    }
}

function createTools(workDir: string, ollamaUrl: string): Record<string, (args: ToolArgs) => Promise<ToolResult>> {
    return {
        read_file:       (args) => readFileTool(args),
        write_file:      (args) => writeFileTool(args, workDir),
        list_dir:        (args) => listDirTool(args),
        search_code:     (args) => searchCodeTool(args, workDir),
        ast_symbols:     (args) => astSymbolsTool(args),
        ast_find_symbol: (args) => astFindSymbolTool(args, workDir),
        git_run:         (args) => gitRunTool(args, workDir),
        shell_run:       (args) => shellRunTool(args, workDir),
        rag_search:      (args) => ragSearchTool(args, ollamaUrl),
    }
}

// ─── Ollama streaming call ────────────────────────────────────────────────────

type StreamItem = { text: string } | { finalMessage: OllamaMessage }

async function* streamOllama(
    messages: OllamaMessage[],
    ollamaUrl: string,
    model: string,
    signal: AbortSignal
): AsyncGenerator<StreamItem> {
    const { signal: timedSignal, clear } = withTimeout(signal, 90_000)

    function parseLine(line: string): { text?: string; toolCalls?: OllamaToolCall[] } | null {
        if (!line.trim()) return null
        try {
            const json = JSON.parse(line) as { message?: OllamaMessage; done?: boolean }
            const chunk = json.message?.content ?? ""
            const toolCalls = json.message?.tool_calls?.length ? json.message.tool_calls : undefined
            return { text: chunk || undefined, toolCalls }
        } catch { return null }
    }

    try {
        const r = await fetch(`${ollamaUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, messages, tools: TOOL_DEFINITIONS, stream: true }),
            signal: timedSignal,
        })
        if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text().catch(() => "")}`)
        if (!r.body) throw new Error("Ollama n'a pas renvoyé de stream")

        const reader = r.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let accContent = ""
        let finalToolCalls: OllamaToolCall[] | undefined

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) {
                const parsed = parseLine(line)
                if (!parsed) continue
                if (parsed.text) { accContent += parsed.text; yield { text: parsed.text } }
                if (parsed.toolCalls) finalToolCalls = parsed.toolCalls
            }
        }
        buffer += decoder.decode()
        const last = parseLine(buffer)
        if (last?.text) { accContent += last.text; yield { text: last.text } }
        if (last?.toolCalls) finalToolCalls = last.toolCalls

        yield { finalMessage: { role: "assistant", content: accContent, tool_calls: finalToolCalls } }
    } finally {
        clear()
    }
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un assistant expert en développement logiciel avec accès à des outils puissants.

Outils disponibles:
- read_file / write_file : lire et écrire des fichiers du projet
- list_dir : explorer la structure du projet
- search_code : chercher des patterns dans le code source
- rag_search : recherche sémantique dans les documents indexés par l'utilisateur
- git_run : commandes git (status, diff, log, add, commit…)
- shell_run : commandes shell whitelistées (npm, python, grep, find, systemctl…)

Stratégie:
1. Explorer avec list_dir pour comprendre la structure
2. Lire les fichiers pertinents avec read_file
3. Chercher des patterns avec search_code si nécessaire
4. Utiliser rag_search si l'utilisateur a mentionné des documents ou une base de connaissances
5. Effectuer les modifications avec write_file
6. Vérifier avec git_run status ou shell_run (tests, lint)

Réponds toujours en français avec une réponse complète et structurée.`

// ─── ReAct loop ───────────────────────────────────────────────────────────────

export async function* runAgent(
    task: string,
    ollamaUrl: string,
    model: string,
    workDir: string,
    signal: AbortSignal,
    maxIterations = 15
): AsyncGenerator<AgentEvent> {
    const tools = createTools(workDir, ollamaUrl)
    const systemContent = SYSTEM_PROMPT + (workDir ? `\n\nRépertoire de travail: ${workDir}` : "")

    const messages: OllamaMessage[] = [
        { role: "system", content: systemContent },
        { role: "user", content: task },
    ]

    const runId = crypto.randomUUID()
    log.agent.info({ runId, model, workDir, task: task.slice(0, 120) }, "agent started")
    const startTs = Date.now()
    const recentFingerprints: string[] = []
    let iterCount = 0
    bus.emit("agent:start", { runId, task, model, workDir })

    for (let i = 0; i < maxIterations; i++) {
        if (signal.aborted) break

        let response: OllamaMessage | undefined

        try {
            for await (const item of streamOllama(messages, ollamaUrl, model, signal)) {
                if ("text" in item) {
                    yield { type: "stream_chunk", chunk: item.text }
                } else {
                    response = item.finalMessage
                }
            }
        } catch (err) {
            const isAbort = (err as Error).name === "AbortError" || (err as DOMException).name === "TimeoutError"
            if (isAbort && signal.aborted) break
            const msg = err instanceof Error ? err.message : String(err)
            log.agent.error({ runId, err: msg, iteration: i }, "stream error")
            bus.emit("agent:error", { runId, error: msg })
            yield { type: "error", content: isAbort ? "Ollama n'a pas répondu dans les temps (90s). Vérifie que le modèle est chargé." : msg }
            break
        }

        iterCount++

        if (!response) break
        messages.push(response)

        if (response.tool_calls?.length) {
            // Commit any streamed reasoning as a "thought" bubble
            yield { type: "stream_commit", as: "thought", text: response.content?.trim() ?? "" }

            for (const toolCall of response.tool_calls) {
                const { name, arguments: rawArgs } = toolCall.function
                const args = normalizeArgs(rawArgs)
                const fingerprint = `${name}::${JSON.stringify(args)}`
                const repeatCount = recentFingerprints.filter((f) => f === fingerprint).length
                if (repeatCount >= 2) {
                    yield { type: "error", content: `Boucle détectée : l'outil "${name}" a été appelé 3 fois avec les mêmes arguments. Tâche incomplète — essaie de reformuler.` }
                    return
                }
                recentFingerprints.push(fingerprint)
                if (recentFingerprints.length > 10) recentFingerprints.shift()

                yield { type: "tool_call", name, args }

                const toolFn = tools[name]
                const result: ToolResult = toolFn
                    ? await toolFn(args)
                    : { content: `Outil inconnu: "${name}". Disponibles: ${Object.keys(tools).join(", ")}`, isError: true }

                yield { type: "tool_result", name, content: result.content, isError: result.isError }
                messages.push({ role: "tool", content: result.content })
            }
        } else {
            // No tool calls → final answer (already streamed token by token)
            yield { type: "stream_commit", as: "answer", text: response.content?.trim() ?? "" }
            break
        }

        if (i === maxIterations - 1) {
            yield { type: "error", content: `Limite de ${maxIterations} itérations atteinte. La tâche peut être incomplète — relance avec une tâche plus ciblée.` }
        }
    }

    const durationMs = Date.now() - startTs
    log.agent.info({ runId, durationMs, iterCount }, "agent done")
    bus.emit("agent:done", { runId, durationMs, iterations: iterCount })
    yield { type: "done" }
}
