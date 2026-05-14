import fs from "fs"
import path from "path"
import type { Conversation } from "@inkora/shared"
import { log } from "./logger"

const STORE_PATH =
    process.env.CONVERSATIONS_STORE_PATH ??
    path.resolve(process.cwd(), "data/conversations.json")

let store: Map<string, Conversation> = new Map()

function loadStore() {
    try {
        const raw = fs.readFileSync(STORE_PATH, "utf-8")
        const arr = JSON.parse(raw) as Conversation[]
        if (!Array.isArray(arr)) return
        store = new Map(arr.map((c) => [c.id, c]))
        log.conversations.info({ count: store.size, path: STORE_PATH }, "store loaded")
    } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            log.conversations.warn({ err }, "failed to load store")
        }
    }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

function persistStore() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
        const arr = [...store.values()].sort((a, b) => b.createdAt - a.createdAt)
        const dir = path.dirname(STORE_PATH)
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFile(STORE_PATH, JSON.stringify(arr, null, 2), (err) => {
            if (err) log.conversations.error({ err }, "persist error")
        })
    }, 300)
}

loadStore()

export function listConversations(): Conversation[] {
    return [...store.values()].sort((a, b) => b.createdAt - a.createdAt)
}

export function getConversation(id: string): Conversation | undefined {
    return store.get(id)
}

export function upsertConversation(conv: Conversation): void {
    store.set(conv.id, conv)
    persistStore()
}

export function deleteConversation(id: string): boolean {
    const existed = store.delete(id)
    if (existed) persistStore()
    return existed
}

export function clearAllConversations(): void {
    store.clear()
    persistStore()
}
