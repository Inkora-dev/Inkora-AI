import { exec } from "child_process"
import { promisify } from "util"
import { runAgentWithTools, str, type AgentEvent, type ToolArgs, type ToolResult } from "./agent-core"

export type { AgentEvent }

const execAsync = promisify(exec)

// ─── Config from env ──────────────────────────────────────────────────────────

// Comma-separated container names allowed for mutating ops (restart/stop/start).
// Empty string = block all mutating ops until configured.
function getAllowedContainers(): Set<string> {
    const raw = process.env.AUTOMATION_ALLOWED_CONTAINERS ?? ""
    return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))
}

// Comma-separated hostnames/IPs allowed for http_request.
// Defaults to localhost only.
function getAllowedHosts(): Set<string> {
    const raw = process.env.AUTOMATION_ALLOWED_HOSTS ?? "localhost,127.0.0.1"
    return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
    {
        type: "function",
        function: {
            name: "docker_ps",
            description: "List all Docker containers (running and stopped) with their status, image, and ports.",
            parameters: { type: "object", properties: {}, required: [] },
        },
    },
    {
        type: "function",
        function: {
            name: "docker_logs",
            description: "Get the last N log lines of a Docker container.",
            parameters: {
                type: "object",
                properties: {
                    container: { type: "string", description: "Container name or ID" },
                    lines: { type: "number", description: "Number of lines to retrieve (default: 50, max: 200)" },
                },
                required: ["container"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "docker_stats",
            description: "Get resource usage (CPU, memory, network) for all running containers.",
            parameters: { type: "object", properties: {}, required: [] },
        },
    },
    {
        type: "function",
        function: {
            name: "docker_inspect",
            description: "Inspect a Docker container or image: get config, mounts, environment variables, network settings.",
            parameters: {
                type: "object",
                properties: {
                    target: { type: "string", description: "Container or image name/ID to inspect" },
                },
                required: ["target"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "docker_restart",
            description: "Restart a Docker container. Container must be in the allowed list (AUTOMATION_ALLOWED_CONTAINERS).",
            parameters: {
                type: "object",
                properties: {
                    container: { type: "string", description: "Container name or ID to restart" },
                },
                required: ["container"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "docker_stop",
            description: "Stop a running Docker container. Container must be in the allowed list (AUTOMATION_ALLOWED_CONTAINERS).",
            parameters: {
                type: "object",
                properties: {
                    container: { type: "string", description: "Container name or ID to stop" },
                },
                required: ["container"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "docker_start",
            description: "Start a stopped Docker container. Container must be in the allowed list (AUTOMATION_ALLOWED_CONTAINERS).",
            parameters: {
                type: "object",
                properties: {
                    container: { type: "string", description: "Container name or ID to start" },
                },
                required: ["container"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "http_request",
            description: "Make an HTTP GET or POST request to an internal service (Home Assistant, webhooks, local APIs). Only allowed hosts are reachable.",
            parameters: {
                type: "object",
                properties: {
                    method: { type: "string", description: "HTTP method: GET or POST" },
                    url: { type: "string", description: "Full URL to call (e.g. http://homeassistant.local:8123/api/states)" },
                    headers: { type: "object", description: "Optional HTTP headers as key-value pairs" },
                    body: { type: "string", description: "Optional request body (JSON string) for POST requests" },
                },
                required: ["method", "url"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "system_info",
            description: "Get system information: disk usage, memory, running processes, uptime.",
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "One of: df (disk), free (memory), ps (processes), uptime, uname",
                    },
                },
                required: ["command"],
            },
        },
    },
]

// ─── Tool implementations ─────────────────────────────────────────────────────

async function dockerExec(args: string, timeoutMs = 15_000): Promise<ToolResult> {
    try {
        const { stdout, stderr } = await execAsync(`docker ${args}`, { timeout: timeoutMs })
        const output = [stdout, stderr ? `stderr: ${stderr}` : ""].filter(Boolean).join("\n").trim()
        return { content: output.slice(0, 8_000) || "(aucune sortie)" }
    } catch (err) {
        return { content: (err instanceof Error ? err.message : String(err)).slice(0, 3_000), isError: true }
    }
}

function checkContainerAllowed(container: string): ToolResult | null {
    const allowed = getAllowedContainers()
    if (allowed.size === 0) {
        return {
            content: "Aucun conteneur autorisé pour les opérations mutantes. Configurez AUTOMATION_ALLOWED_CONTAINERS dans .env (ex: nginx,postgres,homeassistant).",
            isError: true,
        }
    }
    if (!allowed.has(container)) {
        return {
            content: `Conteneur "${container}" non autorisé. Conteneurs autorisés: ${[...allowed].join(", ")}. Modifiez AUTOMATION_ALLOWED_CONTAINERS dans .env pour l'ajouter.`,
            isError: true,
        }
    }
    return null
}

// Sanitize container name: only allow alphanumeric, dash, underscore, dot
function sanitizeContainerName(name: string): string | null {
    return /^[a-zA-Z0-9_.\-]+$/.test(name) ? name : null
}

async function dockerPsTool(): Promise<ToolResult> {
    return dockerExec(`ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}"`)
}

async function dockerLogsTool(args: ToolArgs): Promise<ToolResult> {
    const container = sanitizeContainerName(str(args.container))
    if (!container) return { content: "Nom de conteneur invalide.", isError: true }
    const lines = Math.min(Number(args.lines) || 50, 200)
    return dockerExec(`logs --tail ${lines} ${container}`, 20_000)
}

async function dockerStatsTool(): Promise<ToolResult> {
    return dockerExec(`stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"`)
}

async function dockerInspectTool(args: ToolArgs): Promise<ToolResult> {
    const target = sanitizeContainerName(str(args.target))
    if (!target) return { content: "Nom de cible invalide.", isError: true }
    const result = await dockerExec(`inspect ${target}`)
    if (result.isError) return result
    // Truncate large inspect output to key fields
    try {
        const data = JSON.parse(result.content) as object[]
        const summary = data.map((item: Record<string, unknown>) => ({
            Name: item["Name"],
            State: item["State"],
            Config: {
                Image: (item["Config"] as Record<string, unknown>)?.["Image"],
                Env: (item["Config"] as Record<string, unknown>)?.["Env"],
            },
            Mounts: item["Mounts"],
            NetworkSettings: {
                Ports: (item["NetworkSettings"] as Record<string, unknown>)?.["Ports"],
                Networks: Object.keys((item["NetworkSettings"] as Record<string, unknown>)?.["Networks"] as object ?? {}),
            },
        }))
        return { content: JSON.stringify(summary, null, 2).slice(0, 8_000) }
    } catch {
        return result
    }
}

async function dockerRestartTool(args: ToolArgs): Promise<ToolResult> {
    const container = sanitizeContainerName(str(args.container))
    if (!container) return { content: "Nom de conteneur invalide.", isError: true }
    const check = checkContainerAllowed(container)
    if (check) return check
    const result = await dockerExec(`restart ${container}`, 30_000)
    if (!result.isError) return { content: `Conteneur "${container}" redémarré avec succès.` }
    return result
}

async function dockerStopTool(args: ToolArgs): Promise<ToolResult> {
    const container = sanitizeContainerName(str(args.container))
    if (!container) return { content: "Nom de conteneur invalide.", isError: true }
    const check = checkContainerAllowed(container)
    if (check) return check
    const result = await dockerExec(`stop ${container}`, 30_000)
    if (!result.isError) return { content: `Conteneur "${container}" arrêté.` }
    return result
}

async function dockerStartTool(args: ToolArgs): Promise<ToolResult> {
    const container = sanitizeContainerName(str(args.container))
    if (!container) return { content: "Nom de conteneur invalide.", isError: true }
    const check = checkContainerAllowed(container)
    if (check) return check
    const result = await dockerExec(`start ${container}`, 30_000)
    if (!result.isError) return { content: `Conteneur "${container}" démarré.` }
    return result
}

async function httpRequestTool(args: ToolArgs): Promise<ToolResult> {
    const method = str(args.method).toUpperCase()
    const urlStr = str(args.url)

    if (!["GET", "POST", "PUT", "PATCH"].includes(method)) {
        return { content: `Méthode HTTP "${method}" non autorisée. Autorisées: GET, POST, PUT, PATCH.`, isError: true }
    }

    let parsed: URL
    try {
        parsed = new URL(urlStr)
    } catch {
        return { content: `URL invalide: ${urlStr}`, isError: true }
    }

    const allowed = getAllowedHosts()
    const hostname = parsed.hostname
    if (!allowed.has(hostname)) {
        return {
            content: `Hôte "${hostname}" non autorisé. Hôtes autorisés: ${[...allowed].join(", ")}. Ajoutez-le à AUTOMATION_ALLOWED_HOSTS dans .env.`,
            isError: true,
        }
    }

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "Inkora-Automation/1.0",
    }
    if (args.headers && typeof args.headers === "object" && !Array.isArray(args.headers)) {
        for (const [k, v] of Object.entries(args.headers as Record<string, unknown>)) {
            if (typeof k === "string" && typeof v === "string") headers[k] = v
        }
    }

    try {
        const fetchOpts: RequestInit = {
            method,
            headers,
            signal: AbortSignal.timeout(15_000),
        }
        if (args.body && typeof args.body === "string" && method !== "GET") {
            fetchOpts.body = args.body
        }

        const r = await fetch(urlStr, fetchOpts)
        const text = await r.text()
        const status = `HTTP ${r.status} ${r.statusText}`

        // Pretty-print if JSON
        let body = text.slice(0, 6_000)
        try { body = JSON.stringify(JSON.parse(text), null, 2).slice(0, 6_000) } catch { /* not JSON */ }

        return { content: `${status}\n\n${body}`, isError: !r.ok }
    } catch (err) {
        return { content: String(err), isError: true }
    }
}

const SYSTEM_INFO_ALLOWED = new Set(["df", "free", "ps", "uptime", "uname"])

async function systemInfoTool(args: ToolArgs): Promise<ToolResult> {
    const command = str(args.command).trim().split(/\s+/)[0]
    if (!SYSTEM_INFO_ALLOWED.has(command)) {
        return { content: `Commande "${command}" non autorisée. Autorisées: ${[...SYSTEM_INFO_ALLOWED].join(", ")}`, isError: true }
    }

    const fullCommand: Record<string, string> = {
        df: "df -h",
        free: "free -h",
        ps: "ps aux --sort=-%cpu | head -20",
        uptime: "uptime",
        uname: "uname -a",
    }

    try {
        const { stdout } = await execAsync(fullCommand[command] ?? command, { timeout: 8_000 })
        return { content: stdout.trim().slice(0, 4_000) || "(aucune sortie)" }
    } catch (err) {
        return { content: String(err), isError: true }
    }
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Tu es un assistant expert en homelab et infrastructure. Tu gères des conteneurs Docker, interroges des services internes et diagnostiques des problèmes système.

Outils disponibles:
- docker_ps : lister tous les conteneurs (état, image, ports)
- docker_logs : lire les logs d'un conteneur (dernières N lignes)
- docker_stats : utilisation CPU/mémoire/réseau de tous les conteneurs actifs
- docker_inspect : inspecter la config, les montages et les variables d'environnement d'un conteneur
- docker_restart / docker_stop / docker_start : gérer les conteneurs (whitelist requise dans AUTOMATION_ALLOWED_CONTAINERS)
- http_request : appels HTTP GET/POST vers les services internes (Home Assistant, webhooks, APIs locales)
- system_info : informations système (df, free, ps, uptime, uname)

Stratégie:
1. Commencer par docker_ps pour avoir une vue d'ensemble
2. Utiliser docker_logs pour diagnostiquer un problème avant d'agir
3. Préférer les opérations de lecture (ps, logs, stats, inspect) avant toute modification
4. Ne redémarrer un conteneur qu'après avoir analysé les logs
5. Vérifier l'état après chaque action avec docker_ps ou docker_logs
6. Pour Home Assistant: utiliser http_request avec l'URL de l'API HA (port 8123)

Réponds toujours en français avec une analyse claire et structurée.`

// ─── Public API ───────────────────────────────────────────────────────────────

export async function* runAutomationAgent(
    task: string,
    ollamaUrl: string,
    model: string,
    signal: AbortSignal,
    maxIterations = 12
): AsyncGenerator<AgentEvent> {
    const tools: Record<string, (args: ToolArgs) => Promise<ToolResult>> = {
        docker_ps:      () => dockerPsTool(),
        docker_logs:    (args) => dockerLogsTool(args),
        docker_stats:   () => dockerStatsTool(),
        docker_inspect: (args) => dockerInspectTool(args),
        docker_restart: (args) => dockerRestartTool(args),
        docker_stop:    (args) => dockerStopTool(args),
        docker_start:   (args) => dockerStartTool(args),
        http_request:   (args) => httpRequestTool(args),
        system_info:    (args) => systemInfoTool(args),
    }

    yield* runAgentWithTools(task, ollamaUrl, model, signal, SYSTEM_PROMPT, TOOL_DEFINITIONS, tools, "automation", maxIterations)
}
