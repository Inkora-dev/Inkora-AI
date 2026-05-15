import { useRef, useState } from "react"
import { ArrowUp, BookOpen, Database, Square } from "lucide-react"

type ChatInputProps = {
    onSend: (message: string) => void
    onStop: () => void
    loading?: boolean
    ragEnabled?: boolean
    onToggleRag?: () => void
    onOpenDocs?: () => void
}

export function ChatInput({ onSend, onStop, loading, ragEnabled, onToggleRag, onOpenDocs }: ChatInputProps) {
    const [value, setValue] = useState("")
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    function autoResize() {
        const el = textareaRef.current
        if (!el) return
        el.style.height = "auto"
        el.style.height = Math.min(el.scrollHeight, 200) + "px"
    }

    function submit() {
        const trimmed = value.trim()
        if (!trimmed || loading) return
        onSend(trimmed)
        setValue("")
        if (textareaRef.current) textareaRef.current.style.height = "auto"
    }

    const canSend = value.trim().length > 0 && !loading

    return (
        <div className="overflow-hidden rounded-2xl border border-white/[0.09] bg-[#111115] shadow-[0_4px_24px_rgba(0,0,0,0.4)] transition-colors focus-within:border-white/[0.15]">
            {/* Textarea */}
            <div className="px-4 pt-3.5 pb-2">
                <textarea
                    ref={textareaRef}
                    value={value}
                    onChange={(e) => { setValue(e.target.value); autoResize() }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit() }
                    }}
                    placeholder="Message Inkora…"
                    rows={1}
                    disabled={loading}
                    style={{ resize: "none", lineHeight: "1.6" }}
                    className="max-h-[200px] w-full bg-transparent text-[13.5px] text-[#E0E0E8] placeholder-[#3A3A50] outline-none disabled:opacity-60"
                />
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between border-t border-white/[0.05] px-3 py-2">
                <div className="flex items-center gap-1">
                    {onOpenDocs && (
                        <button
                            onClick={onOpenDocs}
                            title="Gérer les documents RAG"
                            className="flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11.5px] font-medium text-[#4A4A60] transition-colors hover:bg-white/[0.05] hover:text-[#8B8B9E]"
                        >
                            <BookOpen size={13} strokeWidth={1.7} />
                            <span>Docs</span>
                        </button>
                    )}
                    {onToggleRag !== undefined && (
                        <button
                            onClick={onToggleRag}
                            title={ragEnabled ? "Désactiver le RAG" : "Activer le RAG"}
                            className={`flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11.5px] font-medium transition-colors ${
                                ragEnabled
                                    ? "bg-[#6C65E8]/[0.12] text-[#9B96F0] hover:bg-[#6C65E8]/[0.18]"
                                    : "text-[#4A4A60] hover:bg-white/[0.05] hover:text-[#8B8B9E]"
                            }`}
                        >
                            <Database size={13} strokeWidth={1.7} />
                            <span>RAG</span>
                            {ragEnabled && (
                                <span className="h-1.5 w-1.5 rounded-full bg-[#6C65E8]" />
                            )}
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2.5">
                    <span className="hidden text-[11px] text-[#2A2A38] sm:block">
                        Shift+↵ retour à la ligne
                    </span>
                    {loading ? (
                        <button
                            onClick={onStop}
                            className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[10px] bg-white/[0.08] text-[#8B8B9E] transition-colors hover:bg-white/[0.13] hover:text-[#ECECF0]"
                            title="Arrêter"
                        >
                            <Square size={12} className="fill-current" />
                        </button>
                    ) : (
                        <button
                            onClick={submit}
                            disabled={!canSend}
                            className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[10px] bg-[#6C65E8] text-white shadow-[0_0_14px_rgba(108,101,232,0.4)] transition-all duration-150 hover:bg-[#7B75EE] disabled:bg-white/[0.05] disabled:text-[#2E2E3E] disabled:shadow-none"
                            title="Envoyer (↵)"
                        >
                            <ArrowUp size={15} strokeWidth={2.3} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
