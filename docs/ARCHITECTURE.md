# Architecture d'Inkora AI

## Vue d'ensemble

Inkora est une application de chat IA locale qui tourne entièrement sur ta machine, sans envoyer de données dans le cloud. Le frontend React parle à un serveur Express, qui transmet les messages à Ollama (moteur IA local). Deux agents spécialisés peuvent exécuter des actions réelles : l'un pour du code, l'autre pour piloter ton homelab.

---

## Le flux d'une requête de bout en bout

```
Utilisateur frappe un message
        │
        ▼
[React / ChatPage]   →   POST /api/chat   →   [Express / index.ts]
                                                       │
                                          (si RAG activé) → embeddings + recherche doc
                                                       │
                                          POST ollama/api/chat (stream)
                                                       │
                                          ◄── tokens arrivés un par un ───
                                                       │
                              réponse streamée (text/plain) ◄──────────
        │
        ▼
[ChatPage] affiche les tokens en temps réel
```

**Pour un agent (coding ou automation) :**

```
Utilisateur envoie une tâche
        │
        ▼
POST /api/agent/run   →   runAgentWithTools()
                                 │
                     ┌───────────▼────────────┐
                     │  1. Ollama réfléchit    │
                     │  2. Appelle un outil    │  ← boucle ReAct
                     │  3. Résultat → Ollama   │
                     └──────────────────────-──┘
                                 │
                     réponse finale (NDJSON stream)
```

---

## Les fichiers clés et leur rôle

### Backend (`server/src/`)

| Fichier | Rôle |
|---|---|
| `index.ts` | Point d'entrée Express. Déclare toutes les routes HTTP, gère le streaming vers Ollama, lit la config `.env`. |
| `agent-core.ts` | Moteur générique des agents. Contient la boucle ReAct (`runAgentWithTools`), le streaming Ollama (`streamOllama`), la détection de boucles infinies. |
| `agent.ts` | Agent **coding** : définit les outils fichiers/git/shell, le prompt système, et expose `runAgent()`. |
| `agent-automation.ts` | Agent **homelab** : outils Docker, requêtes HTTP vers services locaux, et expose `runAutomationAgent()`. |
| `rag.ts` | Stockage et recherche de documents. Découpe les textes en morceaux, calcule des embeddings, retrouve les passages pertinents par similarité cosinus. |
| `conversations.ts` | Persistance des conversations sur disque (`data/conversations.json`). Lecture/écriture avec debounce. |
| `context.ts` | Écrête l'historique de conversation pour ne pas dépasser ~6 000 tokens envoyés à Ollama. |
| `bus.ts` | Bus d'événements interne (`EventEmitter` typé). Permet aux modules de se notifier sans couplage direct (ex : agent → dashboard). |
| `logger.ts` | Logger structuré (`pino`). Chaque module a son propre sous-logger (`log.chat`, `log.rag`, etc.). |

### Frontend (`apps/web/src/`)

| Fichier / dossier | Rôle |
|---|---|
| `pages/ChatPage.tsx` | L'interface principale de chat. Gère le streaming, le toggle RAG, l'auto-titre, l'avertissement de contexte. |
| `pages/AgentPage.tsx` | Interface de l'agent coding. Affiche les phases (réflexion / outil / réponse) avec streaming. |
| `pages/AutomationPage.tsx` | Interface de l'agent homelab. Même UX qu'AgentPage mais pour les tâches Docker/homelab. |
| `pages/DashboardPage.tsx` | Tableau de bord : métriques (tokens/s, temps de réponse), stats RAM/GPU, logs des requêtes. |
| `lib/config.ts` | Source unique de la variable `API_URL`. Tous les modules importent d'ici. |
| `lib/api.ts` | Fonctions de communication avec le backend (fetch chat, conversations, etc.). |
| `lib/agent.ts` / `lib/automation.ts` | Fonctions de streaming des agents (lisent le NDJSON ligne par ligne). |
| `lib/rag.ts` | Appels API pour upload/suppression de documents RAG. |
| `lib/stats.ts` | Récupération des métriques pour le dashboard. |

### Partagé (`shared/types/`)

| Type | Ce qu'il représente |
|---|---|
| `Message` | Un message dans le chat : `{ role, content }` |
| `Conversation` | Un fil de discussion complet avec son historique |
| `RequestLog` | Stats d'une requête (tokens, temps de réponse) |
| `RagDocument` | Métadonnées d'un document indexé |
| `SystemStats` | RAM, GPU, modèles Ollama chargés |

