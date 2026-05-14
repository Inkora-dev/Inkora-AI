import { useCallback, useEffect, useRef, useState } from "react"
import { X, Upload, FileText, Trash2, Loader2, AlertCircle } from "lucide-react"
import { fetchDocuments, uploadDocument, deleteDocument } from "../lib/rag"
import type { RagDocument } from "@inkora/shared"

type Props = {
    onClose: () => void
}

function fmtSize(bytes: number) {
    if (bytes >= 1_000_000) return (bytes / 1_000_000).toFixed(1) + " MB"
    if (bytes >= 1_000) return (bytes / 1_000).toFixed(0) + " KB"
    return bytes + " B"
}

const ACCEPTED = ".txt,.md,.ts,.tsx,.js,.jsx,.py,.go,.rs,.json,.yaml,.yml,.toml,.html,.css,.sql,.sh,.env.example"

export function DocumentPanel({ onClose }: Props) {
    const [documents, setDocuments] = useState<RagDocument[]>([])
    const [uploading, setUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [dragOver, setDragOver] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        fetchDocuments().then(setDocuments).catch(() => setDocuments([]))
    }, [])

    async function handleFiles(files: FileList | File[]) {
        setError(null)
        setUploading(true)
        const arr = Array.from(files)
        for (const file of arr) {
            if (file.size > 1_500_000) {
                setError(`"${file.name}" dépasse 1.5 MB, ignoré.`)
                continue
            }
            try {
                const content = await file.text()
                const doc = await uploadDocument(file.name, content)
                setDocuments((prev) => [...prev, doc])
            } catch (err) {
                setError(String(err))
            }
        }
        setUploading(false)
    }

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        handleFiles(e.dataTransfer.files)
    }, [])

    async function handleDelete(id: string) {
        await deleteDocument(id)
        setDocuments((prev) => prev.filter((d) => d.id !== id))
    }

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative z-10 flex h-full w-full max-w-sm flex-col border-l border-white/[0.07] bg-[#0E0F12] shadow-2xl">

                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
                    <div>
                        <h2 className="text-[14px] font-semibold text-[#C8C8D4]">Documents RAG</h2>
                        <p className="mt-0.5 text-[11px] text-[#3E3E50]">
                            Nécessite : <code className="text-[#6C65E8]">ollama pull nomic-embed-text</code>
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-[6px] p-1 text-[#4A4A58] transition-colors hover:bg-white/[0.05] hover:text-[#8B8B9E]"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Drop zone */}
                <div className="px-4 py-4">
                    <div
                        onDrop={onDrop}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onClick={() => inputRef.current?.click()}
                        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 transition-colors
                            ${dragOver
                                ? "border-[#6C65E8]/60 bg-[#6C65E8]/[0.06]"
                                : "border-white/[0.08] hover:border-white/[0.14] hover:bg-white/[0.02]"
                            }`}
                    >
                        {uploading ? (
                            <Loader2 size={22} className="animate-spin text-[#6C65E8]" />
                        ) : (
                            <Upload size={22} className="text-[#4A4A58]" />
                        )}
                        <p className="text-[12px] text-[#4A4A5E]">
                            {uploading ? "Indexation en cours…" : "Glisse des fichiers ou clique pour uploader"}
                        </p>
                        <p className="text-[11px] text-[#2E2E3E]">txt, md, ts, js, py, json…</p>
                    </div>
                    <input
                        ref={inputRef}
                        type="file"
                        multiple
                        accept={ACCEPTED}
                        className="hidden"
                        onChange={(e) => e.target.files && handleFiles(e.target.files)}
                    />
                </div>

                {error && (
                    <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2.5 text-[12px] text-red-400">
                        <AlertCircle size={13} className="mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {/* Document list */}
                <div className="flex-1 overflow-y-auto px-4 pb-4">
                    {documents.length === 0 ? (
                        <p className="mt-4 text-center text-[12px] text-[#2E2E3E]">
                            Aucun document indexé
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {documents.map((doc) => (
                                <div
                                    key={doc.id}
                                    className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
                                >
                                    <FileText size={14} className="shrink-0 text-[#4A4A58]" />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[12px] font-medium text-[#C8C8D4]">{doc.name}</p>
                                        <p className="text-[11px] text-[#3E3E50]">
                                            {fmtSize(doc.size)} · {doc.chunkCount} chunks
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => handleDelete(doc.id)}
                                        className="shrink-0 rounded-[6px] p-1 text-[#3E3E50] transition-colors hover:bg-red-500/[0.10] hover:text-red-400"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
