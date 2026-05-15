import { bus } from "./bus"
import { log } from "./logger"

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function withTimeout(signal: AbortSignal, ms: number): { signal: AbortSignal; clear: () => void } {
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
    | { type: "stream_chunk"; chunk: string }
    | { type: "stream_commit"; as: "thought" | "answer"; text: string }
    | { type: "tool_call"; name: string; args: Record<string, unknown> }
    | { type: "tool_result"; name: string; content: string; isError?: boolean }
    | { type: "error"; content: string }
    | { type: "done" }

// ─── Ollama message types ─────────────────────────────────────────────────────

export interface OllamaToolCall {
    function: { name: string; arguments: Record<string, unknown> }
}

export interface OllamaMessage {
    role: "system" | "user" | "assistant" | "tool"
    content: string
    tool_calls?: OllamaToolCall[]
}

export type ToolResult = { content: string; isError?: boolean }
export type ToolArgs = Record<string, unknown>

export function str(v: unknown): string { return typeof v === "string" ? v : String(v ?? "") }

// Ollama sometimes returns tool call arguments as a JSON string instead of an object
export function normalizeArgs(args: unknown): Record<string, unknown> {
    if (typeof args === "string") {
        try { return JSON.parse(args) as Record<string, unknown> } catch { return { value: args } }
    }
    if (args !== null && typeof args === "object" && !Array.isArray(args)) {
        return args as Record<string, unknown>
    }
    return {}
}

// ─── Ollama streaming call ────────────────────────────────────────────────────

type StreamItem = { text: string } | { finalMessage: OllamaMessage }

export async function* streamOllama(
    messages: OllamaMessage[],
    ollamaUrl: string,
    model: string,
    signal: AbortSignal,
    toolDefinitions: object[]
): AsyncGenerator<StreamItem> {
    const { signal: timedSignal, clear } = withTimeout(signal, 150_000)

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
            body: JSON.stringify({ model, messages, tools: toolDefinitions, stream: true }),
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

// ─── Generic ReAct loop ───────────────────────────────────────────────────────

export async function* runAgentWithTools(
    task: string,
    ollamaUrl: string,
    model: string,
    signal: AbortSignal,
    systemPrompt: string,
    toolDefinitions: object[],
    tools: Record<string, (args: ToolArgs) => Promise<ToolResult>>,
    runTag: string,
    maxIterations = 15
): AsyncGenerator<AgentEvent> {
    const messages: OllamaMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: task },
    ]

    const runId = crypto.randomUUID()
    log.agent.info({ runId, model, runTag, task: task.slice(0, 120) }, "agent started")
    const startTs = Date.now()
    const recentFingerprints: string[] = []
    let iterCount = 0
    bus.emit("agent:start", { runId, task, model })

    for (let i = 0; i < maxIterations; i++) {
        if (signal.aborted) break

        let response: OllamaMessage | undefined

        try {
            for await (const item of streamOllama(messages, ollamaUrl, model, signal, toolDefinitions)) {
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
            yield { type: "error", content: isAbort ? "Ollama n'a pas répondu dans les temps (150s). Vérifie que le modèle est chargé." : msg }
            break
        }

        iterCount++

        if (!response) break
        messages.push(response)

        if (response.tool_calls?.length) {
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
