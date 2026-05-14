import { lazy, Suspense, useState } from "react"
import { motion } from "framer-motion"
import { Check, Copy, Pencil, RotateCcw, Sparkles } from "lucide-react"

const MarkdownRenderer = lazy(() =>
    import("./MarkdownRenderer").then((m) => ({ default: m.MarkdownRenderer }))
)

type Props = {
    role: "user" | "assistant"
    content: string
    isStreaming?: boolean
    isLoading?: boolean
    onRegenerate?: () => void
    onEdit?: (newContent: string) => void
}

// ─── Small action button ──────────────────────────────────────────────────────

function ActionBtn({
    onClick,
    title,
    children,
}: {
    onClick: () => void
    title: string
    children: React.ReactNode
}) {
    return (
        <button
            onClick={onClick}
            title={title}
            className="rounded-[6px] p-1.5 text-[#3A3A4A] transition-colors hover:bg-white/[0.05] hover:text-[#8B8B9E]"
        >
            {children}
        </button>
    )
}

// ─── Copy hook ────────────────────────────────────────────────────────────────

function useCopy(text: string) {
    const [copied, setCopied] = useState(false)
    function copy() {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }
    return { copied, copy }
}

// ─── ThinkingDots ─────────────────────────────────────────────────────────────

function ThinkingDots() {
    return (
        <div className="flex items-center gap-1 pt-1">
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    className="h-[5px] w-[5px] rounded-full bg-[#4A4A60]"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                />
            ))}
        </div>
    )
}

// ─── User message ─────────────────────────────────────────────────────────────

function UserMessage({ content, isLoading, onEdit }: {
    content: string
    isLoading?: boolean
    onEdit?: (newContent: string) => void
}) {
    const { copied, copy } = useCopy(content)
    const [editing, setEditing] = useState(false)
    const [editValue, setEditValue] = useState(content)

    function saveEdit() {
        const trimmed = editValue.trim()
        if (trimmed) onEdit?.(trimmed)
        setEditing(false)
    }

    if (editing) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="flex justify-end"
            >
                <div className="w-full max-w-[72%]">
                    <textarea
                        value={editValue}
                        autoFocus
                        rows={Math.min(editValue.split("\n").length + 1, 10)}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit()
                            if (e.key === "Escape") { setEditValue(content); setEditing(false) }
                        }}
                        className="w-full resize-none rounded-2xl rounded-tr-[6px] border border-[#6C65E8]/30 bg-[#18181F] px-4 py-3 text-[13.5px] leading-relaxed text-[#E0E0E8] outline-none"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                        <button
                            onClick={() => { setEditValue(content); setEditing(false) }}
                            className="rounded-[8px] px-3 py-1 text-[12px] text-[#4A4A58] transition-colors hover:text-[#8B8B9E]"
                        >
                            Annuler
                        </button>
                        <button
                            onClick={saveEdit}
                            className="rounded-[8px] bg-[#6C65E8] px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-[#7B74F0]"
                        >
                            Envoyer
                        </button>
                    </div>
                </div>
            </motion.div>
        )
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="group flex flex-col items-end gap-1"
        >
            <div className="max-w-[72%] rounded-2xl rounded-tr-[6px] border border-white/[0.08] bg-[#18181F] px-4 py-3 text-[13.5px] leading-relaxed text-[#E0E0E8]">
                {content}
            </div>
            {!isLoading && (
                <div className="flex gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
                    <ActionBtn onClick={copy} title="Copier">
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                    </ActionBtn>
                    {onEdit && (
                        <ActionBtn onClick={() => { setEditValue(content); setEditing(true) }} title="Modifier et renvoyer">
                            <Pencil size={12} />
                        </ActionBtn>
                    )}
                </div>
            )}
        </motion.div>
    )
}

// ─── Assistant message ────────────────────────────────────────────────────────

function AssistantMessage({ content, isStreaming, isLoading, onRegenerate }: {
    content: string
    isStreaming?: boolean
    isLoading?: boolean
    onRegenerate?: () => void
}) {
    const { copied, copy } = useCopy(content)
    const isEmpty = !content && isStreaming

    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="group flex gap-3"
        >
            <div className="mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] border border-[#7B70EE]/25 bg-[#7B70EE]/[0.12]">
                <Sparkles size={12} className="text-[#7B70EE]" strokeWidth={1.8} />
            </div>

            <div className="min-w-0 flex-1 pt-0.5">
                {isEmpty ? (
                    <ThinkingDots />
                ) : (
                    <div className="text-[13.5px] leading-relaxed text-[#D0D0DA]">
                        <Suspense fallback={<span className="text-[#4A4A58] text-xs">…</span>}>
                            <MarkdownRenderer content={content} />
                        </Suspense>
                    </div>
                )}

                {!isStreaming && content && !isLoading && (
                    <div className="mt-2 flex gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
                        <ActionBtn onClick={copy} title="Copier">
                            {copied ? <Check size={12} /> : <Copy size={12} />}
                        </ActionBtn>
                        {onRegenerate && (
                            <ActionBtn onClick={onRegenerate} title="Régénérer">
                                <RotateCcw size={12} />
                            </ActionBtn>
                        )}
                    </div>
                )}
            </div>
        </motion.div>
    )
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function ChatMessage({ role, content, isStreaming, isLoading, onRegenerate, onEdit }: Props) {
    if (role === "user") {
        return <UserMessage content={content} isLoading={isLoading} onEdit={onEdit} />
    }
    return (
        <AssistantMessage
            content={content}
            isStreaming={isStreaming}
            isLoading={isLoading}
            onRegenerate={onRegenerate}
        />
    )
}
