import type { RagDocument } from "@inkora/shared"
import { API_URL } from "./config"

export async function fetchDocuments(): Promise<RagDocument[]> {
    const r = await fetch(`${API_URL}/api/rag/documents`)
    if (!r.ok) throw new Error("fetch documents failed")
    return r.json() as Promise<RagDocument[]>
}

export async function uploadDocument(name: string, content: string): Promise<RagDocument> {
    const r = await fetch(`${API_URL}/api/rag/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, content }),
    })
    if (!r.ok) {
        const body = await r.text().catch(() => "")
        throw new Error(body || `HTTP ${r.status}`)
    }
    return r.json() as Promise<RagDocument>
}

export async function deleteDocument(id: string): Promise<void> {
    await fetch(`${API_URL}/api/rag/documents/${id}`, { method: "DELETE" })
}
