import { describe, it, expect } from "vitest"
import { splitIntoChunks } from "../rag"

describe("splitIntoChunks", () => {
    it("retourne le texte entier en un seul chunk si sous la taille", () => {
        const text = "hello world"
        const chunks = splitIntoChunks(text, 600, 120)
        expect(chunks).toHaveLength(1)
        expect(chunks[0]).toBe(text)
    })

    it("découpe un texte long en plusieurs chunks", () => {
        const text = "a".repeat(1_800)
        const chunks = splitIntoChunks(text, 600, 120)
        expect(chunks.length).toBeGreaterThan(1)
    })

    it("respecte le chevauchement — le début du chunk N+1 contient la fin du chunk N", () => {
        const text = "abcdefghij".repeat(100) // 1000 chars
        const chunks = splitIntoChunks(text, 200, 50)
        expect(chunks.length).toBeGreaterThan(1)
        // fin du chunk 0: text.slice(150, 200), début du chunk 1: text.slice(150, 350)
        const tailChunk0 = chunks[0].slice(chunks[0].length - 50)
        expect(chunks[1].startsWith(tailChunk0)).toBe(true)
    })

    it("chaque chunk fait au plus `size` caractères", () => {
        const text = "x".repeat(3_000)
        const chunks = splitIntoChunks(text, 600, 100)
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(600)
        }
    })

    it("texte vide retourne un tableau vide", () => {
        const chunks = splitIntoChunks("", 600, 120)
        expect(chunks).toHaveLength(0)
    })
})
