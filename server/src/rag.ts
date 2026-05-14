import type { RagDocument } from "@inkora/shared"
import { readFileSync, writeFile, mkdirSync } from "fs"
import path from "path"
import { log } from "./logger"

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORE_PATH = process.env.RAG_STORE_PATH
    ?? path.resolve(process.cwd(), "data/rag-store.json")

interface StoreFile {
    documents: RagDocument[]
    chunks: Chunk[]
}

function loadStore(): StoreFile {
    try {
        const raw = readFileSync(STORE_PATH, "utf-8")
        const parsed = JSON.parse(raw) as StoreFile
        if (Array.isArray(parsed.documents) && Array.isArray(parsed.chunks)) {
            return parsed
        }
    } catch {
        // file doesn't exist or is corrupted — start fresh
    }
    return { documents: [], chunks: [] }
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null

function persistStore() {
    if (_saveTimer) clearTimeout(_saveTimer)
    _saveTimer = setTimeout(() => {
        try { mkdirSync(path.dirname(STORE_PATH), { recursive: true }) } catch { /* already exists */ }
        const payload: StoreFile = { documents: [...documents], chunks: [...chunks] }
        writeFile(STORE_PATH, JSON.stringify(payload), (err) => {
            if (err) log.rag.error({ err }, "persist error")
        })
    }, 200) // debounce — batch rapid mutations
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface Chunk {
    id: string
    docId: string
    docName: string
    text: string
    embedding: number[]
}

// ─── In-memory store (loaded from disk on startup) ────────────────────────────

const initial = loadStore()
const documents: RagDocument[] = initial.documents
const chunks: Chunk[] = initial.chunks

if (documents.length > 0) {
    log.rag.info({ docs: documents.length, chunks: chunks.length, path: STORE_PATH }, "store loaded")
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    return denom === 0 ? 0 : dot / denom
}

export function splitIntoChunks(text: string, size = 600, overlap = 120): string[] {
    const result: string[] = []
    let start = 0
    while (start < text.length) {
        result.push(text.slice(start, start + size))
        start += size - overlap
    }
    return result
}

// ─── Embedding via Ollama nomic-embed-text ────────────────────────────────────

export async function embedText(text: string, ollamaUrl: string): Promise<number[]> {
    const r = await fetch(`${ollamaUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
        signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) {
        const msg = await r.text().catch(() => r.status.toString())
        throw new Error(`Embedding échoué (${r.status}): ${msg}. Lance: ollama pull nomic-embed-text`)
    }
    const data = await r.json() as { embedding: number[] }
    return data.embedding
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function listDocuments(): RagDocument[] {
    return [...documents]
}

export async function addDocument(name: string, content: string, ollamaUrl: string): Promise<RagDocument> {
    const docId = crypto.randomUUID()
    const textChunks = splitIntoChunks(content)

    for (let i = 0; i < textChunks.length; i++) {
        const embedding = await embedText(textChunks[i], ollamaUrl)
        chunks.push({ id: `${docId}-${i}`, docId, docName: name, text: textChunks[i], embedding })
    }

    const doc: RagDocument = {
        id: docId,
        name,
        size: content.length,
        chunkCount: textChunks.length,
        uploadedAt: Date.now(),
    }
    documents.push(doc)
    persistStore()
    return doc
}

export function clearAllDocuments(): void {
    documents.length = 0
    chunks.length = 0
    persistStore()
}

export function removeDocument(id: string): boolean {
    const idx = documents.findIndex((d) => d.id === id)
    if (idx === -1) return false
    documents.splice(idx, 1)
    let i = chunks.length - 1
    while (i >= 0) {
        if (chunks[i].docId === id) chunks.splice(i, 1)
        i--
    }
    persistStore()
    return true
}

export async function retrieveContext(query: string, ollamaUrl: string, topK = 5): Promise<string> {
    if (chunks.length === 0) return ""
    const queryEmbedding = await embedText(query, ollamaUrl)

    const scored = chunks
        .map((c) => ({ chunk: c, score: cosineSimilarity(queryEmbedding, c.embedding) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .filter((s) => s.score >= 0.3)

    if (scored.length === 0) return ""

    return scored
        .map((s) => `### ${s.chunk.docName}\n${s.chunk.text}`)
        .join("\n\n")
}
