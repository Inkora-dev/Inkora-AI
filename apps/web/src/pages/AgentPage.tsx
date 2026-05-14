import { useEffect, useRef, useState } from "react"
import { Bot, ChevronDown, ChevronRight, Folder, Loader2, Play, Square, AlertCircle, GitBranch, Terminal, FileText, FilePen, Search, FolderOpen, Database, Braces, ScanSearch } from "lucide-react"
import { streamAgent, type AgentEvent } from "../lib/agent"
import { MarkdownRenderer } from "../components/MarkdownRenderer"

// ─── Display step types (internal, separate from wire protocol) ───────────────

type DisplayStep =
    | { type: "thought"; content: string }
    | { type: "tool_call"; name: string; args: Record<string, unknown> }
    | { type: "tool_result"; name: string; content: string; isError?: boolean }
    | { type: "answer"; content: string }
    | { type: "error"; content: string }

// ─── Tool metadata ────────────────────────────────────────────────────────────

const TOOL_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    read_file:   { icon: <FileText size={11} />,  label: "Lecture",    color: "text-sky-400 border-sky-500/20 bg-sky-500/[0.04]" },
    write_file:  { icon: <FilePen size={11} />,   label: "Écriture",   color: "text-amber-400 border-amber-500/20 bg-amber-500/[0.04]" },
    list_dir:    { icon: <FolderOpen size={11} />, label: "Dossier",   color: "text-violet-400 border-violet-500/20 bg-violet-500/[0.04]" },
    search_code: { icon: <Search size={11} />,    label: "Recherche",  color: "text-emerald-400 border-emerald-500/20 bg-emerald-500/[0.04]" },
    ast_symbols:     { icon: <Braces size={11} />,     label: "AST",        color: "text-cyan-400 border-cyan-500/20 bg-cyan-500/[0.04]" },
    ast_find_symbol: { icon: <ScanSearch size={11} />, label: "Symbole",    color: "text-indigo-400 border-indigo-500/20 bg-indigo-500/[0.04]" },
    rag_search:      { icon: <Database size={11} />,   label: "RAG",        color: "text-teal-400 border-teal-500/20 bg-teal-500/[0.04]" },
    git_run:     { icon: <GitBranch size={11} />, label: "Git",        color: "text-orange-400 border-orange-500/20 bg-orange-500/[0.04]" },
    shell_run:   { icon: <Terminal size={11} />,  label: "Shell",      color: "text-pink-400 border-pink-500/20 bg-pink-500/[0.04]" },
}

// ─── Step components ──────────────────────────────────────────────────────────

function ThoughtStep({ content }: { content: string }) {
    const [expanded, setExpanded] = useState(false)
    const isLong = content.length > 280

    return (
        <div className="flex items-start gap-3 px-1 opacity-60">
            <span className="mt-0.5 shrink-0 text-base leading-none">💭</span>
            <p className={`text-[12.5px] italic leading-relaxed text-[#5A5A70] ${!expanded && isLong ? "line-clamp-2" : ""}`}>
                {content}
                {isLong && (
                    <button onClick={() => setExpanded((e) => !e)} className="ml-1.5 not-italic text-[#3E3E50] underline underline-offset-2">
                        {expanded ? "moins" : "plus"}
                    </button>
                )}
            </p>
        </div>
    )
}

function ToolCallStep({ name, args }: { name: string; args: Record<string, unknown> }) {
    const meta = TOOL_META[name]
    const argsStr = Object.entries(args)
        .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v.slice(0, 80)}${v.length > 80 ? "…" : ""}"` : JSON.stringify(v)}`)
        .join(", ")

    return (
        <div className={`flex items-center gap-2.5 rounded-xl border px-4 py-2.5 ${meta?.color ?? "text-[#6C65E8] border-[#6C65E8]/20 bg-[#6C65E8]/[0.04]"}`}>
            <span className="shrink-0">{meta?.icon ?? "🔧"}</span>
            <span className="text-[10px] font-semibold uppercase tracking-widest opacity-70">{meta?.label ?? name}</span>
            <code className="min-w-0 truncate font-mono text-[12px] opacity-80">
                {argsStr}
            </code>
        </div>
    )
}

