# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Inkora AI is a privacy-first local AI chat application powered by Ollama (no external APIs). It features two specialized ReAct agents (coding and homelab/Docker), a RAG pipeline with vector search, and an observability dashboard.

## Commands

All commands run from the repo root.

**Development**
```bash
npm run dev           # Start both frontend and backend concurrently
npm run dev:web       # Frontend only (Vite, port 5173)
npm run dev:server    # Backend only (tsx, port 3001)
```

**Build / Lint / Test**
```bash
npm run build         # Build all workspaces
npm run lint          # Lint all workspaces (only web has ESLint configured)
npm run test          # Run all workspace tests
```

**Single workspace**
```bash
npm --workspace @inkora/server run test    # Run server unit tests (vitest run)
npm --workspace @inkora/web run build      # tsc -b && vite build
```

**Single test file**
```bash
npm --workspace @inkora/server run test -- src/__tests__/agent.test.ts
```

## Monorepo Structure

| Workspace | Package name | Role |
|---|---|---|
| `apps/web` | `@inkora/web` | React 19 + Vite frontend |
| `server` | `@inkora/server` | Express 5 API + AI logic |
| `shared` | `@inkora/shared` | Shared TypeScript types only |

`@inkora/shared` is path-aliased as `@inkora/shared` in both `tsconfig.json` files and resolved in `vite.config.ts`. The root uses CommonJS; `apps/web` and `shared` use ESM.

## Environment

Copy `.env.example` to `.env` in the root. Key variables:
- `OLLAMA_URL` — Ollama base URL (default `http://localhost:11434`)
- `OLLAMA_MODEL` — Chat model (default `qwen2.5:7b`)
- `CODING_MODEL` — Coding agent model (default `qwen2.5-coder:7b`)
- `AUTOMATION_MODEL` — Homelab agent model (default `dolphin-mistral:7b`)
- `AUTOMATION_ALLOWED_CONTAINERS` — Comma-separated Docker containers the automation agent may restart/stop/start (empty = none allowed)
- `AUTOMATION_ALLOWED_HOSTS` — Comma-separated hosts the automation agent may send HTTP requests to

The web app reads `VITE_API_URL` from `apps/web/.env` (defaults to `http://localhost:3001`).

Persistence files are written to `data/` (gitignored) at the repo root:
- `data/conversations.json`
- `data/rag-store.json`

## Architecture

### Backend (`server/src/`)

The server is a single Express 5 app in `index.ts` that mounts all routes.

**Key modules:**
- `agent-core.ts` — ReAct loop engine (`runAgentWithTools`). Handles streaming Ollama calls, timeout detection, and loop detection (aborts if the same tool is called identically 3× in a row).
- `agent.ts` — Coding agent with 9 tools: read/write files, list dirs, search code, AST analysis, shell, git, RAG search. Write tool blocks system paths; shell and git tools use whitelists.
- `agent-automation.ts` — Homelab agent with 9 tools: docker_ps/logs/stats/inspect/restart/stop/start, http_request, system_info. All destructive actions require the container/host whitelist.
- `rag.ts` — Document chunking (~600 chars, 120-char overlap), embedding via `nomic-embed-text` Ollama model, cosine similarity search, persisted to `data/rag-store.json`.
- `context.ts` — Sliding window context manager that keeps conversation history ≤6000 tokens.
- `conversations.ts` — JSON file persistence with debounced writes.
- `bus.ts` — In-process event bus for agent run history and inter-module communication.
- `ast.ts` — TypeScript/JS AST analysis using `@typescript-eslint/typescript-estree`.
- `logger.ts` — Pino structured logging; pino-pretty in dev, JSON in production.

**Streaming protocols:**
- Chat endpoint (`POST /api/chat`): `text/plain` chunked stream.
- Agent endpoints (`POST /api/agent/run`, `POST /api/automation/run`): NDJSON (newline-delimited JSON) stream.

### Frontend (`apps/web/src/`)

**Pages:**
- `ChatPage` — Main chat with streaming, RAG toggle, sliding-window context warning, auto-titling.
- `AgentPage` — Coding agent interface with step-by-step ReAct trace display.
- `AutomationPage` — Homelab agent interface.
- `DashboardPage` — Observability: tokens/s, TTFT, RAM/GPU via `nvidia-smi`, recent request logs.

**`lib/` modules** are the API boundary — all backend calls go through these files (`api.ts`, `agent.ts`, `automation.ts`, `rag.ts`, `stats.ts`, `storage.ts`, `config.ts`).

State is managed locally with React hooks; conversations and settings are persisted to `localStorage` with debounced sync to the server.

### Shared types (`shared/types/index.ts`)

`Message`, `Conversation`, `RequestLog`, `RagDocument`, `SystemStats`, `MetricsResponse`. Import as `import type { ... } from "@inkora/shared"`.

## Testing

Tests live in `server/src/__tests__/` and run with Vitest in the Node environment. There are no frontend tests. The test suite covers: agent tool execution, context windowing, conversation persistence, and RAG chunking/search.
