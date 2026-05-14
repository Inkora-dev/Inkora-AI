import type { Conversation } from "@inkora/shared"

const STORAGE_KEY = "inkora-conversations"
const SYSTEM_PROMPT_KEY = "inkora-system-prompt"
const ACTIVE_MODEL_KEY = "inkora-active-model"

export function loadConversations(): Conversation[] {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    try {
        return JSON.parse(raw)
    } catch {
        return []
    }
}

export function saveConversations(conversations: Conversation[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
}

export function loadSystemPrompt(): string {
    return localStorage.getItem(SYSTEM_PROMPT_KEY) ?? ""
}

export function saveSystemPrompt(prompt: string) {
    localStorage.setItem(SYSTEM_PROMPT_KEY, prompt)
}

export function loadActiveModel(): string {
    return localStorage.getItem(ACTIVE_MODEL_KEY) ?? ""
}

export function saveActiveModel(model: string) {
    localStorage.setItem(ACTIVE_MODEL_KEY, model)
}

const RAG_ENABLED_KEY = "inkora-rag-enabled"

export function loadRagEnabled(): boolean {
    return localStorage.getItem(RAG_ENABLED_KEY) === "true"
}

export function saveRagEnabled(v: boolean) {
    localStorage.setItem(RAG_ENABLED_KEY, String(v))
}