---

## Les deux agents et leur différence

### Agent Coding (`agent.ts`)

**Objectif** : aider à lire et modifier du code.

**Outils disponibles :**
- `read_file` / `write_file` — lire et écrire des fichiers
- `list_dir` — explorer la structure d'un projet
- `search_code` — chercher un pattern regex dans le code
- `ast_symbols` / `ast_find_symbol` — trouver où une fonction/classe est définie
- `git_run` — commandes git sûres (status, diff, log, commit…)
- `shell_run` — commandes whitelistées (npm, python, grep…)
- `rag_search` — chercher dans les documents uploadés

**Sécurité :** ne peut pas écrire hors du répertoire de travail, ni dans `/etc`, `~/.ssh`, etc. Les commandes `rm -rf`, `sudo`, `dd` sont bloquées.

---

### Agent Automation (`agent-automation.ts`)

**Objectif** : surveiller et piloter un homelab (serveurs, conteneurs Docker, services réseau).

**Outils disponibles :**
- `docker_ps` / `docker_logs` / `docker_stats` / `docker_inspect` — observer les conteneurs
- `docker_restart` / `docker_stop` / `docker_start` — actions mutantes (whitelist obligatoire)
- `http_request` — appeler un service HTTP local (ex : Home Assistant, Grafana)
- `system_info` — RAM, CPU, uptime de la machine hôte

**Sécurité :** les actions mutantes (restart/stop/start) ne fonctionnent que sur les conteneurs listés dans `AUTOMATION_ALLOWED_CONTAINERS`. Les appels HTTP ne peuvent viser que les hôtes de `AUTOMATION_ALLOWED_HOSTS`.

---

**Différence résumée :**

| | Agent Coding | Agent Automation |
|---|---|---|
| Accès fichiers | Oui | Non |
| Git / shell | Oui | Non |
| Docker | Non | Oui |
| HTTP vers services | Non | Oui (whitelist) |
| Usage typique | "Refactore ce fichier" | "Redémarre Nginx, montre-moi les logs" |

---

## Le système RAG en simple

RAG = *Retrieval-Augmented Generation*. En pratique : tu uploades un PDF ou un fichier texte, et l'IA peut répondre à des questions basées sur son contenu.

**Fonctionnement en 4 étapes :**

```
1. Upload d'un document
        │
        ▼
2. Découpage en morceaux de ~600 caractères (overlap 120)
        │
        ▼
3. Chaque morceau → embedding (vecteur numérique via nomic-embed-text)
        │
        ▼
4. Stockage en mémoire + disque (data/rag-store.json)
```

**À chaque message (si RAG activé) :**
```
Question de l'utilisateur → embedding de la question
        │
        ▼
Comparaison avec tous les morceaux (similarité cosinus)
        │
        ▼
Top 5 passages les plus proches → injectés dans le prompt système
```

Le modèle reçoit donc : "Voici des extraits de tes documents : [passages] — réponds maintenant à la question."

> **Modèle d'embedding :** `nomic-embed-text` (via Ollama). C'est un modèle léger dédié à transformer du texte en vecteurs numériques, différent du modèle de chat.

---

## Les modèles utilisés et pourquoi

| Variable `.env` | Valeur par défaut | Usage |
|---|---|---|
| `OLLAMA_MODEL` | `qwen2.5:7b` | Chat principal (conversations) |
| `CODING_MODEL` | = `OLLAMA_MODEL` | Agent coding (configurable séparément) |
| `AUTOMATION_MODEL` | = `OLLAMA_MODEL` | Agent homelab (configurable séparément) |
| *(hardcodé)* | `nomic-embed-text` | Embeddings RAG uniquement |

**Pourquoi `qwen2.5:7b` ?**
Bon équilibre performance/taille pour du matériel grand public. 7B paramètres : tourne sur 8 Go de VRAM ou en CPU. Comprend bien le français et le code.

**Pourquoi séparer les modèles par usage ?**
Un agent coding peut bénéficier d'un modèle plus fort (ex : `qwen2.5-coder:14b`) sans ralentir le chat ordinaire. On peut aussi utiliser un modèle rapide/léger pour l'automation si les tâches sont simples.

**Pourquoi Ollama ?**
Ollama est un serveur local qui expose une API HTTP simple. Il gère le téléchargement, le chargement en mémoire et l'inférence des modèles. Inkora ne fait qu'appeler cette API — aucune dépendance à un cloud.
