import { useEffect, useState } from "react"
import { Bot, Check, Copy, Database, Loader2, RotateCcw, Server, X } from "lucide-react"
import { fetchDocuments, deleteDocument } from "../lib/rag"
import type { RagDocument } from "@inkora/shared"
import { API_URL } from "../lib/config"

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = "assistant" | "donnees" | "serveur"

type Props = {
    systemPrompt: string
    onSave: (prompt: string) => void
    onClose: () => void
    onClearConversations: () => void
}

// ─── Shared sub-components ────────────────────────────────────────────────────

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

function Row({ label, value, sub, action }: {
    label: string; value: string; sub?: string; action?: React.ReactNode
}) {
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

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="mb-1 text-[10.5px] font-semibold uppercase tracking-widest text-[#2E2E3E]">
            {children}
        </h3>
    )
}

// ─── Section: Assistant ───────────────────────────────────────────────────────

function AssistantSection({ systemPrompt, onSave, onClose }: {
    systemPrompt: string; onSave: (p: string) => void; onClose: () => void
}) {
    const [value, setValue] = useState(systemPrompt)
    useEffect(() => setValue(systemPrompt), [systemPrompt])

    return (
        <>
            <div className="flex-1 overflow-y-auto p-6">
                <SectionTitle>System prompt</SectionTitle>
                <p className="mb-3 mt-2 text-[12.5px] leading-relaxed text-[#4A4A5E]">
                    Définit le comportement du modèle pour toutes les conversations.
                    Laisse vide pour utiliser le modèle sans instruction particulière.
                </p>
                <textarea
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Tu es un assistant expert en..."
                    rows={10}
                    maxLength={4000}
                    className="w-full resize-none rounded-xl border border-white/[0.08] bg-[#09090B] px-4 py-3 text-[13px] text-[#C8C8D4] placeholder-[#3E3E50] outline-none transition-colors focus:border-[#6C65E8]/40"
                />
                <p className="mt-1.5 text-right text-[11px] text-[#3E3E50]">{value.length} / 4000</p>
            </div>
            <div className="flex shrink-0 items-center justify-between border-t border-white/[0.06] px-6 py-4">
                <button
                    onClick={() => setValue("")}
                    className="flex items-center gap-1.5 text-[12px] text-[#4A4A58] transition-colors hover:text-[#8B8B9E]"
                >
                    <RotateCcw size={12} />
                    Réinitialiser
                </button>
                <div className="flex gap-2">
                    <button
                        onClick={onClose}
                        className="rounded-[8px] border border-white/[0.07] px-3.5 py-1.5 text-[13px] text-[#8B8B9E] transition-colors hover:bg-white/[0.04]"
                    >
                        Annuler
                    </button>
                    <button
                        onClick={() => { onSave(value); onClose() }}
                        className="rounded-[8px] bg-[#6C65E8] px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#7B74F0]"
                    >
                        Enregistrer
                    </button>
                </div>
            </div>
        </>
    )
}

// ─── Section: Données ─────────────────────────────────────────────────────────

function DonneesSection({ onClearConversations }: { onClearConversations: () => void }) {
    const [docs, setDocs] = useState<RagDocument[]>([])
    const [confirmClearConv, setConfirmClearConv] = useState(false)
    const [confirmClearRag, setConfirmClearRag] = useState(false)

    useEffect(() => { fetchDocuments().then(setDocs).catch(() => {}) }, [])

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
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
                <SectionTitle>Conversations</SectionTitle>
                <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4">
                    <Row label="Stockage local" value={fmtKb(totalLocalSize)} sub="localStorage du navigateur" />
                    <Row label="Conversations sauvegardées" value={`${convCount}`} />
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
                                <button
                                    onClick={() => setConfirmClearConv(true)}
                                    className="rounded-[7px] border border-white/[0.07] px-2.5 py-1 text-[12px] text-[#6A6A7E] transition-colors hover:border-red-500/20 hover:text-red-400"
                                >
                                    Effacer
                                </button>
                            )
                        }
                    />
                </div>
            </div>

            <div>
                <SectionTitle>Documents RAG</SectionTitle>
                <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4">
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
                                <button
                                    onClick={() => setConfirmClearRag(true)}
                                    disabled={ragDocCount === 0}
                                    className="rounded-[7px] border border-white/[0.07] px-2.5 py-1 text-[12px] text-[#6A6A7E] transition-colors hover:border-red-500/20 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                                >
                                    Vider
                                </button>
                            )
                        }
                    />
                </div>
            </div>
        </div>
    )
}

// ─── Section: Serveur ─────────────────────────────────────────────────────────

type ServerInfo = { port: string; ollamaUrl: string; model: string; version: string }
type OllamaStatus = { ok: boolean; models: string[] } | null

