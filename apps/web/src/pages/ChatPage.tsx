import { useCallback, useEffect, useRef, useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import { AlertTriangle, Check, Download, Menu, Zap } from "lucide-react"
import { ChatInput } from "../components/ChatInput"
import { ChatMessage } from "../components/ChatMessage"
import { DocumentPanel } from "../components/DocumentPanel"
import { sendMessage, fetchTitle } from "../lib/api"
import { loadRagEnabled, saveRagEnabled } from "../lib/storage"
import type { Conversation, Message } from "@inkora/shared"

// ─── Welcome screen suggestions ──────────────────────────────────────────────

const SUGGESTIONS = [
    { icon: "💡", label: "Expliquer un concept", prompt: "Explique-moi le fonctionnement de " },
    { icon: "🐛", label: "Déboguer du code", prompt: "J'ai une erreur dans mon code, peux-tu m'aider ?\n\n```\n\n```" },
    { icon: "✍️", label: "Rédiger du texte", prompt: "Aide-moi à rédiger " },
    { icon: "🔄", label: "Améliorer du code", prompt: "Comment améliorer ou refactoriser ce code ?\n\n```\n\n```" },
    { icon: "📋", label: "Résumer un texte", prompt: "Résume ce texte en points clés :\n\n" },
    { icon: "🔍", label: "Comparer des options", prompt: "Quelles sont les différences entre " },
]

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
    conversation: Conversation
    setConversations: Dispatch<SetStateAction<Conversation[]>>
    onOpenSidebar: () => void
    systemPrompt: string
    activeModel: string
}