function ToolResultStep({ name, content, isError }: { name: string; content: string; isError?: boolean }) {
    const [expanded, setExpanded] = useState(false)
    const lines = content.split("\n")
    const preview = lines.slice(0, 5).join("\n")
    const hasMore = lines.length > 5

    return (
        <div className={`rounded-xl border px-4 py-3 ${isError ? "border-red-500/20 bg-red-500/[0.04]" : "border-white/[0.05] bg-white/[0.015]"}`}>
            <button className="flex w-full items-center gap-2 text-left" onClick={() => setExpanded((e) => !e)}>
                {expanded ? <ChevronDown size={12} className="shrink-0 text-[#3E3E50]" /> : <ChevronRight size={12} className="shrink-0 text-[#3E3E50]" />}
                <span className={`text-[10px] font-semibold uppercase tracking-widest ${isError ? "text-red-500/60" : "text-[#2E2E3E]"}`}>
                    résultat · {name}
                    {!isError && !expanded && hasMore && <span className="ml-1.5 font-normal normal-case tracking-normal text-[#3E3E50]">{lines.length} lignes</span>}
                </span>
            </button>
            <pre className={`mt-2.5 overflow-x-auto whitespace-pre-wrap text-[11.5px] leading-relaxed ${isError ? "text-red-400" : "text-[#6A6A7E]"}`}>
                {expanded ? content : preview}
                {!expanded && hasMore && <span className="text-[#2E2E3E]"> …</span>}
            </pre>
        </div>
    )
}

function AnswerStep({ content }: { content: string }) {
    return (
        <div className="rounded-xl border border-[#6C65E8]/15 bg-[#6C65E8]/[0.03] px-5 py-4">
            <div className="mb-3 flex items-center gap-2">
                <Bot size={13} className="text-[#6C65E8]" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#6C65E8]/70">Réponse</span>
            </div>
            <div className="text-[13.5px] leading-relaxed text-[#D0D0DA]">
                <MarkdownRenderer content={content} />
            </div>
        </div>
    )
}

function ErrorStep({ content }: { content: string }) {
    return (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3">
            <AlertCircle size={13} className="mt-0.5 shrink-0 text-red-400" />
            <p className="text-[13px] text-red-400">{content}</p>
        </div>
    )
}

// ─── Live streaming display ───────────────────────────────────────────────────

