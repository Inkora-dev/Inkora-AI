import { useEffect, useMemo, useRef, useState } from "react"
import { Routes, Route, Navigate } from "react-router-dom"

import { Sidebar } from "./components/Sidebar"
import { SettingsModal } from "./components/SettingsModal"
import { ChatPage } from "./pages/ChatPage"
import { DashboardPage } from "./pages/DashboardPage"
import { AgentPage } from "./pages/AgentPage"
import { AutomationPage } from "./pages/AutomationPage"
import { AppLayout } from "./layout/AppLayout"
import {
    loadConversations, saveConversations,
    loadSystemPrompt, saveSystemPrompt,
    loadActiveModel, saveActiveModel,
} from "./lib/storage"
import {
    fetchConversations, upsertConversationApi,
    deleteConversationApi, clearConversationsApi,
} from "./lib/api"
import { fetchModels } from "./lib/stats"
import type { Conversation } from "@inkora/shared"

function createConversation(): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "Nouveau chat",
    createdAt: Date.now(),
    messages: [{ role: "assistant", content: "Bonjour, je suis Inkora. Comment puis-je t'aider ?" }],
  }
}

function initConversations(): Conversation[] {
  const saved = loadConversations()
  return saved.length > 0 ? saved : [createConversation()]
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>(initConversations)
  const [activeId, setActiveId] = useState<string>(() => conversations[0].id)
  const [systemPrompt, setSystemPrompt] = useState(() => loadSystemPrompt())
  const [activeModel, setActiveModel] = useState(() => loadActiveModel())
  const [models, setModels] = useState<string[]>([])

  // ─── Server sync ───────────────────────────────────────────────────────────
  // lastSyncedRef tracks what was last pushed to the server (id → JSON string)
  // so we only PUT conversations that actually changed.
  const lastSyncedRef = useRef<Map<string, string>>(new Map())
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const skipSave = useRef(true)
  useEffect(() => {
    if (skipSave.current) { skipSave.current = false; return }
    saveConversations(conversations) // localStorage fallback

    // debounce server upserts — 1s to absorb streaming token updates
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      for (const conv of conversations) {
        const json = JSON.stringify(conv)
        if (lastSyncedRef.current.get(conv.id) !== json) {
          upsertConversationApi(conv)
          lastSyncedRef.current.set(conv.id, json)
        }
      }
    }, 1_000)
  }, [conversations])

  // Load from server on mount; fall back to localStorage if server unreachable
  useEffect(() => {
    fetchConversations().then((serverConvs) => {
      if (serverConvs.length === 0) {
        // migrate localStorage data to server
        const local = loadConversations()
        local.forEach((c) => upsertConversationApi(c))
        return
      }
      setConversations(serverConvs)
      setActiveId((prev) => serverConvs.find((c) => c.id === prev) ? prev : serverConvs[0].id)
      // seed last-synced so first effect run doesn't re-push everything
      lastSyncedRef.current = new Map(serverConvs.map((c) => [c.id, JSON.stringify(c)]))
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchModels().then((list) => {
      if (list.length === 0) return
      setModels(list)
      setActiveModel((prev) => {
        const valid = prev && list.includes(prev) ? prev : list[0]
        saveActiveModel(valid)
        return valid
      })
    })
  }, [])

  function newChat() {
    const c = createConversation()
    setConversations((prev) => [c, ...prev])
    setActiveId(c.id)
    setSidebarOpen(false)
  }

  function renameConversation(id: string, title: string) {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)))
  }

  function deleteConversation(id: string) {
    deleteConversationApi(id)
    lastSyncedRef.current.delete(id)
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id)
      if (next.length === 0) {
        const fresh = createConversation()
        setActiveId(fresh.id)
        return [fresh]
      }
      if (id === activeId) setActiveId(next[0].id)
      return next
    })
  }

  function handleModelChange(model: string) {
    setActiveModel(model)
    saveActiveModel(model)
  }

  function handleSystemPromptSave(prompt: string) {
    setSystemPrompt(prompt)
    saveSystemPrompt(prompt)
  }

  function clearConversations() {
    clearConversationsApi()
    lastSyncedRef.current.clear()
    const fresh = createConversation()
    setConversations([fresh])
    setActiveId(fresh.id)
    saveConversations([fresh])
  }

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId),
    [conversations, activeId]
  )

  return (
    <AppLayout>
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={(id) => { setActiveId(id); setSidebarOpen(false) }}
        onNewChat={newChat}
        onRename={renameConversation}
        onDelete={deleteConversation}
        activeModel={activeModel}
        models={models}
        onModelChange={handleModelChange}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="relative flex flex-1 flex-col overflow-hidden">
        <Routes>
          <Route
            path="/"
            element={
              activeConversation ? (
                <ChatPage
                  conversation={activeConversation}
                  setConversations={setConversations}
                  onOpenSidebar={() => setSidebarOpen(true)}
                  systemPrompt={systemPrompt}
                  activeModel={activeModel}
                />
              ) : (
                <div className="flex h-full items-center justify-center text-[#4A4A58]">
                  Sélectionnez une conversation
                </div>
              )
            }
          />
          <Route path="/agent" element={<AgentPage activeModel={activeModel} />} />
          <Route path="/automation" element={<AutomationPage activeModel={activeModel} />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {settingsOpen && (
        <SettingsModal
          systemPrompt={systemPrompt}
          onSave={handleSystemPromptSave}
          onClose={() => setSettingsOpen(false)}
          onClearConversations={clearConversations}
        />
      )}
    </AppLayout>
  )
}

export default App
