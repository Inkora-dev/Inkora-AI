import { useState } from "react"
import { Copy, Check } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"

type Props = { content: string }

export function MarkdownRenderer({ content }: Props) {
    const [copiedId, setCopiedId] = useState<string | null>(null)

    function copyCode(code: string, id: string) {
        navigator.clipboard.writeText(code)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    return (
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
                code({ children, className }) {
                    const match = /language-(\w+)/.exec(className || "")
                    const codeStr = String(children).replace(/\n$/, "")

                    if (!match) {
                        return (
                            <code className="rounded-md bg-white/[0.07] px-1.5 py-0.5 font-mono text-[12.5px] text-[#C4BEFF]">
                                {children}
                            </code>
                        )
                    }

                    const id = match[1] + "-" + codeStr.slice(0, 24)
                    const copied = copiedId === id

                    return (
                        <div className="my-4 overflow-hidden rounded-xl border border-white/[0.07]">
                            <div className="flex items-center justify-between border-b border-white/[0.07] bg-[#0C0C0F] px-4 py-2">
                                <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-[#4A4A5E]">
                                    {match[1]}
                                </span>
                                <button
                                    onClick={() => copyCode(codeStr, id)}
                                    className="flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11px] text-[#4A4A5E] transition-colors hover:bg-white/[0.06] hover:text-[#8B8B9E]"
                                >
                                    {copied ? (
                                        <>
                                            <Check size={11} className="text-[#6C65E8]" />
                                            <span className="text-[#6C65E8]">Copié</span>
                                        </>
                                    ) : (
                                        <>
                                            <Copy size={11} />
                                            <span>Copier</span>
                                        </>
                                    )}
                                </button>
                            </div>
                            <SyntaxHighlighter
                                style={oneDark}
                                language={match[1]}
                                PreTag="div"
                                customStyle={{
                                    background: "#0C0C0F",
                                    margin: 0,
                                    padding: "16px",
                                    fontSize: "12.5px",
                                    lineHeight: "1.7",
                                }}
                                codeTagProps={{
                                    style: { fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" },
                                }}
                            >
                                {codeStr}
                            </SyntaxHighlighter>
                        </div>
                    )
                },

                p({ children }) {
                    return <p className="mb-3 last:mb-0">{children}</p>
                },
                ul({ children }) {
                    return <ul className="mb-3 list-disc space-y-1 pl-4">{children}</ul>
                },
                ol({ children }) {
                    return <ol className="mb-3 list-decimal space-y-1 pl-4">{children}</ol>
                },
                li({ children }) {
                    return <li>{children}</li>
                },
                strong({ children }) {
                    return <strong className="font-semibold text-[#E8E8F0]">{children}</strong>
                },
                em({ children }) {
                    return <em className="italic text-[#B8B8C8]">{children}</em>
                },
                h1({ children }) {
                    return <h1 className="mb-3 mt-5 text-[17px] font-semibold tracking-tight text-[#ECECF0]">{children}</h1>
                },
                h2({ children }) {
                    return <h2 className="mb-2 mt-4 text-[15px] font-semibold tracking-tight text-[#ECECF0]">{children}</h2>
                },
                h3({ children }) {
                    return <h3 className="mb-2 mt-3 text-[13.5px] font-semibold text-[#ECECF0]">{children}</h3>
                },
                blockquote({ children }) {
                    return (
                        <blockquote className="my-3 border-l-2 border-[#6C65E8]/40 pl-4 text-[#7A7A8C] italic">
                            {children}
                        </blockquote>
                    )
                },
                hr() {
                    return <hr className="my-4 border-white/[0.08]" />
                },
                a({ children, href }) {
                    return (
                        <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#8B87F0] underline decoration-[#8B87F0]/30 underline-offset-2 hover:text-[#A8A5F5] hover:decoration-[#A8A5F5]/50"
                        >
                            {children}
                        </a>
                    )
                },
                table({ children }) {
                    return (
                        <div className="my-4 overflow-x-auto rounded-xl border border-white/[0.07]">
                            <table className="w-full text-[13px]">{children}</table>
                        </div>
                    )
                },
                th({ children }) {
                    return <th className="border-b border-white/[0.07] bg-white/[0.03] px-4 py-2.5 text-left text-[12px] font-medium uppercase tracking-wider text-[#6A6A7A]">{children}</th>
                },
                td({ children }) {
                    return <td className="border-b border-white/[0.05] px-4 py-2.5 text-[#C0C0CC] last:border-0">{children}</td>
                },
            }}
        >
            {content}
        </ReactMarkdown>
    )
}
