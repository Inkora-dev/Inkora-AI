import path from "path"
import os from "os"
import { exec } from "child_process"
import { promisify } from "util"
import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import type { Message, Conversation, RequestLog, SystemStats, GpuStats, MetricsResponse } from "@inkora/shared"
import { addDocument, clearAllDocuments, listDocuments, removeDocument, retrieveContext } from "./rag"
import { listConversations, getConversation, upsertConversation, deleteConversation, clearAllConversations } from "./conversations"
import { runAgent } from "./agent"
import { applyContextWindow } from "./context"
import { bus, getRecentRuns } from "./bus"
import { log } from "./logger"

dotenv.config({ path: path.resolve(__dirname, "../../.env") })

const execAsync = promisify(exec)

const PORT = process.env.PORT ?? "3001"
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434"
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b"
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173"

const app = express()
app.use(cors({
    origin: (origin, cb) => {
        // allow any localhost port (dev tool — never exposed publicly)
        if (!origin || /^http:\/\/localhost(:\d+)?$/.test(origin) || origin === WEB_ORIGIN) {
            cb(null, true)
        } else {
            cb(new Error("CORS: origin not allowed"))
        }
    },
}))
app.use(express.json({ limit: "2mb" }))

// ─── In-memory metrics store ──────────────────────────────────────────────────

const recentLogs: RequestLog[] = []
const MAX_LOGS = 100

function addLog(log: RequestLog) {
    recentLogs.push(log)
    if (recentLogs.length > MAX_LOGS) recentLogs.shift()
}

// ─── nvidia-smi (best-effort, NVIDIA only) ────────────────────────────────────

async function getNvidiaStats(): Promise<GpuStats> {
    try {
        const { stdout } = await execAsync(
            "nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits",
            { timeout: 3000 }
        )
        const parts = stdout.trim().split(",").map((s) => parseInt(s.trim(), 10))
        if (parts.length < 4 || parts.some(isNaN)) return null
        return {
            utilizationPercent: parts[0],
            memoryUsedMB: parts[1],
            memoryTotalMB: parts[2],
            temperatureC: parts[3],
        }
    } catch {
        return null
    }
}

// ─── System stats (cached 4 s) ────────────────────────────────────────────────

let systemCache: { data: SystemStats; ts: number } | null = null
const CACHE_TTL = 4_000

async function getSystemStats(): Promise<SystemStats> {
    if (systemCache && Date.now() - systemCache.ts < CACHE_TTL) return systemCache.data

    const total = os.totalmem()
    const free = os.freemem()
    const used = total - free

    const [gpu, ollamaRaw] = await Promise.all([
        getNvidiaStats(),
        fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(2_000) })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
    ])

    const data: SystemStats = {
        ram: { totalBytes: total, usedBytes: used, freeBytes: free, percent: Math.round((used / total) * 100) },
        gpu,
        ollama: ollamaRaw ?? null,
    }
    systemCache = { data, ts: Date.now() }
    return data
}

// ─── Validation ───────────────────────────────────────────────────────────────

function isValidMessage(m: unknown): m is Message {
    if (typeof m !== "object" || m === null) return false
    const msg = m as Record<string, unknown>
    return (
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.content === "string" &&
        msg.content.length <= 8_000
    )
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
    res.json({ status: "ok", model: OLLAMA_MODEL })
})

app.get("/api/ollama/health", async (_req, res) => {
    try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3_000) })
        const data = await r.json() as { models?: { name: string }[] }
        res.json({
            ok: true,
            models: data.models?.map((m) => m.name) ?? [],
            url: OLLAMA_URL,
        })
    } catch (err) {
        res.json({ ok: false, error: String(err), url: OLLAMA_URL })
    }
})

app.get("/api/system", async (_req, res) => {
    try {
        res.json(await getSystemStats())
    } catch (err) {
        log.system.error({ err }, "failed to fetch system stats")
        res.status(500).json({ error: "Failed to fetch system stats" })
    }
})

app.get("/api/metrics", (_req, res) => {
    const logs = recentLogs
    const count = logs.length

    if (count === 0) {
        const empty: MetricsResponse = {
            requests: 0,
            avgResponseTime: 0,
            avgTimeToFirstToken: 0,
            avgTokensPerSecond: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            logs: [],
        }
        res.json(empty)
        return
    }

    const response: MetricsResponse = {
        requests: count,
        avgResponseTime: Math.round(logs.reduce((s, l) => s + l.totalTime, 0) / count),
        avgTimeToFirstToken: Math.round(logs.reduce((s, l) => s + l.timeToFirstToken, 0) / count),
        avgTokensPerSecond: Math.round(logs.reduce((s, l) => s + l.tokensPerSecond, 0) / count * 10) / 10,
        totalPromptTokens: logs.reduce((s, l) => s + l.promptTokens, 0),
        totalCompletionTokens: logs.reduce((s, l) => s + l.completionTokens, 0),
        logs: [...logs].reverse().slice(0, 50),
    }
    res.json(response)
})