export function ChatPage({ conversation, setConversations, onOpenSidebar, systemPrompt, activeModel }: Props) {
    const [loading, setLoading] = useState(false)
    const [exportOpen, setExportOpen] = useState(false)
    const [docsOpen, setDocsOpen] = useState(false)
    const [ragEnabled, setRagEnabled] = useState(() => loadRagEnabled())
    const [editingTitle, setEditingTitle] = useState(false)
    const [titleValue, setTitleValue] = useState(conversation.title)
    const abortRef = useRef<AbortController | null>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const exportRef = useRef<HTMLDivElement>(null)
    const titleInputRef = useRef<HTMLInputElement>(null)
    const titleGeneratedRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [conversation.messages])

    useEffect(() => {
        setTitleValue(conversation.title)
    }, [conversation.title])

    useEffect(() => {
        if (editingTitle) titleInputRef.current?.select()
    }, [editingTitle])

    useEffect(() => {
        if (!exportOpen) return
        const handler = (e: MouseEvent) => {
            if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false)
        }
        document.addEventListener("mousedown", handler)
        return () => document.removeEventListener("mousedown", handler)
    }, [exportOpen])

    // ─── Auto-title after first exchange ─────────────────────────────────────

    useEffect(() => {
        const msgs = conversation.messages
        if (conversation.title !== "Nouveau chat") return
        if (msgs.length !== 3) return
        const lastMsg = msgs[msgs.length - 1]
        if (lastMsg.role !== "assistant" || !lastMsg.content) return
        if (titleGeneratedRef.current.has(conversation.id)) return
        titleGeneratedRef.current.add(conversation.id)

        fetchTitle(msgs.slice(1), activeModel).then((title) => {
            if (!title) return
            setConversations((prev) =>
                prev.map((c) => c.id === conversation.id && c.title === "Nouveau chat" ? { ...c, title } : c)
            )
        })
    }, [conversation.messages.length, conversation.title, conversation.id, activeModel, setConversations])

    // ─── Context window estimate ──────────────────────────────────────────────

    const totalChars = conversation.messages.reduce((s, m) => s + m.content.length, 0)
    const estimatedTokens = Math.round(totalChars / 4)
    const contextWarning = estimatedTokens > 6_000 || conversation.messages.length > 60

    // ─── Actions ─────────────────────────────────────────────────────────────

    function stopGeneration() { abortRef.current?.abort() }

    function toggleRag() {
        setRagEnabled((v) => { saveRagEnabled(!v); return !v })
    }

    function commitTitleEdit() {
        const trimmed = titleValue.trim()
        if (trimmed && trimmed !== conversation.title) {
            setConversations((prev) =>
                prev.map((c) => c.id === conversation.id ? { ...c, title: trimmed } : c)
            )
        } else {
            setTitleValue(conversation.title)
        }
        setEditingTitle(false)
    }

    function exportConversation(format: "json" | "md") {
        const slug = conversation.title.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").slice(0, 50) || "chat"
        let content: string
        let filename: string
        let type: string

        if (format === "json") {
            content = JSON.stringify(conversation, null, 2)
            filename = `${slug}.json`
            type = "application/json"
        } else {
            content = conversation.messages
                .map((m) => `**${m.role === "user" ? "Vous" : "Inkora"}**\n\n${m.content}`)
                .join("\n\n---\n\n")
            filename = `${slug}.md`
            type = "text/markdown"
        }

        const blob = new Blob([content], { type })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url; a.download = filename; a.click()
        URL.revokeObjectURL(url)
        setExportOpen(false)
    }

    // ─── Core streaming logic ─────────────────────────────────────────────────

    const streamResponse = useCallback(async (messagesToSend: Message[]) => {
        setLoading(true)
        const ctrl = new AbortController()
        abortRef.current = ctrl

        try {
            const stream = await sendMessage(messagesToSend, ctrl.signal, {
                systemPrompt: systemPrompt || undefined,
                model: activeModel || undefined,
                ragEnabled: ragEnabled || undefined,
            })
            if (!stream) throw new Error("Aucun stream reçu")

            const reader = stream.getReader()
            const decoder = new TextDecoder()

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                const chunk = decoder.decode(value)
                setConversations((prev) =>
                    prev.map((item) => {
                        if (item.id !== conversation.id) return item
                        const msgs = [...item.messages]
                        const last = msgs[msgs.length - 1]
                        msgs[msgs.length - 1] = { ...last, content: last.content + chunk }
                        return { ...item, messages: msgs }
                    })
                )
            }
        } catch (err) {
            if ((err as Error).name === "AbortError") return
            const detail = (err as Error).message ?? "unknown"
            setConversations((prev) =>
                prev.map((item) => {
                    if (item.id !== conversation.id) return item
                    const msgs = [...item.messages]
                    msgs[msgs.length - 1] = { role: "assistant", content: `Erreur : ${detail}` }
                    return { ...item, messages: msgs }
                })
            )
        } finally {
            setLoading(false)
            abortRef.current = null
        }
    }, [conversation.id, systemPrompt, activeModel, ragEnabled, setConversations])

    async function handleSend(content: string) {
        const userMessage: Message = { role: "user", content }
        const nextMessages = [...conversation.messages, userMessage]
        setConversations((prev) =>
            prev.map((item) =>
                item.id === conversation.id
                    ? {
                        ...item,
                        title: item.title === "Nouveau chat" ? content.slice(0, 40) : item.title,
                        messages: [...nextMessages, { role: "assistant", content: "" }],
                    }
                    : item
            )
        )
        await streamResponse(nextMessages)
    }

    function handleRegenerate(index: number) {
        const messagesForApi = conversation.messages.slice(0, index)
        setConversations((prev) =>
            prev.map((item) =>
                item.id === conversation.id
                    ? { ...item, messages: [...messagesForApi, { role: "assistant", content: "" }] }
                    : item
            )
        )
        streamResponse(messagesForApi)
    }

    function handleEdit(index: number, newContent: string) {
        const edited: Message = { role: "user", content: newContent }
        const messagesForApi = [...conversation.messages.slice(0, index), edited]
        setConversations((prev) =>
            prev.map((item) =>
                item.id === conversation.id
                    ? { ...item, messages: [...messagesForApi, { role: "assistant", content: "" }] }
                    : item
            )
        )
        streamResponse(messagesForApi)
    }

    // ─── Welcome state ────────────────────────────────────────────────────────

    const isWelcome = conversation.messages.length === 1 && conversation.messages[0].role === "assistant"

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="flex h-screen flex-col bg-[#09090B]">

            {/* Header */}
            <header className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-5">
                <div className="flex min-w-0 items-center gap-2">
                    <button
                        onClick={onOpenSidebar}
                        className="rounded-[8px] p-1.5 text-[#4A4A58] transition-colors hover:bg-white/[0.05] hover:text-[#8B8B9E] md:hidden"
                    >
                        <Menu size={18} />
                    </button>

                    {editingTitle ? (
                        <input
                            ref={titleInputRef}
                            value={titleValue}
                            onChange={(e) => setTitleValue(e.target.value)}
                            onBlur={commitTitleEdit}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") commitTitleEdit()
                                if (e.key === "Escape") { setTitleValue(conversation.title); setEditingTitle(false) }
                            }}
                            className="min-w-0 flex-1 rounded-[8px] border border-white/[0.10] bg-white/[0.04] px-2.5 py-1 text-[14px] font-semibold text-[#C8C8D4] outline-none"
                        />
                    ) : (
                        <button
                            onClick={() => setEditingTitle(true)}
                            title="Cliquer pour renommer"
                            className="group flex min-w-0 items-center gap-1.5 rounded-[8px] px-1.5 py-1 transition-colors hover:bg-white/[0.04]"
                        >
                            <h1 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-[#C8C8D4]">
                                {conversation.title}
                            </h1>
                        </button>
                    )}

                    {contextWarning && (
                        <span
                            title={`~${estimatedTokens.toLocaleString("fr-FR")} tokens estimés`}
                            className="flex shrink-0 items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/[0.07] px-2 py-0.5 text-[10px] text-amber-400"
                        >
                            <AlertTriangle size={9} />
                            Contexte
                        </span>
                    )}
                </div>

                {/* Export */}
                <div ref={exportRef} className="relative shrink-0">
                    <button
                        onClick={() => setExportOpen((o) => !o)}
                        className="rounded-[8px] p-1.5 text-[#4A4A58] transition-colors hover:bg-white/[0.05] hover:text-[#8B8B9E]"
                        title="Exporter la conversation"
                    >
                        <Download size={16} />
                    </button>
                    {exportOpen && (
                        <div className="absolute right-0 top-full z-20 mt-1.5 w-[160px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0E0F12] shadow-xl">
                            <button
                                onClick={() => exportConversation("json")}
                                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#8B8B9E] transition-colors hover:bg-white/[0.05] hover:text-[#C8C8D4]"
                            >
                                <Check size={13} className="opacity-0" />
                                JSON
                            </button>
                            <button
                                onClick={() => exportConversation("md")}
                                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#8B8B9E] transition-colors hover:bg-white/[0.05] hover:text-[#C8C8D4]"
                            >
                                <Check size={13} className="opacity-0" />
                                Markdown
                            </button>
                        </div>
                    )}
                </div>
            </header>

            {/* Messages / Welcome */}
            <div className="flex-1 overflow-y-auto">
                {isWelcome ? (
                    /* ── Welcome screen ── */
                    <div className="flex h-full flex-col items-center justify-center px-6 pb-4">
                        <div className="mb-8 flex flex-col items-center gap-4">
                            <div className="flex h-[52px] w-[52px] items-center justify-center rounded-[16px] bg-gradient-to-br from-[#8177F0] to-[#5B52D4] shadow-[0_0_32px_rgba(129,119,240,0.3)]">
                                <Zap size={22} className="text-white" strokeWidth={2.5} />
                            </div>
                            <div className="text-center">
                                <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-[#ECECF0]">
                                    Comment puis-je vous aider ?
                                </h2>
                                <p className="mt-1 text-[13.5px] text-[#4A4A60]">
                                    {activeModel && <span className="text-[#3E3E55]">{activeModel} · </span>}
                                    Posez une question ou choisissez un exemple
                                </p>
                            </div>
                        </div>

                        <div className="w-full max-w-xl grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {SUGGESTIONS.map((s) => (
                                <button
                                    key={s.label}
                                    onClick={() => handleSend(s.prompt)}
                                    className="group flex flex-col gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 text-left transition-all hover:border-[#6C65E8]/30 hover:bg-[#6C65E8]/[0.05]"
                                >
                                    <span className="text-[17px] leading-none">{s.icon}</span>
                                    <span className="text-[12.5px] font-medium text-[#6A6A80] transition-colors group-hover:text-[#9B9BB0]">
                                        {s.label}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    /* ── Chat messages ── */
                    <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">
                        {conversation.messages.map((message, index) => (
                            <ChatMessage
                                key={index}
                                role={message.role}
                                content={message.content}
                                isStreaming={
                                    loading &&
                                    index === conversation.messages.length - 1 &&
                                    message.role === "assistant"
                                }
                                isLoading={loading}
                                onRegenerate={
                                    message.role === "assistant" ? () => handleRegenerate(index) : undefined
                                }
                                onEdit={
                                    message.role === "user" ? (c) => handleEdit(index, c) : undefined
                                }
                            />
                        ))}
                        <div ref={bottomRef} />
                    </div>
                )}
            </div>

            {/* Input */}
            <div className="shrink-0 px-4 pb-5 pt-3">
                <div className="mx-auto max-w-2xl">
                    <ChatInput
                        onSend={handleSend}
                        onStop={stopGeneration}
                        loading={loading}
                        ragEnabled={ragEnabled}
                        onToggleRag={toggleRag}
                        onOpenDocs={() => setDocsOpen(true)}
                    />
                    <p className="mt-2 text-center text-[11px] text-[#252530]">
                        Inkora peut faire des erreurs. Vérifiez les informations importantes.
                    </p>
                </div>
            </div>

            {docsOpen && <DocumentPanel onClose={() => setDocsOpen(false)} />}
        </div>
    )
}
