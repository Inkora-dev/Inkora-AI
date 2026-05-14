import { EventEmitter } from "events"
import type { AgentEvent } from "./agent"

// ─── Event map ────────────────────────────────────────────────────────────────

export interface BusEvents {
    "agent:start": { runId: string; task: string; model: string; workDir: string }
    "agent:event": { runId: string; event: AgentEvent }
    "agent:done":  { runId: string; durationMs: number; iterations: number }
    "agent:error": { runId: string; error: string }
    "chat:done":   { model: string; promptTokens: number; completionTokens: number; ms: number }
}

// ─── Typed EventEmitter ───────────────────────────────────────────────────────

class TypedBus extends EventEmitter {
    emit<K extends keyof BusEvents>(event: K, data: BusEvents[K]): boolean {
        return super.emit(event, data)
    }
    on<K extends keyof BusEvents>(event: K, listener: (data: BusEvents[K]) => void): this {
        return super.on(event, listener)
    }
    off<K extends keyof BusEvents>(event: K, listener: (data: BusEvents[K]) => void): this {
        return super.off(event, listener)
    }
}

export const bus = new TypedBus()
bus.setMaxListeners(30)

// ─── Agent run history ────────────────────────────────────────────────────────

export interface AgentRun {
    id: string
    task: string
    model: string
    workDir: string
    startedAt: number
    durationMs: number | null
    status: "running" | "done" | "error"
    iterations: number
    error?: string
}

const MAX_RUNS = 50
const runs: AgentRun[] = []

bus.on("agent:start", ({ runId, task, model, workDir }) => {
    runs.unshift({
        id: runId,
        task: task.slice(0, 200),
        model,
        workDir,
        startedAt: Date.now(),
        durationMs: null,
        status: "running",
        iterations: 0,
    })
    if (runs.length > MAX_RUNS) runs.pop()
})

bus.on("agent:done", ({ runId, durationMs, iterations }) => {
    const run = runs.find((r) => r.id === runId)
    if (run) { run.durationMs = durationMs; run.status = "done"; run.iterations = iterations }
})

bus.on("agent:error", ({ runId, error }) => {
    const run = runs.find((r) => r.id === runId)
    if (run) { run.status = "error"; run.error = error.slice(0, 300) }
})

export function getRecentRuns(limit = 20): AgentRun[] {
    return runs.slice(0, limit)
}
