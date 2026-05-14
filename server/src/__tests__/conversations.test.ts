import { describe, it, expect, beforeEach } from "vitest"

// Point to a non-existent path so loadStore starts empty without warnings
process.env.CONVERSATIONS_STORE_PATH = "/tmp/inkora-test-convs-nonexistent.json"

const { listConversations, getConversation, upsertConversation, deleteConversation, clearAllConversations } =
    await import("../conversations")

const makeConv = (id: string, title = "Test") => ({
    id,
    title,
    createdAt: Date.now(),
    messages: [{ role: "user" as const, content: "hello" }],
})

beforeEach(() => { clearAllConversations() })

describe("conversations CRUD", () => {
    it("démarre vide", () => {
        expect(listConversations()).toHaveLength(0)
    })

    it("upsert crée une conversation", () => {
        upsertConversation(makeConv("a"))
        expect(listConversations()).toHaveLength(1)
        expect(getConversation("a")?.title).toBe("Test")
    })

    it("upsert met à jour une conversation existante", () => {
        upsertConversation(makeConv("a", "Titre initial"))
        upsertConversation(makeConv("a", "Titre modifié"))
        expect(listConversations()).toHaveLength(1)
        expect(getConversation("a")?.title).toBe("Titre modifié")
    })

    it("delete supprime la conversation", () => {
        upsertConversation(makeConv("a"))
        const deleted = deleteConversation("a")
        expect(deleted).toBe(true)
        expect(listConversations()).toHaveLength(0)
    })

    it("delete retourne false si la conversation n'existe pas", () => {
        expect(deleteConversation("inexistant")).toBe(false)
    })

    it("getConversation retourne undefined pour un id inconnu", () => {
        expect(getConversation("nope")).toBeUndefined()
    })

    it("clearAll supprime toutes les conversations", () => {
        upsertConversation(makeConv("a"))
        upsertConversation(makeConv("b"))
        clearAllConversations()
        expect(listConversations()).toHaveLength(0)
    })

    it("listConversations trie par createdAt décroissant", () => {
        upsertConversation({ ...makeConv("old"), createdAt: 1000 })
        upsertConversation({ ...makeConv("new"), createdAt: 9000 })
        const list = listConversations()
        expect(list[0].id).toBe("new")
        expect(list[1].id).toBe("old")
    })
})
