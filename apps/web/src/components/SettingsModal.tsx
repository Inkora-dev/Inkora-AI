import { useEffect, useState } from "react"
import { Check, Copy, Loader2, RotateCcw, X } from "lucide-react"
import { fetchDocuments, deleteDocument } from "../lib/rag"
import type { RagDocument } from "@inkora/shared"

import { API_URL } from "../lib/config"

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "assistant" | "donnees" | "serveur"

type Props = {
    systemPrompt: string
    onSave: (prompt: string) => void
    onClose: () => void
    onClearConversations: () => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtKb(bytes: number) {
    if (bytes >= 1_000_000) return (bytes / 1_000_000).toFixed(1) + " MB"
    if (bytes >= 1_000) return (bytes / 1_000).toFixed(0) + " KB"
    return bytes + " B"
}

function CopyBtn({ value }: { value: string }) {
    const [copied, setCopied] = useState(false)
    function copy() {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }
    return (
        <button
            onClick={copy}
            className="rounded-[6px] p-1 text-[#3E3E50] transition-colors hover:bg-white/[0.05] hover:text-[#8B8B9E]"
            title="Copier"
        >
            {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
    )
}

function Row({ label, value, sub, action }: { label: string; value: string; sub?: string; action?: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between border-b border-white/[0.04] py-3 last:border-0">
            <div className="min-w-0">
                <p className="text-[13px] text-[#8B8B9E]">{label}</p>
                {sub && <p className="mt-0.5 text-[11px] text-[#3E3E50]">{sub}</p>}
            </div>
            <div className="ml-4 flex shrink-0 items-center gap-2">
                <span className="font-mono text-[12px] text-[#4A4A5E]">{value}</span>
                {action}
            </div>
        </div>
    )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <p className="mb-1 mt-5 text-[10px] font-semibold uppercase tracking-widest text-[#2E2E3E] first:mt-0">
            {children}
        </p>
    )
}

// ─── Tab: Assistant ───────────────────────────────────────────────────────────

function AssistantTab({ systemPrompt, onSave, onClose }: { systemPrompt: string; onSave: (p: string) => void; onClose: () => void }) {
    const [value, setValue] = useState(systemPrompt)
    useEffect(() => setValue(systemPrompt), [systemPrompt])

    return (
        <>
            <div className="flex-1 overflow-y-auto p-5">
                <SectionLabel>System prompt</SectionLabel>
                <p className="mb-3 text-[12px] text-[#4A4A5E]">
                    Définit le comportement du modèle pour toutes les conversations. Laisse vide pour utiliser le modèle sans instruction.
                </p>
                <textarea
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Tu es un assistant expert en..."
                    rows={9}
                    maxLength={4000}
                    className="w-full resize-none rounded-xl border border-white/[0.08] bg-[#09090B] px-4 py-3 text-[13px] text-[#C8C8D4] placeholder-[#3E3E50] outline-none transition-colors focus:border-[#6C65E8]/40 focus:ring-1 focus:ring-[#6C65E8]/20"
                />
                <p className="mt-1.5 text-right text-[11px] text-[#3E3E50]">{value.length} / 4000</p>
            </div>
            <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-4">
                <button
                    onClick={() => setValue("")}
                    className="flex items-center gap-1.5 text-[12px] text-[#4A4A58] transition-colors hover:text-[#8B8B9E]"
                >
                    <RotateCcw size={12} />
                    Réinitialiser
                </button>
                <div className="flex gap-2">
                    <button onClick={onClose} className="rounded-[8px] border border-white/[0.07] px-3 py-1.5 text-[13px] text-[#8B8B9E] transition-colors hover:bg-white/[0.04]">
                        Annuler
                    </button>
                    <button onClick={() => { onSave(value); onClose() }} className="rounded-[8px] bg-[#6C65E8] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#7B74F0]">
                        Enregistrer
                    </button>
                </div>
            </div>
        </>
    )
}

// ─── Tab: Données ─────────────────────────────────────────────────────────────

function DonneesTab({ onClearConversations }: { onClearConversations: () => void }) {
    const [docs, setDocs] = useState<RagDocument[]>([])
    const [confirmClearConv, setConfirmClearConv] = useState(false)
    const [confirmClearRag, setConfirmClearRag] = useState(false)

    useEffect(() => {
        fetchDocuments().then(setDocs).catch(() => {})
    }, [])

    const convRaw = localStorage.getItem("inkora-conversations") ?? ""
    const convCount = (() => { try { return (JSON.parse(convRaw) as unknown[]).length } catch { return 0 } })()
    const convSize = convRaw.length

    const systemPromptSize = (localStorage.getItem("inkora-system-prompt") ?? "").length
    const totalLocalSize = convSize + systemPromptSize

    const ragDocCount = docs.length
    const ragChunkCount = docs.reduce((s, d) => s + d.chunkCount, 0)
    const ragSize = docs.reduce((s, d) => s + d.size, 0)

    async function handleClearRag() {
        await fetch(`${API_URL}/api/rag/documents`, { method: "DELETE" })
        setDocs([])
        setConfirmClearRag(false)
    }

    return (
        <div className="flex-1 overflow-y-auto p-5">
            <SectionLabel>Conversations</SectionLabel>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4">
                <Row label="Stockage" value={fmtKb(totalLocalSize)} sub="localStorage du navigateur" />
                <Row label="Conversations" value={`${convCount}`} sub="inkora-conversations" />
                <Row
                    label="Effacer toutes les conversations"
                    value=""
                    action={
                        confirmClearConv ? (
                            <div className="flex items-center gap-2">
                                <button onClick={() => setConfirmClearConv(false)} className="text-[12px] text-[#4A4A58] hover:text-[#8B8B9E]">Annuler</button>
                                <button
                                    onClick={() => { onClearConversations(); setConfirmClearConv(false) }}
                                    className="rounded-[7px] bg-red-500/10 px-2.5 py-1 text-[12px] text-red-400 hover:bg-red-500/20"
                                >
                                    Confirmer
                                </button>
                            </div>
                        ) : (
                            <button onClick={() => setConfirmClearConv(true)} className="rounded-[7px] border border-white/[0.07] px-2.5 py-1 text-[12px] text-[#6A6A7E] transition-colors hover:border-red-500/20 hover:text-red-400">
                                Effacer
                            </button>
                        )
                    }
                />
            </div>

            <SectionLabel>Documents RAG</SectionLabel>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4">
                <Row label="Documents indexés" value={`${ragDocCount}`} sub="in-memory · perdu au restart" />
                <Row label="Chunks" value={`${ragChunkCount}`} sub="~600 caractères chacun" />
                <Row label="Taille totale" value={ragSize > 0 ? fmtKb(ragSize) : "—"} />
                <Row
                    label="Vider le store RAG"
                    value=""
                    action={
                        confirmClearRag ? (
                            <div className="flex items-center gap-2">
                                <button onClick={() => setConfirmClearRag(false)} className="text-[12px] text-[#4A4A58] hover:text-[#8B8B9E]">Annuler</button>
                                <button onClick={handleClearRag} className="rounded-[7px] bg-red-500/10 px-2.5 py-1 text-[12px] text-red-400 hover:bg-red-500/20">
                                    Confirmer
                                </button>
                            </div>
                        ) : (
                            <button onClick={() => setConfirmClearRag(true)} disabled={ragDocCount === 0} className="rounded-[7px] border border-white/[0.07] px-2.5 py-1 text-[12px] text-[#6A6A7E] transition-colors hover:border-red-500/20 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30">
                                Vider
                            </button>
                        )
                    }
                />
            </div>
        </div>
    )
}

// ─── Tab: Serveur ─────────────────────────────────────────────────────────────

type ServerInfo = { port: string; ollamaUrl: string; model: string; version: string }
type OllamaStatus = { ok: boolean; models: string[] } | null

function ServeurTab() {
    const [info, setInfo] = useState<ServerInfo | null>(null)
    const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        setLoading(true)
        Promise.all([
            fetch(`${API_URL}/api/info`).then(r => r.json()) as Promise<ServerInfo>,
            fetch(`${API_URL}/api/ollama/health`).then(r => r.json()) as Promise<OllamaStatus>,
        ])
            .then(([i, o]) => { setInfo(i); setOllamaStatus(o) })
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [])

    if (loading) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <Loader2 size={18} className="animate-spin text-[#3E3E50]" />
            </div>
        )
    }

    const appUrl = `http://localhost:${info?.port ?? "3001"}`

    return (
        <div className="flex-1 overflow-y-auto p-5">
            <SectionLabel>Application</SectionLabel>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4">
                <Row label="Version" value={`v${info?.version ?? "—"}`} />
                <Row
                    label="Serveur backend"
                    value={appUrl}
                    action={<CopyBtn value={appUrl} />}
                />
            </div>

            <SectionLabel>Ollama</SectionLabel>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4">
                <Row
                    label="URL"
                    value={info?.ollamaUrl ?? "—"}
                    action={info?.ollamaUrl ? <CopyBtn value={info.ollamaUrl} /> : undefined}
                />
                <Row label="Modèle actif" value={info?.model ?? "—"} />
                <Row
                    label="Statut"
                    value=""
                    action={
                        ollamaStatus?.ok ? (
                            <span className="flex items-center gap-1.5 text-[12px] text-emerald-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                En ligne · {ollamaStatus.models.length} modèle{ollamaStatus.models.length !== 1 ? "s" : ""}
                            </span>
                        ) : (
                            <span className="flex items-center gap-1.5 text-[12px] text-red-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                                Hors ligne
                            </span>
                        )
                    }
                />
            </div>

            {ollamaStatus?.ok && ollamaStatus.models.length > 0 && (
                <>
                    <SectionLabel>Modèles disponibles</SectionLabel>
                    <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4">
                        {ollamaStatus.models.map((m, i) => (
                            <div key={m} className={`flex items-center justify-between py-2.5 ${i < ollamaStatus.models.length - 1 ? "border-b border-white/[0.04]" : ""}`}>
                                <span className="font-mono text-[12px] text-[#6A6A7E]">{m}</span>
                                {m === info?.model && (
                                    <span className="rounded-full bg-[#6C65E8]/15 px-2 py-0.5 text-[10px] text-[#8B84F2]">actif</span>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}

// ─── Modal shell ──────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
    { id: "assistant", label: "Assistant" },
    { id: "donnees", label: "Données" },
    { id: "serveur", label: "Serveur" },
]

export function SettingsModal({ systemPrompt, onSave, onClose, onClearConversations }: Props) {
    const [tab, setTab] = useState<Tab>("assistant")

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
            <div className="relative z-10 flex w-full max-w-lg flex-col rounded-2xl border border-white/[0.08] bg-[#0E0F12] shadow-2xl" style={{ maxHeight: "min(640px, 90vh)" }}>

                {/* Header */}
                <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-5 py-4">
                    <h2 className="text-[14px] font-semibold text-[#C8C8D4]">Paramètres</h2>
                    <button onClick={onClose} className="rounded-[6px] p-1 text-[#4A4A58] transition-colors hover:bg-white/[0.05] hover:text-[#8B8B9E]">
                        <X size={16} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex shrink-0 gap-1 border-b border-white/[0.06] px-4">
                    {TABS.map(({ id, label }) => (
                        <button
                            key={id}
                            onClick={() => setTab(id)}
                            className={`relative px-3 py-2.5 text-[13px] font-medium transition-colors ${
                                tab === id ? "text-[#C8C8D4]" : "text-[#4A4A58] hover:text-[#8B8B9E]"
                            }`}
                        >
                            {label}
                            {tab === id && (
                                <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-[#6C65E8]" />
                            )}
                        </button>
                    ))}
                </div>

                {/* Tab content */}
                <div className="flex min-h-0 flex-1 flex-col">
                    {tab === "assistant" && (
                        <AssistantTab systemPrompt={systemPrompt} onSave={onSave} onClose={onClose} />
                    )}
                    {tab === "donnees" && (
                        <DonneesTab onClearConversations={onClearConversations} />
                    )}
                    {tab === "serveur" && <ServeurTab />}
                </div>
            </div>
        </div>
    )
}