function ServeurSection() {
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
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
                <SectionTitle>Application</SectionTitle>
                <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4">
                    <Row label="Version" value={`v${info?.version ?? "—"}`} />
                    <Row label="Serveur backend" value={appUrl} action={<CopyBtn value={appUrl} />} />
                </div>
            </div>

            <div>
                <SectionTitle>Ollama</SectionTitle>
                <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4">
                    <Row
                        label="URL"
                        value={info?.ollamaUrl ?? "—"}
                        action={info?.ollamaUrl ? <CopyBtn value={info.ollamaUrl} /> : undefined}
                    />
                    <Row label="Modèle par défaut" value={info?.model ?? "—"} />
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
            </div>

            {ollamaStatus?.ok && ollamaStatus.models.length > 0 && (
                <div>
                    <SectionTitle>Modèles disponibles</SectionTitle>
                    <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.015] px-4">
                        {ollamaStatus.models.map((m, i) => (
                            <div
                                key={m}
                                className={`flex items-center justify-between py-2.5 ${i < ollamaStatus.models.length - 1 ? "border-b border-white/[0.04]" : ""}`}
                            >
                                <span className="font-mono text-[12px] text-[#6A6A7E]">{m}</span>
                                {m === info?.model && (
                                    <span className="rounded-full bg-[#6C65E8]/15 px-2 py-0.5 text-[10px] text-[#8B84F2]">actif</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Sidebar nav items ────────────────────────────────────────────────────────

const NAV: { id: Section; label: string; icon: React.ReactNode; description: string }[] = [
    {
        id: "assistant",
        label: "Assistant",
        icon: <Bot size={15} strokeWidth={1.7} />,
        description: "System prompt, comportement",
    },
    {
        id: "donnees",
        label: "Données",
        icon: <Database size={15} strokeWidth={1.7} />,
        description: "Conversations, RAG",
    },
    {
        id: "serveur",
        label: "Serveur",
        icon: <Server size={15} strokeWidth={1.7} />,
        description: "Ollama, connexion",
    },
]

// ─── Modal ────────────────────────────────────────────────────────────────────

export function SettingsModal({ systemPrompt, onSave, onClose, onClearConversations }: Props) {
    const [section, setSection] = useState<Section>("assistant")

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
        document.addEventListener("keydown", handler)
        return () => document.removeEventListener("keydown", handler)
    }, [onClose])

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

            {/* Modal */}
            <div
                className="relative z-10 flex w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0E0F12] shadow-[0_32px_80px_rgba(0,0,0,0.7)]"
                style={{ maxWidth: "780px", height: "min(680px, 90vh)" }}
            >
                {/* Sidebar */}
                <aside className="flex w-[210px] shrink-0 flex-col border-r border-white/[0.06] bg-[#09090B]">
                    <div className="flex h-[60px] shrink-0 items-center px-5">
                        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#C8C8D4]">
                            Paramètres
                        </h2>
                    </div>

                    <nav className="flex-1 overflow-y-auto px-2 pb-4">
                        {NAV.map(({ id, label, icon, description }) => (
                            <button
                                key={id}
                                onClick={() => setSection(id)}
                                className={`relative flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors duration-100 ${
                                    section === id
                                        ? "bg-white/[0.07] text-[#ECECF0]"
                                        : "text-[#6A6A7E] hover:bg-white/[0.04] hover:text-[#A0A0B4]"
                                }`}
                            >
                                {section === id && (
                                    <div className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-[#7B70EE]" />
                                )}
                                <span className={section === id ? "text-[#7B70EE]" : ""}>{icon}</span>
                                <div className="min-w-0">
                                    <p className="text-[13px] font-medium leading-none">{label}</p>
                                    <p className="mt-0.5 truncate text-[11px] opacity-50">{description}</p>
                                </div>
                            </button>
                        ))}
                    </nav>

                    {/* Sidebar footer */}
                    <div className="shrink-0 border-t border-white/[0.04] px-5 py-3">
                        <p className="text-[11px] text-[#2A2A38]">inkora · local & privé</p>
                    </div>
                </aside>

                {/* Content */}
                <div className="flex min-w-0 flex-1 flex-col">
                    {/* Content header */}
                    <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-white/[0.06] px-6">
                        <h3 className="text-[14px] font-semibold text-[#C8C8D4]">
                            {NAV.find((n) => n.id === section)?.label}
                        </h3>
                        <button
                            onClick={onClose}
                            className="rounded-[8px] p-1.5 text-[#4A4A58] transition-colors hover:bg-white/[0.05] hover:text-[#8B8B9E]"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Section content */}
                    <div className="flex min-h-0 flex-1 flex-col">
                        {section === "assistant" && (
                            <AssistantSection systemPrompt={systemPrompt} onSave={onSave} onClose={onClose} />
                        )}
                        {section === "donnees" && (
                            <DonneesSection onClearConversations={onClearConversations} />
                        )}
                        {section === "serveur" && <ServeurSection />}
                    </div>
                </div>
            </div>
        </div>
    )
}
