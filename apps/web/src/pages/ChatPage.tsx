import { useCallback, useEffect, useRef, useState } from "react"
import type { Dispatch, SetStateAction } from "react"
import { AlertTriangle, BookOpen, Check, Download, Menu } from "lucide-react"
import { ChatInput } from "../components/ChatInput"
import { ChatMessage } from "../components/ChatMessage"
import { DocumentPanel } from "../components/DocumentPanel"
import { sendMessage, fetchTitle } from "../lib/api"
import { loadRagEnabled, saveRagEnabled } from "../lib/storage"
import type { Conversation, Message } from "@inkora/shared"

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
    const abortRef = useRef<AbortController | null>(null)
    const bottomRef = useRef<HTMLDivElement>(null)
    const exportRef = useRef<HTMLDivElement>(null)
    const titleGeneratedRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [conversation.messages])

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
        // Trigger on 3rd message (greeting + user + first assistant response)
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

    function stopGeneration() {
        abortRef.current?.abort()
    }

    function toggleRag() {
        setRagEnabled((v) => {
            saveRagEnabled(!v)
            return !v
        })
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
        a.href = url
        a.download = filename
        a.click()
        URL.revokeObjectURL(url)
        setExportOpen(false)
    }

    // ─── Core streaming logic ────────────────────────────────────────────────

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
            console.error("[inkora] chat error:", detail)
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

    // ─── Actions ─────────────────────────────────────────────────────────────

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

    // ─── Render ──────────────────────────────────────────────────────────────

    const title = conversation.title === "Nouveau chat" ? "Nouveau chat" : conversation.title

    return (
        <div className="flex h-screen flex-col bg-[#09090B]">

            {/* Header */}
            <header className="flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-6">
                <div className="flex min-w-0 items-center gap-3">
                    <button
                        onClick={onOpenSidebar}
                        className="rounded-[8px] p-1.5 text-[#4A4A58] transition-colors hover:bg-white/[0.05] hover:text-[#8B8B9E] md:hidden"
                    >
                        <Menu size={18} />
                    </button>
                    <h1 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-[#C8C8D4]">
                        {title}
                    </h1>
                    {contextWarning && (
                        <span
                            title={`~${estimatedTokens.toLocaleString("fr-FR")} tokens estimés — contexte presque plein`}
                            className="flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/[0.07] px-2 py-0.5 text-[10px] text-amber-400"
                        >
                            <AlertTriangle size={9} />
                            Contexte
                        </span>
                    )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                    {/* RAG docs */}
                    <button
                        onClick={() => setDocsOpen(true)}
                        title="Documents RAG"
                        className="rounded-[8px] p-1.5 text-[#4A4A58] transition-colors hover:bg-white/[0.05] hover:text-[#8B8B9E]"
                    >
                        <BookOpen size={16} />
                    </button>
                    {/* RAG toggle */}
                    <button
                        onClick={toggleRag}
                        title={ragEnabled ? "Désactiver RAG" : "Activer RAG"}
                        className={`rounded-[8px] px-2 py-1 text-[11px] font-medium transition-colors ${
                            ragEnabled
                                ? "bg-[#6C65E8]/20 text-[#8B8B9E]"
                                : "text-[#3E3E50] hover:bg-white/[0.04] hover:text-[#6A6A7E]"
                        }`}
                    >
                        RAG
                    </button>

                    {/* Export */}
                    <div ref={exportRef} className="relative">
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
                </div>
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto">
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
                                message.role === "assistant"
                                    ? () => handleRegenerate(index)
                                    : undefined
                            }
                            onEdit={
                                message.role === "user"
                                    ? (newContent) => handleEdit(index, newContent)
                                    : undefined
                            }
                        />
                    ))}
                    <div ref={bottomRef} />
                </div>
            </div>

            {/* Input */}
            <div className="border-t border-white/[0.06] px-6 py-4">
                <div className="mx-auto max-w-2xl">
                    <ChatInput
                        onSend={handleSend}
                        onStop={stopGeneration}
                        loading={loading}
                    />
                </div>
            </div>

            {docsOpen && <DocumentPanel onClose={() => setDocsOpen(false)} />}
        </div>
    )
}
