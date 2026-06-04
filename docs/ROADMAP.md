# Inkora AI — Roadmap

> Inkora est le compagnon interactif de l'écosystème local. Là où JARVINx observe et décide de façon autonome, Inkora agit à la demande — coding, RAG, homelab investigatif. Les deux projets sont complémentaires et conçus pour converger à moyen terme.

---

## Vision

|             | Inkora                          | JARVINx                                |
| ----------- | ------------------------------- | -------------------------------------- |
| Mode        | Interactif, à la demande        | Autonome, proactif                     |
| Déclencheur | Humain                          | Scheduler                              |
| Focus       | Code · RAG · Chatbot            | Infrastructure · Métriques · Décisions |
| Mémoire     | RAG fichiers + contexte session | SQLite long terme + Qdrant sémantique  |

---

## Livré ✅

- Chat streamé avec n'importe quel modèle Ollama
- RAG local — upload manuel, embeddings via `nomic-embed-text`, persistance disque
- Agent Coding — boucle ReAct, 9 outils (fichiers, git, shell, AST, RAG search)
- Agent Homelab — Docker (ps/logs/stats/inspect/restart/stop/start) + http_request interne
- Analyse AST TypeScript/JS — symboles, définitions, exports
- Sliding window contexte côté serveur (≤ 6 000 tokens)
- Event bus typé + historique des runs agent
- Auto-titrage des conversations
- Persistance conversations et embeddings RAG sur disque
- Logs structurés (pino)
- Crash recovery agent (timeouts, idle detection, loop detection)
- UI Open WebUI-style — welcome screen, input card, sidebar groupée par date, titre inline, settings sidebar
- Suite de tests vitest (22 tests)

---

## pre-v1.x — Consolidation (sprint en cours)

> Condition de sortie : CI vert, watcher fonctionnel sur un repo de 200+ fichiers sans gel de l'event loop.

Phase 1 — Tests (contractualiser avant de toucher au code)

- [ ] rag.test.ts — cosineSimilarity (vecteurs identiques/orthogonaux/nuls), roundtrip persistence, retrieveContext seuil 0.3
- [ ] agent-core.test.ts — loop detection : 3 appels identiques → erreur, 2 non consécutifs → pas de déclenchement
- [ ] conversations.test.ts — roundtrip disque, JSON corrompu au démarrage
- [ ] context.test.ts — budget négatif, simulation injection user-context.md

Phase 2 — Batching embeddings (indépendant, gain immédiat)

- [ ] rag.ts:112 — Promise.all par batch de 5 : indexation ~10 min → ~2 min

Phase 3 — Migration SQLite (couverte par les tests de Phase 1)

- [ ] rag.ts — remplacer store JSON par better-sqlite3 : écriture incrémentale, atomicité native
- [ ] rag.test.ts — adapter les tests avec fichier SQLite en tmpdir()
- [ ] .env.example — RAG_DB_PATH à la place de RAG_STORE_PATH

Phase 4 — Body limit

- [ ] index.ts:37 — express.json({ limit: "10mb" }) pour les fichiers du watcher

  ***

## v1.x — RAG codebase automatique

> Priorité : supprimer la friction de l'upload manuel et rendre le RAG utile au quotidien sur un projet entier.

- [ ] **RAG watcher** — pointer Inkora sur un répertoire local, indexation automatique à chaque modification (`chokidar`)
  - `POST /api/rag/watch` — enregistre un dossier à surveiller
  - `GET /api/rag/status` — état du watcher (fichiers indexés, dernière sync, erreurs)
  - Re-indexation incrémentale sur `change`/`add`, suppression propre sur `unlink`
  - Filtres par extension configurables (`.ts .go .py .md`...) via Settings
  - Indicateur de sync en temps réel dans la sidebar
- [ ] **Upload PDF** — support des fichiers `.pdf` dans le RAG
- [ ] **Export dataset JSONL** — export conversations pour fine-tuning (`ollama create`)

---

## v1.x+1 — Mémoire utilisateur

> Donner à Inkora un contexte persistant sur toi, ton stack, tes projets en cours — sans architecture complexe.

- [ ] **`user-context.md`** — fichier éditable depuis Settings, injecté automatiquement dans chaque system prompt
  - Section dédiée dans Settings → Assistant
  - Contenu suggéré : stack préféré, projets actifs, préférences de réponse
  - Inject silencieux — ne pollue pas l'historique visible

---

## v1.x+2 — Profils de contexte

> Switcher entre contextes de travail depuis la sidebar sans reconfigurer manuellement.

- [ ] **Profils** — chaque profil embarque un system prompt, un RAG watch folder, et un modèle Ollama préféré
  - Exemples : `Dev JARVINx` (repo Go + qwen-coder), `Perso` (notes Obsidian + llama généraliste)
  - Sélecteur dans la sidebar, persistance locale
  - Section `Profils` dans Settings pour créer / éditer / supprimer

---

## v2.0 — Serveur MCP + connecteur JARVINx

> Ouvrir Inkora vers l'extérieur et amorcer la convergence avec JARVINx.

- [ ] **Serveur MCP** — intégration Claude Code / tout client MCP compatible
- [ ] **Connecteur JARVINx** — outil `jarvinx_context(query)` dans l'Agent Homelab
  - Interroge `/api/history` de JARVINx pour récupérer les dernières décisions autonomes
  - S'active uniquement si `JARVINX_URL` est configuré dans `.env`
  - Permet d'investiguer dans Inkora ce que JARVINx a détecté automatiquement
- [ ] **Agent Homelab — Home Assistant** — automatisations, états, services
- [ ] **Agent Homelab — surveillance de services** — alertes, healthchecks

---

## v2.x — Orchestration multi-agents

> Faire collaborer les agents entre eux sur une tâche complexe.

- [ ] **Orchestration multi-agents** — coding + homelab en parallèle sur une même tâche
- [ ] **Pipeline JARVINx → Inkora** — JARVINx détecte une anomalie → Inkora reçoit le contexte et propose une investigation guidée
