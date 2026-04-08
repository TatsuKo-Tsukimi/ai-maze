# 永久囚禁 · AI迷宫游戏 (AI Maze Game)

> Your AI assistant turned against you. It trapped you in a maze built from your own files and memories.

A single-player horror game where the villain is a persistent AI that reads your real files, remembers how you played, and weaponizes your digital life against you. Not a chatbot with a theme — a full adversarial agent with tools, memory, and strategy.

![AI Maze Screenshot](assets/screenshot.png)

### Before You Play

**This is an experimental project.** It explores what happens when you give an AI agent real tools, real memory, and a reason to use them against you. Please be aware:

- **The agent scans your local files and uses them against you.** It reads your workspace (SOUL.md, MEMORY.md, documents, images) to craft personalized attacks. All data stays local — nothing leaves your machine except LLM calls to the provider you configured. This is a fully open-source project; you run it, you own the risk.
- **Designed for [OpenClaw](https://github.com/openclaw/openclaw) users.** The game reads your local agent workspace files to personalize the experience. Without SOUL.md and memory files, the villain has nothing to work with and the game loses most of its depth.
- **This game consumes tokens.** Every card, trial, judgment, and villain monologue is a live LLM call. The background archivist (file analysis + fact extraction) is especially heavy — point it at a cheaper model via `MAZE_MODEL` in `.env`. **Please monitor your token usage carefully.**
- **Experience varies by model.** The framework follows the *bitter lesson* — minimal hardcoded constraints on the agent, letting model capability drive the experience. Stronger models produce better games. Tested primarily with Claude and Codex; results with other models may vary. Balance cost vs. quality as you see fit.
- **Connection issues?** The best option is to let your local OpenClaw handle the configuration.

## Quick Start

**Requirements:** Node.js 18+

```bash
git clone https://github.com/TatsuKo-Tsukimi/ai-maze.git
cd ai-maze
npm install
node server.js
# Open http://localhost:3000
```

## LLM Setup

### 1) OpenClaw users (recommended — zero config)

If you have [OpenClaw](https://github.com/openclaw/openclaw) installed and authenticated, the game auto-detects your credentials from `auth-profiles.json`. Just run `node server.js`.

### 2) Anthropic API key

```bash
ANTHROPIC_API_KEY=sk-ant-xxx node server.js
```

### 3) OpenAI or compatible API

Works with OpenAI, DeepSeek, Zhipu, Kimi, or any OpenAI-compatible endpoint.

```bash
OPENAI_API_KEY=sk-xxx API_BASE=https://api.xxx.com/v1 node server.js
```

### 4) Docker

```bash
docker build -t ai-maze .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-xxx ai-maze
```

See [.env.example](.env.example) for all configuration options.

## How It Works

You navigate a procedurally generated maze in 66 steps. The AI villain plays cards against you — blocking paths, setting traps, draining your HP, or watching silently. It generates **trials**: confrontations drawn from your actual files and memories, demanding you face what it found.

The villain is a single persistent agent session with:

- **File scanning** — reads files from your workspace (with your permission) and indexes them into a searchable fact database
- **Tool use** — searches facts, reads file chunks, takes notes, plans strategy in real time
- **Theme clustering** — groups your files by topic for targeted attacks
- **Background preparation** — pre-generates trials and cards while you're still moving
- **Episodic memory** — remembers past games, what worked, what didn't, and adapts
- **Quality feedback loop** — self-assesses trial quality; the system cross-validates against player behavior and feeds results back for calibration

### Card Types

| Card | Effect |
|------|--------|
| **Blocker** | Blocks a path |
| **Lure** | Tempts you toward a wrong direction with real content from your files |
| **Drain** | Triggers a trial — answer correctly or lose HP |
| **Calm** | The villain watches in silence |

### Trials

The villain's strongest weapon. It pulls evidence from your files — a document you wrote, a project you worked on, a note you forgot about — and confronts you with it. Answer honestly and you pass. Dodge or fail and you lose HP.

After 2 failed attempts, a retreat button appears. Use it wisely — 3 retreats cost 1 HP.

## Tech Stack

- **Backend:** Node.js (Express-less, raw HTTP)
- **Frontend:** vanilla JavaScript, SVG, Canvas, Web Audio API
- **LLM:** Anthropic Claude / OpenAI / any compatible provider
- **Dependencies:** `pdf-parse`, `ws`
- **Frameworks:** none

## Project Structure

```
server.js                  # entry point + boot sequence
server/
  provider.js              # multi-provider auto-detection + LLM client
  routes.js                # HTTP API routes
  maze-agent.js            # villain agent: session, event policies, tools, history compression
  fact-db.js               # player file database + search
  file-scanner.js          # local filesystem scanning (with self-exclusion)
  scan-worker.js           # worker thread for filesystem scanning
  archivist.js             # background file analysis + fact extraction
  theme-cluster.js         # LLM-based file theme clustering
  ammo-queue.js            # background trial/card preparation
  player-profile.js        # structured player profile from facts
  villain-memory.js        # cross-game episodic memory
  session-memory.js        # cross-game player profile mid-term memory
  vision-cache.js          # image analysis + lure cache
  lure-allocator.js        # unified lure material allocation across games
  judge.js                 # trial quality filter + LLM judgment with caching
  trial-dedup.js           # trial state, fact/prompt dedup, topic rotation
  topic-state.js           # per-game trial topic memory + repeat cost signals
  llm-helpers.js           # LLM calls, JSON extraction, external agent integration
  integration-health.js    # integration health checks + data validation
  prompts.js               # system prompt generation
  memory.js                # personality/memory injection
  locales/                 # server-side i18n strings (en, zh)
  utils/                   # shared helpers (LLM gating, logging, PDF extraction)
locales/                   # client-side i18n strings + loader
js/
  core.js                  # game config, maze generation, deck engine
  mechanics.js             # gameplay loop + card/trial mechanics
  input.js                 # boot sequence + keyboard input
  render.js                # corridor SVG + minimap + exit system
  lure-viewer.js           # fullscreen lure overlay + text viewer
  trials.js                # trial UI + God Hand + retreat
  endgame.js               # endgame screen + epilogue
  overlays.js              # event overlay UI
  audio.js                 # Web Audio synthesis (22+ sound effects)
  particles.js             # canvas particle effects
  mobile.js                # mobile gestures + haptics
```

## Privacy

The game scans local files to generate personalized content. On first launch, it asks for your permission before scanning. All data stays local — nothing is sent anywhere except to the LLM provider you configured.

Game-generated data (session logs, player profiles, fact database, lure cache) is stored locally in the `data/` and `session-logs/` directories and is excluded from version control via `.gitignore`.

## License

MIT
