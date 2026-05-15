import { useEffect, useRef, useState } from "react"
import {
    Bot, ChevronDown, ChevronRight, Loader2, Play, Square, AlertCircle,
    Terminal, Globe, RefreshCw, StopCircle, PlayCircle, List, BarChart2, Search, Cpu,
} from "lucide-react"
import { streamAutomation, type AgentEvent } from "../lib/automation"
import { MarkdownRenderer } from "../components/MarkdownRenderer"

// ─── Display step types ───────────────────────────────────────────────────────

type DisplayStep =
    | { type: "thought"; content: string }
    | { type: "tool_call"; name: string; args: Record<string, unknown> }
    | { type: "tool_result"; name: string; content: string; isError?: boolean }
    | { type: "answer"; content: string }
    | { type: "error"; content: string }

// ─── Tool metadata ────────────────────────────────────────────────────────────

const TOOL_META: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    docker_ps:      { icon: <List size={11} />,       label: "Conteneurs",  color: "text-sky-400 border-sky-500/20 bg-sky-500/[0.04]" },
    docker_logs:    { icon: <Terminal size={11} />,    label: "Logs",        color: "text-violet-400 border-violet-500/20 bg-violet-500/[0.04]" },
    docker_stats:   { icon: <BarChart2 size={11} />,   label: "Stats",       color: "text-emerald-400 border-emerald-500/20 bg-emerald-500/[0.04]" },
    docker_inspect: { icon: <Search size={11} />,      label: "Inspect",     color: "text-cyan-400 border-cyan-500/20 bg-cyan-500/[0.04]" },
    docker_restart: { icon: <RefreshCw size={11} />,   label: "Restart",     color: "text-amber-400 border-amber-500/20 bg-amber-500/[0.04]" },
    docker_stop:    { icon: <StopCircle size={11} />,  label: "Stop",        color: "text-red-400 border-red-500/20 bg-red-500/[0.04]" },
    docker_start:   { icon: <PlayCircle size={11} />,  label: "Start",       color: "text-green-400 border-green-500/20 bg-green-500/[0.04]" },
    http_request:   { icon: <Globe size={11} />,       label: "HTTP",        color: "text-indigo-400 border-indigo-500/20 bg-indigo-500/[0.04]" },
    system_info:    { icon: <Cpu size={11} />,         label: "Système",     color: "text-teal-400 border-teal-500/20 bg-teal-500/[0.04]" },
}

