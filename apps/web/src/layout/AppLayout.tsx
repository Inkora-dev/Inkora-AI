import type { ReactNode } from "react"

export function AppLayout({ children }: { children: ReactNode }) {
    return (
        <div className="h-screen overflow-hidden bg-[#09090B] text-[#ECECF0] antialiased">
            <div className="flex h-full">
                {children}
            </div>
        </div>
    )
}
