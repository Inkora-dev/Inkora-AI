import { useMemo, useState } from "react"
import { NavLink, useNavigate } from "react-router-dom"
import {
    Plus, MessageSquare, Pencil, Trash2, Check, X,
    Zap, BarChart2, Settings, ChevronDown, Bot, Terminal, Search,
} from "lucide-react"
import type { Conversation } from "@inkora/shared"

type Props = {
    conversations: Conversation[]
    activeId: string
    isOpen: boolean
    onClose: () => void
    onSelect: (id: string) => void
    onNewChat: () => void
    onRename: (id: string, title: string) => void
    onDelete: (id: string) => void
    activeModel: string
    models: string[]
    onModelChange: (model: string) => void
    onOpenSettings: () => void
}

// ─── Date grouping ────────────────────────────────────────────────────────────

function getGroup(ts: number): string {
    const now = new Date()
    const today = new Date(now); today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
    const lastWeek = new Date(today); lastWeek.setDate(today.getDate() - 7)

    if (ts >= today.getTime()) return "Aujourd'hui"
    if (ts >= yesterday.getTime()) return "Hier"
    if (ts >= lastWeek.getTime()) return "7 derniers jours"
    return "Plus ancien"
}

const GROUP_ORDER = ["Aujourd'hui", "Hier", "7 derniers jours", "Plus ancien"]

// ─── Component ────────────────────────────────────────────────────────────────