// ─── Step components (same design as AgentPage) ───────────────────────────────

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
            <code className="min-w-0 truncate font-mono text-[12px] opacity-80">{argsStr}</code>
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
        <div className="rounded-xl border border-[#3B7C59]/20 bg-[#3B7C59]/[0.03] px-5 py-4">
            <div className="mb-3 flex items-center gap-2">
                <Bot size={13} className="text-[#4CAF82]" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-[#4CAF82]/70">Réponse</span>
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

function LiveStep({ text, phase }: { text: string; phase: "thinking" | "answering" }) {
    const isAnswer = phase === "answering"
    return (
        <div className={`rounded-xl border px-4 py-3 ${isAnswer ? "border-[#3B7C59]/20 bg-[#3B7C59]/[0.03]" : "border-white/[0.04] bg-transparent"}`}>
            {isAnswer && (
                <div className="mb-3 flex items-center gap-2">
                    <Bot size={13} className="text-[#4CAF82]" />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[#4CAF82]/70">Réponse</span>
                </div>
            )}
            <p className={`text-[13px] leading-relaxed whitespace-pre-wrap ${isAnswer ? "text-[#D0D0DA]" : "italic text-[#4A4A5E]"}`}>
                {text || <span className="opacity-40">…</span>}
                <span className="ml-0.5 inline-block h-[13px] w-[2px] translate-y-[1px] animate-pulse rounded-sm bg-[#4CAF82] align-middle opacity-80" />
            </p>
        </div>
    )
}

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
    { label: "État des conteneurs",     task: "Liste tous les conteneurs Docker avec leur état, image et ports exposés. Signale les conteneurs arrêtés ou en erreur." },
    { label: "Stats ressources",        task: "Affiche l'utilisation CPU et mémoire de tous les conteneurs actifs. Identifie ceux qui consomment le plus." },
    { label: "Diagnostiquer un crash",  task: "Cherche les conteneurs arrêtés ou en erreur avec docker_ps, puis lis leurs logs pour identifier la cause du problème." },
    { label: "Espace disque",           task: "Vérifie l'espace disque disponible avec system_info et liste les conteneurs Docker qui pourraient générer des logs volumineux." },
    { label: "Inspecter un conteneur",  task: "Inspecte le premier conteneur trouvé avec docker_ps : volumes montés, variables d'environnement, configuration réseau." },
    { label: "Santé globale homelab",   task: "Fais un audit complet : docker_ps pour les conteneurs, system_info pour le disque et la mémoire, puis donne un rapport de santé global." },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

type Props = { activeModel: string }

export function AutomationPage({ activeModel }: Props) {
    const [task, setTask] = useState("")
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
            setLivePhase(event.as === "answer" ? "answering" : "thinking")
            return
        }
        if (event.type === "tool_call") {
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
            for await (const event of streamAutomation(task.trim(), activeModel, ctrl.signal)) {
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
                    <Terminal size={15} className="text-[#4CAF82]" />
                    <h1 className="text-[14px] font-semibold tracking-[-0.01em] text-[#C8C8D4]">Agent Homelab</h1>
                    <span className="rounded-full border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[10px] text-[#4A4A5E]">
                        {activeModel || "—"}
                    </span>
                    <span className="rounded-full border border-[#4CAF82]/20 bg-[#4CAF82]/[0.05] px-2 py-0.5 text-[10px] text-[#4CAF82]/70">
                        Docker · HTTP
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
                        placeholder="Décris une tâche homelab… ex: Liste les conteneurs Docker en erreur, Vérifie les logs de nginx, Quel conteneur consomme le plus de RAM ?"
                        rows={3}
                        disabled={running}
                        className="w-full resize-none rounded-xl border border-white/[0.07] bg-[#0E0F12] px-4 py-3 text-[13px] text-[#C8C8D4] placeholder-[#3E3E50] outline-none transition-colors focus:border-[#4CAF82]/30 disabled:opacity-50"
                    />
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleRun}
                            disabled={!task.trim() || running}
                            className="flex items-center gap-1.5 rounded-xl bg-[#2D6B4A] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#3A8A5E] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} fill="currentColor" />}
                            {running ? "En cours…" : "Lancer"}
                        </button>
                        <p className="text-[11px] text-[#2A2A35]">
                            ⌘↵ pour lancer · Tools: docker ps/logs/stats/inspect/restart · HTTP interne
                        </p>
                    </div>
                </div>
            </div>

            {/* Trace */}
            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto max-w-3xl space-y-2.5 px-6 py-6">

                    {isEmpty && (
                        <div className="py-8">
                            <p className="mb-4 text-[11px] font-medium uppercase tracking-widest text-[#2A2A35]">Démarrage rapide</p>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {EXAMPLES.map((ex) => (
                                    <button
                                        key={ex.label}
                                        onClick={() => setTask(ex.task)}
                                        className="group rounded-xl border border-white/[0.05] bg-white/[0.015] px-4 py-3 text-left transition-colors hover:border-[#4CAF82]/25 hover:bg-[#4CAF82]/[0.04]"
                                    >
                                        <p className="text-[12.5px] font-medium text-[#5A5A70] transition-colors group-hover:text-[#8B8B9E]">{ex.label}</p>
                                        <p className="mt-0.5 line-clamp-1 text-[11px] text-[#2E2E3E]">{ex.task}</p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {steps.map((step, i) => <StepItem key={i} step={step} />)}

                    {liveText && <LiveStep text={liveText} phase={livePhase} />}

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