function LiveStep({ text, phase }: { text: string; phase: "thinking" | "answering" }) {
    const isAnswer = phase === "answering"
    return (
        <div className={`rounded-xl border px-4 py-3 ${isAnswer ? "border-[#6C65E8]/15 bg-[#6C65E8]/[0.03]" : "border-white/[0.04] bg-transparent"}`}>
            {isAnswer && (
                <div className="mb-3 flex items-center gap-2">
                    <Bot size={13} className="text-[#6C65E8]" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[#6C65E8]/70">Réponse</span>
                </div>
            )}
            <p className={`text-[13px] leading-relaxed whitespace-pre-wrap ${isAnswer ? "text-[#D0D0DA]" : "italic text-[#4A4A5E]"}`}>
                {text || <span className="opacity-40">…</span>}
                <span className="ml-0.5 inline-block h-[13px] w-[2px] translate-y-[1px] animate-pulse rounded-sm bg-[#6C65E8] align-middle opacity-80" />
            </p>
        </div>
    )
}

// ─── Step renderer ────────────────────────────────────────────────────────────

function StepItem({ step }: { step: DisplayStep }) {
    if (step.type === "thought")     return <ThoughtStep content={step.content} />
    if (step.type === "tool_call")   return <ToolCallStep name={step.name} args={step.args} />
    if (step.type === "tool_result") return <ToolResultStep name={step.name} content={step.content} isError={step.isError} />
    if (step.type === "answer")      return <AnswerStep content={step.content} />
    if (step.type === "error")       return <ErrorStep content={step.content} />
    return null
}

// ─── Quick-start examples ─────────────────────────────────────────────────────

const EXAMPLES = [
    { label: "Explorer le projet",    task: "Explore la structure du projet avec list_dir, puis explique l'architecture globale et le rôle de chaque dossier principal." },
    { label: "Git — état du repo",    task: "Lance git status et git log --oneline -10, puis résume les dernières modifications et l'état actuel du dépôt." },
    { label: "Analyser un fichier",   task: "Lis le fichier package.json (ou le fichier de config principal du projet) et explique les dépendances, scripts et configuration." },
    { label: "Chercher les TODOs",    task: "Cherche tous les TODO, FIXME et HACK dans le code source avec search_code, liste-les et priorise les plus critiques." },
    { label: "Vérifier les erreurs",  task: "Lance les tests ou le linter avec shell_run (npm test, npm run lint, pytest…) et analyse les erreurs éventuelles." },
    { label: "Résumer le code",       task: "Lis les fichiers source principaux et génère un résumé technique du projet : fonctionnalités, patterns utilisés, points d'entrée." },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

type Props = { activeModel: string }

export function AgentPage({ activeModel }: Props) {
    const [task, setTask] = useState("")
    const [workDir, setWorkDir] = useState("")
    const [steps, setSteps] = useState<DisplayStep[]>([])
    const [liveText, setLiveText] = useState("")
    const [livePhase, setLivePhase] = useState<"thinking" | "answering">("thinking")
    const [running, setRunning] = useState(false)
    const abortRef = useRef<AbortController | null>(null)
    const bottomRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [steps, liveText])

    function stop() { abortRef.current?.abort() }

    function handleEvent(event: AgentEvent) {
        if (event.type === "stream_chunk") {
            setLiveText((prev) => prev + event.chunk)
            return
        }
        if (event.type === "stream_commit") {
            setLiveText("")
            if (event.as === "thought" && event.text) {
                setSteps((prev) => [...prev, { type: "thought", content: event.text }])
            } else if (event.as === "answer" && event.text) {
                setSteps((prev) => [...prev, { type: "answer", content: event.text }])
            }
            // After a thought commit, next phase is answering (or another thought — doesn't matter, will be reset)
            setLivePhase(event.as === "answer" ? "answering" : "thinking")
            return
        }
        if (event.type === "tool_call") {
            // Before a tool call, next stream will be thinking again
            setLivePhase("thinking")
            setSteps((prev) => [...prev, event as DisplayStep])
            return
        }
        if (event.type !== "done") {
            setSteps((prev) => [...prev, event as DisplayStep])
        }
    }

    async function handleRun() {
        if (!task.trim() || running) return
        setSteps([])
        setLiveText("")
        setLivePhase("thinking")
        setRunning(true)
        const ctrl = new AbortController()
        abortRef.current = ctrl

        try {
            for await (const event of streamAgent(task.trim(), workDir.trim(), activeModel, ctrl.signal)) {
                if (event.type === "done") break
                handleEvent(event)
            }
        } catch (err) {
            if ((err as Error).name !== "AbortError") {
                setSteps((prev) => [...prev, { type: "error", content: String(err) }])
            }
        } finally {
            setLiveText("")
            setRunning(false)
            abortRef.current = null
        }
    }

    const isEmpty = steps.length === 0 && !liveText && !running

    return (
        <div className="flex h-screen flex-col bg-[#09090B]">

            {/* Header */}
            <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-white/[0.06] px-6">
                <div className="flex items-center gap-2.5">
                    <Bot size={15} className="text-[#6C65E8]" />
                    <h1 className="text-[14px] font-semibold tracking-[-0.01em] text-[#C8C8D4]">Agent Coding</h1>
                    <span className="rounded-full border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[10px] text-[#4A4A5E]">
                        {activeModel || "—"}
                    </span>
                </div>
                {running && (
                    <button
                        onClick={stop}
                        className="flex items-center gap-1.5 rounded-[8px] border border-red-500/20 bg-red-500/[0.07] px-3 py-1.5 text-[12px] font-medium text-red-400 transition-colors hover:bg-red-500/[0.12]"
                    >
                        <Square size={10} fill="currentColor" />
                        Arrêter
                    </button>
                )}
            </header>

            {/* Task input */}
            <div className="shrink-0 border-b border-white/[0.06] px-6 py-4">
                <div className="mx-auto max-w-3xl space-y-3">
                    <textarea
                        value={task}
                        onChange={(e) => setTask(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRun() }}
                        placeholder="Décris une tâche… ex: Analyse l'architecture du projet, Corrige le bug dans api.ts, Ajoute des tests pour le module RAG"
                        rows={3}
                        disabled={running}
                        className="w-full resize-none rounded-xl border border-white/[0.07] bg-[#0E0F12] px-4 py-3 text-[13px] text-[#C8C8D4] placeholder-[#3E3E50] outline-none transition-colors focus:border-[#6C65E8]/30 disabled:opacity-50"
                    />
                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Folder size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3E3E50]" />
                            <input
                                type="text"
                                value={workDir}
                                onChange={(e) => setWorkDir(e.target.value)}
                                placeholder="Répertoire de travail  ex: /home/user/mon-projet"
                                disabled={running}
                                className="w-full rounded-xl border border-white/[0.06] bg-[#0E0F12] py-2 pl-8 pr-4 text-[12px] text-[#8B8B9E] placeholder-[#3E3E50] outline-none transition-colors focus:border-white/[0.10] disabled:opacity-50"
                            />
                        </div>
                        <button
                            onClick={handleRun}
                            disabled={!task.trim() || running}
                            className="flex items-center gap-1.5 rounded-xl bg-[#6C65E8] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#7B74F0] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
                            {running ? "En cours…" : "Lancer"}
                        </button>
                    </div>
                    <p className="text-[11px] text-[#2A2A35]">
                        ⌘↵ pour lancer · Tools: lire, écrire, explorer, git, shell · qwen2.5-coder recommandé
                    </p>
                </div>
            </div>

            {/* Trace */}
            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto max-w-3xl space-y-2.5 px-6 py-6">

                    {/* Empty state with clickable examples */}
                    {isEmpty && (
                        <div className="py-8">
                            <p className="mb-4 text-[11px] font-medium uppercase tracking-widest text-[#2A2A35]">Démarrage rapide</p>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {EXAMPLES.map((ex) => (
                                    <button
                                        key={ex.label}
                                        onClick={() => setTask(ex.task)}
                                        className="group rounded-xl border border-white/[0.05] bg-white/[0.015] px-4 py-3 text-left transition-colors hover:border-[#6C65E8]/25 hover:bg-[#6C65E8]/[0.04]"
                                    >
                                        <p className="text-[12.5px] font-medium text-[#5A5A70] transition-colors group-hover:text-[#8B8B9E]">{ex.label}</p>
                                        <p className="mt-0.5 line-clamp-1 text-[11px] text-[#2E2E3E]">{ex.task}</p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Committed steps */}
                    {steps.map((step, i) => <StepItem key={i} step={step} />)}

                    {/* Live streaming area */}
                    {liveText && <LiveStep text={liveText} phase={livePhase} />}

                    {/* Waiting indicator (between tool results and next Ollama call) */}
                    {running && !liveText && steps.length > 0 && (
                        <div className="flex items-center gap-2 px-1 text-[11px] text-[#2A2A35]">
                            <Loader2 size={11} className="animate-spin" />
                            Réflexion…
                        </div>
                    )}

                    <div ref={bottomRef} />
                </div>
            </div>
        </div>
    )
}