export function Sidebar({
    conversations,
    activeId,
    isOpen,
    onClose,
    onSelect,
    onNewChat,
    onRename,
    onDelete,
    activeModel,
    models,
    onModelChange,
    onOpenSettings,
}: Props) {
    const navigate = useNavigate()
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editValue, setEditValue] = useState("")
    const [search, setSearch] = useState("")

    function startEdit(id: string, title: string) {
        setEditingId(id)
        setEditValue(title)
    }

    function commitEdit(id: string) {
        const trimmed = editValue.trim()
        if (trimmed) onRename(id, trimmed)
        setEditingId(null)
    }

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        return q
            ? conversations.filter((c) => c.title.toLowerCase().includes(q))
            : conversations
    }, [conversations, search])

    const grouped = useMemo(() => {
        const map: Record<string, Conversation[]> = {}
        for (const conv of filtered) {
            const g = getGroup(conv.createdAt)
            if (!map[g]) map[g] = []
            map[g].push(conv)
        }
        return map
    }, [filtered])

    const hasResults = filtered.length > 0

    const inner = (
        <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0E0F12]">

            {/* Logo */}
            <div className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-white/[0.06] px-5">
                <div className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] bg-gradient-to-br from-[#8177F0] to-[#5B52D4] shadow-[0_0_14px_rgba(129,119,240,0.3)]">
                    <Zap size={13} className="text-white" strokeWidth={2.5} />
                </div>
                <span className="text-[15px] font-semibold tracking-[-0.015em] text-[#ECECF0]">
                    inkora
                </span>
            </div>

            {/* Model selector */}
            <div className="px-3 pt-3">
                <div className="relative">
                    <select
                        value={activeModel}
                        onChange={(e) => onModelChange(e.target.value)}
                        className="w-full cursor-pointer appearance-none rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-3 py-2 pr-8 text-[12px] text-[#7A7A8C] outline-none transition-colors hover:border-white/[0.11] hover:text-[#C0C0CC] focus:border-white/[0.11]"
                    >
                        {models.length === 0 ? (
                            <option value={activeModel}>{activeModel || "Chargement…"}</option>
                        ) : (
                            models.map((m) => (
                                <option key={m} value={m} style={{ background: "#0E0F12" }}>{m}</option>
                            ))
                        )}
                    </select>
                    <ChevronDown size={11} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#4A4A58]" />
                </div>
            </div>

            {/* New chat */}
            <div className="px-3 pt-2">
                <button
                    onClick={() => { onNewChat(); navigate("/") }}
                    className="flex w-full items-center gap-2 rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-[13px] font-medium text-[#8B8B9E] transition-all duration-150 hover:border-white/[0.11] hover:bg-white/[0.05] hover:text-[#C8C8D4]"
                >
                    <Plus size={15} strokeWidth={2.2} />
                    <span>Nouveau chat</span>
                </button>
            </div>

            {/* Search */}
            <div className="px-3 pt-2">
                <div className="relative">
                    <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#3A3A50]" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Rechercher…"
                        className="w-full rounded-[9px] border border-white/[0.06] bg-transparent py-2 pl-7 pr-3 text-[12px] text-[#8B8B9E] placeholder-[#3A3A50] outline-none transition-colors focus:border-white/[0.10]"
                    />
                    {search && (
                        <button
                            onClick={() => setSearch("")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#3A3A50] hover:text-[#6A6A7E]"
                        >
                            <X size={11} />
                        </button>
                    )}
                </div>
            </div>

            {/* Conversations grouped by date */}
            <div className="mt-2 flex-1 overflow-y-auto pb-2">
                {!hasResults ? (
                    <p className="px-4 py-6 text-center text-[12px] text-[#3A3A50]">
                        Aucun résultat pour « {search} »
                    </p>
                ) : (
                    GROUP_ORDER.map((group) => {
                        const items = grouped[group]
                        if (!items?.length) return null
                        return (
                            <div key={group} className="mb-1">
                                <p className="px-4 pb-1 pt-3 text-[10.5px] font-medium uppercase tracking-widest text-[#2E2E3E]">
                                    {group}
                                </p>
                                <div className="space-y-0.5 px-2">
                                    {items.map((conv) => {
                                        const isActive = conv.id === activeId
                                        const isEditing = editingId === conv.id

                                        return (
                                            <div key={conv.id} className="group relative">
                                                {isEditing ? (
                                                    <div className="flex items-center gap-1 rounded-[9px] bg-white/[0.07] px-3 py-2">
                                                        <input
                                                            autoFocus
                                                            value={editValue}
                                                            onChange={(e) => setEditValue(e.target.value)}
                                                            onKeyDown={(e) => {
                                                                if (e.key === "Enter") commitEdit(conv.id)
                                                                if (e.key === "Escape") setEditingId(null)
                                                            }}
                                                            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#ECECF0] outline-none"
                                                        />
                                                        <button
                                                            onClick={() => commitEdit(conv.id)}
                                                            className="rounded p-0.5 text-[#6C65E8] hover:text-[#8E88F2]"
                                                        >
                                                            <Check size={13} />
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingId(null)}
                                                            className="rounded p-0.5 text-[#4A4A58] hover:text-[#8B8B9E]"
                                                        >
                                                            <X size={13} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => { onSelect(conv.id); navigate("/") }}
                                                        className={`relative flex w-full items-center gap-2.5 rounded-[9px] py-2.5 pl-3 pr-12 text-left transition-colors duration-100
                                                            ${isActive
                                                                ? "bg-white/[0.07] text-[#ECECF0]"
                                                                : "text-[#7A7A8C] hover:bg-white/[0.04] hover:text-[#C0C0CC]"
                                                            }`}
                                                    >
                                                        {isActive && (
                                                            <div className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-[#7B70EE]" />
                                                        )}
                                                        <MessageSquare
                                                            size={13}
                                                            strokeWidth={1.7}
                                                            className={`shrink-0 ${isActive ? "text-[#7B70EE]" : ""}`}
                                                        />
                                                        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium leading-none">
                                                            {conv.title}
                                                        </span>
                                                    </button>
                                                )}

                                                {!isEditing && (
                                                    <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); startEdit(conv.id, conv.title) }}
                                                            className="rounded-[6px] p-1 text-[#4A4A58] hover:bg-white/[0.06] hover:text-[#8B8B9E]"
                                                        >
                                                            <Pencil size={12} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onDelete(conv.id) }}
                                                            className="rounded-[6px] p-1 text-[#4A4A58] hover:bg-red-500/[0.12] hover:text-red-400"
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    })
                )}
            </div>

            {/* Bottom nav */}
            <div className="border-t border-white/[0.06] px-2 py-2 space-y-0.5">
                {[
                    { to: "/", end: true, icon: MessageSquare, label: "Chats" },
                    { to: "/agent", end: false, icon: Bot, label: "Agent Coding" },
                    { to: "/automation", end: false, icon: Terminal, label: "Homelab" },
                    { to: "/dashboard", end: false, icon: BarChart2, label: "Observabilité" },
                ].map(({ to, end, icon: Icon, label }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={end}
                        className={({ isActive }) =>
                            `flex items-center gap-2.5 rounded-[9px] px-3 py-2.5 text-[13px] font-medium transition-colors duration-100
                            ${isActive
                                ? "bg-white/[0.07] text-[#ECECF0]"
                                : "text-[#7A7A8C] hover:bg-white/[0.04] hover:text-[#C0C0CC]"
                            }`
                        }
                    >
                        <Icon size={14} strokeWidth={1.7} />
                        <span>{label}</span>
                    </NavLink>
                ))}
                <button
                    onClick={onOpenSettings}
                    className="flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2.5 text-[13px] font-medium text-[#7A7A8C] transition-colors duration-100 hover:bg-white/[0.04] hover:text-[#C0C0CC]"
                >
                    <Settings size={14} strokeWidth={1.7} />
                    <span>Paramètres</span>
                </button>
            </div>
        </aside>
    )

    return (
        <>
            <div className="hidden md:flex">{inner}</div>
            {isOpen && (
                <div className="fixed inset-0 z-50 md:hidden">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
                    <div className="relative z-10 h-full" onClick={(e) => e.stopPropagation()}>
                        {inner}
                    </div>
                </div>
            )}
        </>
    )
}