app.post("/api/chat", async (req, res) => {
    const { messages, systemPrompt, model, ragEnabled } = req.body as {
        messages: unknown
        systemPrompt?: unknown
        model?: unknown
        ragEnabled?: unknown
    }

    if (
        !Array.isArray(messages) ||
        messages.length === 0 ||
        messages.length > 100 ||
        !messages.every(isValidMessage)
    ) {
        res.status(400).json({ error: "Messages invalides." })
        return
    }

    let sysPrompt =
        typeof systemPrompt === "string" && systemPrompt.trim().length > 0
            ? systemPrompt.trim().slice(0, 4_000)
            : null

    if (ragEnabled === true) {
        const lastUserContent = (messages as Message[]).filter((m) => m.role === "user").pop()?.content ?? ""
        if (lastUserContent) {
            const context = await retrieveContext(lastUserContent, OLLAMA_URL).catch(() => "")
            if (context) {
                const ragBlock = `## Contexte pertinent de tes documents\n\n${context}\n\n---`
                sysPrompt = sysPrompt ? `${ragBlock}\n\n${sysPrompt}` : ragBlock
            }
        }
    }

    const requestModel =
        typeof model === "string" && /^[\w.:@/-]{1,100}$/.test(model.trim())
            ? model.trim()
            : OLLAMA_MODEL

    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 120_000)
    res.on("close", () => { if (!res.writableEnded) abort.abort() })

    const startTime = Date.now()
    let firstChunkMs = 0
    let promptTokens = 0
    let completionTokens = 0
    let evalDurationNs = 0

    try {
        let ollamaResponse: Response
        try {
            ollamaResponse = await fetch(`${OLLAMA_URL}/api/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: requestModel,
                    messages: sysPrompt
                        ? [{ role: "system", content: sysPrompt }, ...applyContextWindow(messages as Message[], sysPrompt)]
                        : applyContextWindow(messages as Message[], null),
                    stream: true,
                }),
                signal: abort.signal,
            })
        } catch (fetchErr) {
            if ((fetchErr as Error).name === "AbortError") throw fetchErr
            const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
            log.chat.error({ ollamaUrl: OLLAMA_URL, msg }, "cannot reach Ollama")
            res.status(502).json({ error: `Ollama unreachable (${OLLAMA_URL}): ${msg}` })
            return
        }

        if (!ollamaResponse.ok) {
            const errorText = await ollamaResponse.text()
            log.chat.error({ status: ollamaResponse.status, body: errorText }, "Ollama error")
            res.status(502).json({ error: `Ollama ${ollamaResponse.status}: ${errorText}` })
            return
        }
        if (!ollamaResponse.body) {
            res.status(502).json({ error: "Ollama returned no stream body" })
            return
        }

        // commit to streaming only after Ollama responds OK
        res.setHeader("Content-Type", "text/plain; charset=utf-8")
        res.setHeader("X-Content-Type-Options", "nosniff")

        const reader = ollamaResponse.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        const flushLine = (line: string) => {
            if (!line.trim()) return
            try {
                const json = JSON.parse(line)
                // capture final stats from done chunk
                if (json.done) {
                    promptTokens = json.prompt_eval_count ?? 0
                    completionTokens = json.eval_count ?? 0
                    evalDurationNs = json.eval_duration ?? 0
                }
                const content: string | undefined = json.message?.content
                if (content) {
                    if (!firstChunkMs) firstChunkMs = Date.now() - startTime
                    res.write(content)
                }
            } catch {
                // malformed line — skip
            }
        }

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) flushLine(line)
        }
        buffer += decoder.decode()
        flushLine(buffer)

        res.end()

        // log only completed responses
        if (completionTokens > 0) {
            const totalTime = Date.now() - startTime
            const tps = evalDurationNs > 0
                ? Math.round((completionTokens / (evalDurationNs / 1_000_000_000)) * 10) / 10
                : 0
            const promptPreview =
                (messages as Message[]).filter((m) => m.role === "user").pop()?.content.slice(0, 80) ?? ""
            addLog({
                id: crypto.randomUUID(),
                timestamp: startTime,
                model: requestModel,
                promptTokens,
                completionTokens,
                tokensPerSecond: tps,
                timeToFirstToken: firstChunkMs || totalTime,
                totalTime,
                promptPreview,
            })
            bus.emit("chat:done", { model: requestModel, promptTokens, completionTokens, ms: totalTime })
        }
    } catch (error) {
        const isAbort = (error as Error).name === "AbortError"
        if (!isAbort) log.chat.error({ err: error }, "stream error")
        if (!res.headersSent && !isAbort) {
            const msg = error instanceof Error ? error.message : String(error)
            res.status(500).json({ error: msg })
        } else if (!res.writableEnded) {
            res.end()
        }
    } finally {
        clearTimeout(timeout)
    }
})

// ─── Title generation route ───────────────────────────────────────────────────

app.post("/api/title", async (req, res) => {
    const { messages, model } = req.body as { messages?: unknown; model?: unknown }

    if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isValidMessage)) {
        res.status(400).json({ error: "Messages invalides." })
        return
    }

    const requestModel =
        typeof model === "string" && /^[\w.:@/-]{1,100}$/.test(model.trim())
            ? model.trim()
            : OLLAMA_MODEL

    try {
        const r = await fetch(`${OLLAMA_URL}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: requestModel,
                messages: [
                    ...messages,
                    { role: "user", content: "Génère un titre court (3 à 6 mots maximum) pour résumer cette conversation. Réponds UNIQUEMENT avec le titre, sans ponctuation finale ni guillemets." },
                ],
                stream: false,
            }),
            signal: AbortSignal.timeout(12_000),
        })
        if (!r.ok) throw new Error(`Ollama ${r.status}`)
        const data = await r.json() as { message: { content: string } }
        const title = data.message.content.trim().replace(/^["']|["']$/g, "").slice(0, 60)
        res.json({ title })
    } catch (err) {
        res.status(500).json({ error: String(err) })
    }
})

