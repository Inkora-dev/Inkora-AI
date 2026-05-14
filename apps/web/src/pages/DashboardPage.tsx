import { useCallback, useEffect, useState } from "react"
import { Activity, Clock, Cpu, MessageSquare, RefreshCw, Thermometer, Zap } from "lucide-react"
import { fetchMetrics, fetchSystem } from "../lib/stats"
import type { MetricsResponse, SystemStats } from "@inkora/shared"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB"
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + " MB"
    return (bytes / 1e3).toFixed(0) + " KB"
}

function fmtMs(ms: number) {
    if (ms === 0) return "—"
    if (ms >= 1000) return (ms / 1000).toFixed(2) + "s"
    return ms + " ms"
}

function fmtToks(n: number) {
    if (n === 0) return "—"
    return n.toFixed(1) + " t/s"
}

function fmtNum(n: number) {
    return n.toLocaleString("fr-FR")
}

function fmtTime(ts: number) {
    return new Date(ts).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    })
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
    icon: Icon,
    label,
    value,
    sub,
    accent = false,
}: {
    icon: React.ElementType
    label: string
    value: string
    sub?: string
    accent?: boolean
}) {
    return (
        <div className="rounded-xl border border-white/[0.07] bg-[#0E0F12] p-5">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-[#4A4A5E]">
                <Icon size={13} strokeWidth={1.8} />
                {label}
            </div>
            <div className={`text-[26px] font-semibold tracking-tight ${accent ? "text-[#7B70EE]" : "text-[#ECECF0]"}`}>
                {value}
            </div>
            {sub && <div className="mt-1 text-[12px] text-[#4A4A5E]">{sub}</div>}
        </div>
    )
}

function GaugeBar({ value, color }: { value: number; color: string }) {
    const clamped = Math.min(Math.max(value, 0), 100)
    const barColor =
        clamped > 85 ? "#EF4444" :
        clamped > 60 ? "#F59E0B" :
        color

    return (
        <div className="mt-3 space-y-1.5">
            <div className="flex justify-between text-[12px]">
                <span className="text-[#4A4A5E]">Utilisation</span>
                <span className="font-medium text-[#8B8B9E]">{clamped}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${clamped}%`, background: barColor }}
                />
            </div>
        </div>
    )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function DashboardPage() {
    const [metrics, setMetrics] = useState<MetricsResponse | null>(null)
    const [system, setSystem] = useState<SystemStats | null>(null)
    const [lastUpdate, setLastUpdate] = useState(0)
    const [spinning, setSpinning] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const refresh = useCallback(async () => {
        setSpinning(true)
        try {
            const [m, s] = await Promise.all([fetchMetrics(), fetchSystem()])
            setMetrics(m)
            setSystem(s)
            setLastUpdate(Date.now())
            setError(null)
        } catch {
            setError("Impossible de joindre le serveur.")
        } finally {
            setSpinning(false)
        }
    }, [])

    useEffect(() => {
        refresh()
        const id = setInterval(() => {
            if (document.visibilityState === "visible") refresh()
        }, 5_000)
        const onVisible = () => { if (document.visibilityState === "visible") refresh() }
        document.addEventListener("visibilitychange", onVisible)
        return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible) }
    }, [refresh])

    const secAgo = lastUpdate ? Math.round((Date.now() - lastUpdate) / 1000) : null
    const ollamaModel = system?.ollama?.models?.[0]

    return (
        <div className="flex h-screen flex-col overflow-y-auto bg-[#09090B]">
            {/* Header */}
            <header className="flex h-[60px] shrink-0 items-center justify-between border-b border-white/[0.06] px-8">
                <h1 className="text-[14px] font-semibold tracking-[-0.01em] text-[#C8C8D4]">
                    Observabilité
                </h1>
                <div className="flex items-center gap-3">
                    {secAgo !== null && (
                        <span className="text-[12px] text-[#3E3E50]">
                            Actualisé il y a {secAgo}s
                        </span>
                    )}
                    <button
                        onClick={refresh}
                        disabled={spinning}
                        className="rounded-[7px] p-1.5 text-[#4A4A5E] transition-colors hover:bg-white/[0.05] hover:text-[#8B8B9E] disabled:opacity-40"
                        title="Actualiser"
                    >
                        <RefreshCw size={14} className={spinning ? "animate-spin" : ""} />
                    </button>
                </div>
            </header>

            {error && (
                <div className="mx-8 mt-6 rounded-xl border border-red-500/20 bg-red-500/[0.07] px-4 py-3 text-[13px] text-red-400">
                    {error}
                </div>
            )}

            <div className="mx-auto w-full max-w-5xl space-y-6 px-8 py-8">

                {/* ── Stat cards ─────────────────────────────────────────── */}
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                    <StatCard
                        icon={MessageSquare}
                        label="Requêtes"
                        value={fmtNum(metrics?.requests ?? 0)}
                        sub="depuis le démarrage"
                    />
                    <StatCard
                        icon={Clock}
                        label="Temps moyen"
                        value={fmtMs(metrics?.avgResponseTime ?? 0)}
                        sub="par réponse complète"
                    />
                    <StatCard
                        icon={Zap}
                        label="1er token"
                        value={fmtMs(metrics?.avgTimeToFirstToken ?? 0)}
                        sub="temps médian"
                        accent
                    />
                    <StatCard
                        icon={Activity}
                        label="Tokens total"
                        value={fmtNum((metrics?.totalPromptTokens ?? 0) + (metrics?.totalCompletionTokens ?? 0))}
                        sub={`${fmtNum(metrics?.totalPromptTokens ?? 0)} prompt · ${fmtNum(metrics?.totalCompletionTokens ?? 0)} compl.`}
                    />
                    <StatCard
                        icon={Zap}
                        label="Tokens/s moy."
                        value={fmtToks(metrics?.avgTokensPerSecond ?? 0)}
                        sub="vitesse d'inférence"
                        accent
                    />
                </div>

                {/* ── System cards ───────────────────────────────────────── */}
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">

                    {/* RAM */}
                    <div className="rounded-xl border border-white/[0.07] bg-[#0E0F12] p-5">
                        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-[#4A4A5E]">
                            <Cpu size={13} strokeWidth={1.8} />
                            RAM système
                        </div>
                        {system ? (
                            <>
                                <div className="mt-3 text-[22px] font-semibold tracking-tight text-[#ECECF0]">
                                    {fmtBytes(system.ram.usedBytes)}
                                    <span className="ml-2 text-[14px] font-normal text-[#4A4A5E]">
                                        / {fmtBytes(system.ram.totalBytes)}
                                    </span>
                                </div>
                                <GaugeBar value={system.ram.percent} color="#6C65E8" />
                            </>
                        ) : (
                            <Skeleton />
                        )}
                    </div>

                    {/* GPU (nvidia-smi) */}
                    <div className="rounded-xl border border-white/[0.07] bg-[#0E0F12] p-5">
                        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-[#4A4A5E]">
                            <Activity size={13} strokeWidth={1.8} />
                            GPU
                        </div>
                        {system ? (
                            system.gpu ? (
                                <>
                                    <div className="mt-3 flex items-end justify-between">
                                        <div className="text-[22px] font-semibold tracking-tight text-[#ECECF0]">
                                            {system.gpu.utilizationPercent}%
                                        </div>
                                        <div className="flex items-center gap-1 text-[12px] text-[#4A4A5E]">
                                            <Thermometer size={12} />
                                            {system.gpu.temperatureC}°C
                                        </div>
                                    </div>
                                    <GaugeBar value={system.gpu.utilizationPercent} color="#6C65E8" />
                                    <div className="mt-2 text-[12px] text-[#4A4A5E]">
                                        VRAM : {fmtBytes(system.gpu.memoryUsedMB * 1e6)} / {fmtBytes(system.gpu.memoryTotalMB * 1e6)}
                                    </div>
                                </>
                            ) : (
                                <div className="mt-4 text-[13px] text-[#3E3E50]">
                                    nvidia-smi non disponible
                                </div>
                            )
                        ) : (
                            <Skeleton />
                        )}
                    </div>

                    {/* Ollama model */}
                    <div className="rounded-xl border border-white/[0.07] bg-[#0E0F12] p-5">
                        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-[#4A4A5E]">
                            <Zap size={13} strokeWidth={1.8} />
                            Modèle Ollama
                        </div>
                        {system ? (
                            ollamaModel ? (
                                <>
                                    <div className="mt-3 truncate text-[15px] font-semibold tracking-tight text-[#ECECF0]">
                                        {ollamaModel.name}
                                    </div>
                                    <div className="mt-2 space-y-1 text-[12px] text-[#4A4A5E]">
                                        <div className="flex justify-between">
                                            <span>Taille totale</span>
                                            <span className="text-[#8B8B9E]">{fmtBytes(ollamaModel.size)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>VRAM allouée</span>
                                            <span className="text-[#7B70EE]">{fmtBytes(ollamaModel.size_vram)}</span>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="mt-4 text-[13px] text-[#3E3E50]">
                                    Aucun modèle chargé
                                </div>
                            )
                        ) : (
                            <Skeleton />
                        )}
                    </div>
                </div>

                {/* ── Logs table ─────────────────────────────────────────── */}
                <div className="rounded-xl border border-white/[0.07] bg-[#0E0F12]">
                    <div className="border-b border-white/[0.06] px-5 py-4">
                        <h2 className="text-[12px] font-medium uppercase tracking-widest text-[#4A4A5E]">
                            Logs prompts récents
                        </h2>
                    </div>

                    {metrics && metrics.logs.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-[13px]">
                                <thead>
                                    <tr className="border-b border-white/[0.05]">
                                        {["Heure", "Aperçu", "Prompt tok.", "Compl. tok.", "Tok/s", "1er token", "Total"].map((h) => (
                                            <th
                                                key={h}
                                                className="px-5 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-[#3E3E50]"
                                            >
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {metrics.logs.map((log, i) => (
                                        <tr
                                            key={log.id}
                                            className={`border-b border-white/[0.04] transition-colors hover:bg-white/[0.02] ${i === metrics.logs.length - 1 ? "border-0" : ""}`}
                                        >
                                            <td className="whitespace-nowrap px-5 py-3 font-mono text-[12px] text-[#4A4A5E]">
                                                {fmtTime(log.timestamp)}
                                            </td>
                                            <td className="max-w-[220px] px-5 py-3 text-[#8B8B9E]">
                                                <span className="block truncate" title={log.promptPreview}>
                                                    {log.promptPreview || "—"}
                                                </span>
                                            </td>
                                            <td className="px-5 py-3 font-mono text-[#6A6A7E]">
                                                {fmtNum(log.promptTokens)}
                                            </td>
                                            <td className="px-5 py-3 font-mono text-[#7B70EE]">
                                                {fmtNum(log.completionTokens)}
                                            </td>
                                            <td className="px-5 py-3 font-mono text-[#6C65E8]">
                                                {fmtToks(log.tokensPerSecond)}
                                            </td>
                                            <td className="px-5 py-3 font-mono text-[#6A6A7E]">
                                                {fmtMs(log.timeToFirstToken)}
                                            </td>
                                            <td className="px-5 py-3 font-mono font-medium text-[#C0C0CC]">
                                                {fmtMs(log.totalTime)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                            <Activity size={24} className="text-[#2A2A35]" strokeWidth={1.5} />
                            <p className="text-[13px] text-[#3E3E50]">Aucune requête enregistrée</p>
                            <p className="text-[12px] text-[#2A2A35]">Envoie un message dans le chat pour voir les métriques apparaître</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

function Skeleton() {
    return (
        <div className="mt-3 space-y-2">
            <div className="h-7 w-2/3 animate-pulse rounded-lg bg-white/[0.04]" />
            <div className="h-1.5 w-full animate-pulse rounded-full bg-white/[0.04]" />
        </div>
    )
}
