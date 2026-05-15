import { readFile, readdir, writeFile, mkdir } from "fs/promises"
import path from "path"
import { exec } from "child_process"
import { promisify } from "util"
import { retrieveContext } from "./rag"
import { astSymbols, astFindDefinition } from "./ast"
import { runAgentWithTools, str, type AgentEvent, type ToolArgs, type ToolResult } from "./agent-core"

export type { AgentEvent }

const execAsync = promisify(exec)

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
            description: "List all top-level symbols (functions, classes, interfaces, types, constants) in a source file with their line numbers.",
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
                    name: { type: "string", description: "Exact name of the symbol to find" },
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
            description: "Search through RAG-indexed documents using semantic similarity.",
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

async function readFileTool(args: ToolArgs, workDir: string): Promise<ToolResult> {
    const filePath = str(args.path)
    if (!filePath) return { content: "Argument 'path' manquant.", isError: true }
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(workDir || process.cwd(), filePath)
    try {
        const content = await readFile(resolved, "utf-8")
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

async function listDirTool(args: ToolArgs, workDir: string): Promise<ToolResult> {
    const dirPath = str(args.path) || workDir || "."
    const resolved = path.isAbsolute(dirPath) ? dirPath : path.resolve(workDir || process.cwd(), dirPath)
    const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv"])
    const entries = await readdir(resolved, { withFileTypes: true }).catch((err) => String(err))
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

async function astSymbolsTool(args: ToolArgs, workDir: string): Promise<ToolResult> {
    const filePath = str(args.path)
    if (!filePath) return { content: "Argument 'path' manquant.", isError: true }
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(workDir || process.cwd(), filePath)
    try {
        return { content: await astSymbols(resolved) }
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

// ─── Public API ───────────────────────────────────────────────────────────────

export async function* runAgent(
    task: string,
    ollamaUrl: string,
    model: string,
    workDir: string,
    signal: AbortSignal,
    maxIterations = 15
): AsyncGenerator<AgentEvent> {
    const systemContent = SYSTEM_PROMPT + (workDir ? `\n\nRépertoire de travail: ${workDir}` : "")

    const tools: Record<string, (args: ToolArgs) => Promise<ToolResult>> = {
        read_file:       (args) => readFileTool(args, workDir),
        write_file:      (args) => writeFileTool(args, workDir),
        list_dir:        (args) => listDirTool(args, workDir),
        search_code:     (args) => searchCodeTool(args, workDir),
        ast_symbols:     (args) => astSymbolsTool(args, workDir),
        ast_find_symbol: (args) => astFindSymbolTool(args, workDir),
        git_run:         (args) => gitRunTool(args, workDir),
        shell_run:       (args) => shellRunTool(args, workDir),
        rag_search:      (args) => ragSearchTool(args, ollamaUrl),
    }

    yield* runAgentWithTools(task, ollamaUrl, model, signal, systemContent, TOOL_DEFINITIONS, tools, "coding", maxIterations)
}