// ─── Conversations routes ─────────────────────────────────────────────────────

function isValidConversation(c: unknown): c is Conversation {
    if (typeof c !== "object" || c === null) return false
    const conv = c as Record<string, unknown>
    return (
        typeof conv.id === "string" && conv.id.length > 0 &&
        typeof conv.title === "string" &&
        typeof conv.createdAt === "number" &&
        Array.isArray(conv.messages) &&
        (conv.messages as unknown[]).every(isValidMessage)
    )
}

app.get("/api/conversations", (_req, res) => {
    res.json(listConversations())
})

app.get("/api/conversations/:id", (req, res) => {
    const conv = getConversation(req.params.id)
    if (!conv) { res.status(404).json({ error: "Not found" }); return }
    res.json(conv)
})

app.put("/api/conversations/:id", (req, res) => {
    const body = req.body as unknown
    if (!isValidConversation(body) || body.id !== req.params.id) {
        res.status(400).json({ error: "Conversation invalide." })
        return
    }
    upsertConversation(body)
    res.json({ ok: true })
})

app.delete("/api/conversations/:id", (req, res) => {
    res.json({ ok: deleteConversation(req.params.id) })
})

app.delete("/api/conversations", (_req, res) => {
    clearAllConversations()
    res.json({ ok: true })
})

// ─── Info route ───────────────────────────────────────────────────────────────

app.get("/api/info", (_req, res) => {
    res.json({ port: PORT, ollamaUrl: OLLAMA_URL, model: OLLAMA_MODEL, version: "1.0.0" })
})

// ─── RAG routes ───────────────────────────────────────────────────────────────

app.get("/api/rag/documents", (_req, res) => {
    res.json(listDocuments())
})

app.delete("/api/rag/documents", (_req, res) => {
    clearAllDocuments()
    res.json({ ok: true })
})

app.post("/api/rag/upload", async (req, res) => {
    const { name, content } = req.body as { name?: unknown; content?: unknown }

    if (
        typeof name !== "string" || name.trim().length === 0 || name.length > 200 ||
        typeof content !== "string" || content.length === 0 || content.length > 1_500_000
    ) {
        res.status(400).json({ error: "Fichier invalide (max 1.5 MB)." })
        return
    }

    try {
        const doc = await addDocument(name.trim(), content, OLLAMA_URL)
        res.json(doc)
    } catch (err) {
        log.rag.error({ err }, "upload error")
        res.status(500).json({ error: String(err) })
    }
})

app.delete("/api/rag/documents/:id", (req, res) => {
    res.json({ ok: removeDocument(req.params.id) })
})

// ─── Agent route ──────────────────────────────────────────────────────────────

app.post("/api/agent/run", async (req, res) => {
    const { task, workDir, model } = req.body as { task?: unknown; workDir?: unknown; model?: unknown }

    if (typeof task !== "string" || task.trim().length === 0 || task.length > 2_000) {
        res.status(400).json({ error: "Tâche invalide." })
        return
    }

    const safeWorkDir = typeof workDir === "string" ? workDir.trim() : ""
    const agentModel = typeof model === "string" && /^[\w.:@/-]{1,100}$/.test(model.trim())
        ? model.trim()
        : OLLAMA_MODEL

    res.setHeader("Content-Type", "text/plain; charset=utf-8")
    res.setHeader("X-Content-Type-Options", "nosniff")

    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(new Error("Agent timeout (180s)")), 180_000)
    res.on("close", () => { clearTimeout(timeout); if (!res.writableEnded) abort.abort() })

    try {
        for await (const event of runAgent(task.trim(), OLLAMA_URL, agentModel, safeWorkDir, abort.signal)) {
            if (abort.signal.aborted) break
            res.write(JSON.stringify(event) + "\n")
        }
    } catch (err) {
        if (!res.writableEnded) {
            res.write(JSON.stringify({ type: "error", content: String(err) }) + "\n")
        }
    } finally {
        clearTimeout(timeout)
    }

    res.end()
})

app.get("/api/agent/runs", (_req, res) => {
    res.json(getRecentRuns())
})

app.listen(Number(PORT), () => {
    log.server.info({ port: PORT, ollamaUrl: OLLAMA_URL, model: OLLAMA_MODEL }, "Inkora backend running")
})
