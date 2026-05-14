import type { Conversation, Message } from "@inkora/shared"
import { API_URL } from "./config"

export async function sendMessage(
    messages: Message[],
    signal?: AbortSignal,
    options?: { systemPrompt?: string; model?: string; ragEnabled?: boolean }
) {
    const response = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, ...options }),
        signal,
    })

    if (!response.ok) {
        const body = await response.text().catch(() => "")
        throw new Error(`HTTP ${response.status} — ${body.slice(0, 200) || "no body"}`)
    }

    return response.body
}

export async function fetchConversations(): Promise<Conversation[]> {
    try {
        const r = await fetch(`${API_URL}/api/conversations`)
        if (!r.ok) return []
        return await r.json() as Conversation[]
    } catch {
        return []
    }
}

export async function upsertConversationApi(conv: Conversation): Promise<void> {
    await fetch(`${API_URL}/api/conversations/${conv.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(conv),
    }).catch(() => {})
}

export async function deleteConversationApi(id: string): Promise<void> {
    await fetch(`${API_URL}/api/conversations/${id}`, { method: "DELETE" }).catch(() => {})
}

export async function clearConversationsApi(): Promise<void> {
    await fetch(`${API_URL}/api/conversations`, { method: "DELETE" }).catch(() => {})
}

export async function fetchTitle(messages: Message[], model?: string): Promise<string> {
    try {
        const r = await fetch(`${API_URL}/api/title`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages, model }),
        })
        if (!r.ok) return ""
        const data = await r.json() as { title?: string }
        return data.title ?? ""
    } catch {
        return ""
    }
}
