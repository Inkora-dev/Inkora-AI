import { API_URL } from "./config"

export type AgentEvent =
    | { type: "stream_chunk"; chunk: string }
    | { type: "stream_commit"; as: "thought" | "answer"; text: string }
    | { type: "tool_call"; name: string; args: Record<string, unknown> }
    | { type: "tool_result"; name: string; content: string; isError?: boolean }
    | { type: "error"; content: string }
    | { type: "done" }

export async function* streamAutomation(
    task: string,
    model: string,
    signal: AbortSignal
): AsyncGenerator<AgentEvent> {
    const response = await fetch(`${API_URL}/api/automation/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, model }),
        signal,
    })

    if (!response.ok || !response.body) {
        const msg = await response.text().catch(() => `HTTP ${response.status}`)
        throw new Error(msg)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    const IDLE_TIMEOUT_MS = 60_000

    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const idleCtrl = new AbortController()
    const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => idleCtrl.abort(), IDLE_TIMEOUT_MS)
    }
    signal.addEventListener("abort", () => { if (idleTimer) clearTimeout(idleTimer) }, { once: true })
    resetIdle()

    try {
        while (true) {
            if (idleCtrl.signal.aborted) {
                yield { type: "error", content: "Pas de réponse du serveur depuis 60s — vérifiez qu'Ollama tourne." }
                break
            }
            const { done, value } = await reader.read()
            if (done) break
            resetIdle()
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""
            for (const line of lines) {
                if (!line.trim()) continue
                try { yield JSON.parse(line) as AgentEvent } catch { /* skip */ }
            }
        }
    } finally {
        if (idleTimer) clearTimeout(idleTimer)
    }

    if (buffer.trim()) {
        try { yield JSON.parse(buffer) as AgentEvent } catch { /* ignore */ }
    }
}
