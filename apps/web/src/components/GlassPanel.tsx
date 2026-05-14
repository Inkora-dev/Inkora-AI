type GlassPanelProps = {
    children: React.ReactNode
    className?: string
}

export function GlassPanel({ children, className = "" }: GlassPanelProps) {
    return (
        <div
            className={`
        rounded-3xl border border-white/10 border-t-white/20
        bg-white/5 backdrop-blur-xl
        shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]
        ${className}
      `}
        >
            {children}
        </div>
    )
}