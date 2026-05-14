import type { Message } from "@inkora/shared"
import { log } from "./logger"

export const MAX_CONTEXT_TOKENS = 6_000
const TOKEN_ESTIMATE = 4 // chars per token (rough)

export function applyContextWindow(messages: Message[], systemPrompt: string | null): Message[] {
    const sysChars = systemPrompt ? systemPrompt.length : 0
    const budget = (MAX_CONTEXT_TOKENS * TOKEN_ESTIMATE) - sysChars

    let total = 0
    const kept: Message[] = []
    for (let i = messages.length - 1; i >= 0; i--) {
        total += messages[i].content.length
        if (total > budget && kept.length > 0) break // always keep at least the last message
        kept.unshift(messages[i])
    }

    const dropped = messages.length - kept.length
    if (dropped > 0) {
        log.chat.warn({ dropped, kept: kept.length }, "context window trimmed")
    }
    return kept
}
