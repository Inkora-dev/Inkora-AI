import { useRef } from "react"
import { useState } from "react"
import { ArrowUp, Square } from "lucide-react"

type ChatInputProps = {
    onSend: (message: string) => void
    onStop: () => void
    loading?: boolean
}

export function ChatInput({ onSend, onStop, loading }: ChatInputProps) {
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
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto"
        }
    }

    const canSend = value.trim().length > 0 && !loading

    return (
        <div className="flex items-end gap-3 rounded-xl border border-white/[0.08] bg-[#111115] px-4 py-3 transition-colors focus-within:border-white/[0.13]">
            <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => {
                    setValue(e.target.value)
                    autoResize()
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        submit()
                    }
                }}
                placeholder="Message Inkora…"
                rows={1}
                disabled={loading}
                style={{ resize: "none", lineHeight: "1.5" }}
                className="max-h-[200px] flex-1 bg-transparent text-[13.5px] text-[#E0E0E8] placeholder-[#3E3E50] outline-none disabled:opacity-60"
            />

            {loading ? (
                <button
                    onClick={onStop}
                    className="mb-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-white/[0.08] text-[#8B8B9E] transition-colors hover:bg-white/[0.13] hover:text-[#ECECF0]"
                    title="Stop"
                >
                    <Square size={13} className="fill-current" />
                </button>
            ) : (
                <button
                    onClick={submit}
                    disabled={!canSend}
                    className="mb-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-[#6C65E8] text-white shadow-[0_0_12px_rgba(108,101,232,0.35)] transition-all duration-150 hover:bg-[#7B75EE] disabled:bg-white/[0.06] disabled:text-[#3E3E50] disabled:shadow-none"
                    title="Envoyer"
                >
                    <ArrowUp size={15} strokeWidth={2.2} />
                </button>
            )}
        </div>
    )
}
