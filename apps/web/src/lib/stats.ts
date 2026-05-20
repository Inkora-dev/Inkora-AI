import type { MetricsResponse, SystemStats } from "@inkora/shared"
import { API_URL } from "./config"

export async function fetchMetrics(): Promise<MetricsResponse> {
    const r = await fetch(`${API_URL}/api/metrics`)
    if (!r.ok) throw new Error("metrics fetch failed")
    return r.json() as Promise<MetricsResponse>
}

export async function fetchSystem(): Promise<SystemStats> {
    const r = await fetch(`${API_URL}/api/system`)
    if (!r.ok) throw new Error("system fetch failed")
    return r.json() as Promise<SystemStats>
}

export async function fetchModels(): Promise<string[]> {
    try {
        const r = await fetch(`${API_URL}/api/ollama/health`)
        if (!r.ok) return []
        const data = await r.json() as { models?: string[] }
        return (data.models ?? []).filter((m) => !m.toLowerCase().includes("embed"))
    } catch {
        return []
    }
}
