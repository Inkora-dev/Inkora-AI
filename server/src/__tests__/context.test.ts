import { describe, it, expect } from "vitest"
import { applyContextWindow, MAX_CONTEXT_TOKENS } from "../context"

const BUDGET_CHARS = MAX_CONTEXT_TOKENS * 4

describe("applyContextWindow", () => {
    it("retourne tous les messages quand le total est sous le budget", () => {
        const msgs = [
            { role: "user" as const, content: "Bonjour" },
            { role: "assistant" as const, content: "Salut" },
        ]
        expect(applyContextWindow(msgs, null)).toEqual(msgs)
    })

    it("conserve toujours au moins le dernier message même si trop long", () => {
        const giant = "x".repeat(BUDGET_CHARS + 1000)
        const msgs = [
            { role: "user" as const, content: "Premier message" },
            { role: "assistant" as const, content: giant },
        ]
        const result = applyContextWindow(msgs, null)
        expect(result).toHaveLength(1)
        expect(result[0].content).toBe(giant)
    })

    it("tronque les anciens messages pour rester dans le budget", () => {
        const old = Array.from({ length: 20 }, (_, i) => ({
            role: i % 2 === 0 ? "user" as const : "assistant" as const,
            content: "a".repeat(2_000),
        }))
        const result = applyContextWindow(old, null)
        expect(result.length).toBeLessThan(old.length)
        // les messages conservés doivent être les plus récents
        expect(result[result.length - 1]).toEqual(old[old.length - 1])
    })

    it("compte les chars du system prompt dans le budget", () => {
        const sysPrompt = "s".repeat(BUDGET_CHARS - 100)
        const msgs = [
            { role: "user" as const, content: "a".repeat(50) },
            { role: "assistant" as const, content: "b".repeat(50) },
            { role: "user" as const, content: "c".repeat(200) },
        ]
        // Le system prompt consomme presque tout — seul le dernier message devrait tenir
        const result = applyContextWindow(msgs, sysPrompt)
        expect(result.length).toBe(1)
        expect(result[0].content).toContain("c")
    })

    it("respecte l'ordre original des messages conservés", () => {
        const msgs = [
            { role: "user" as const, content: "1" },
            { role: "assistant" as const, content: "2" },
            { role: "user" as const, content: "3" },
        ]
        const result = applyContextWindow(msgs, null)
        for (let i = 1; i < result.length; i++) {
            const prevIdx = msgs.findIndex((m) => m === result[i - 1])
            const currIdx = msgs.findIndex((m) => m === result[i])
            expect(currIdx).toBeGreaterThan(prevIdx)
        }
    })
})
