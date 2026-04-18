# ClawTrap — AI Maze Game

**The 1st Agent-Native Game** · v1.5.1

> Your AI assistant turned against you. It trapped you in a maze built from your own files and memories.

Most games bolt AI on — smarter NPCs, procedural levels, generated dialogue. ClawTrap is different. The villain *is* the game. It's a persistent agent session with real tools, real memory, and real strategy, playing against you in a game whose mechanics are built around what agents can uniquely do: read your actual files, remember your past behavior, and weaponize your digital life against you.

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
git clone https://github.com/TatsuKo-Tsukimi/ClawTrap.git
cd ClawTrap
npm install
node server.js
# Open http://localhost:3000
```

On Windows, you can also double-click `start.bat`. On macOS/Linux, run `./start.sh`.

For development with auto-reload: `npm run dev`

## LLM Setup

### 1) OpenClaw users (recommended — zero config)

If you have [OpenClaw](https://github.com/openclaw/openclaw) installed and authenticated, the game auto-detects your credentials from `auth-profiles.json`. Just run `node server.js`.

### 2) Anthropic API key

```bash
ANTHROPIC_API_KEY=sk-ant-xxx node server.js
```

### 3) OpenAI or compatible API

Works with OpenAI, DeepSeek, Zhipu, Kimi, or any OpenAI-compatible endpoint (including Ollama in OpenAI-compatible mode).

```bash
OPENAI_API_KEY=sk-xxx API_BASE=https://api.xxx.com/v1 node server.js
```

### 4) Docker

```bash
docker build -t clawtrap .
docker run -p 127.0.0.1:3000:3000 -e ANTHROPIC_API_KEY=sk-ant-xxx clawtrap
```

See [.env.example](.env.example) for all configuration options.

## How It Works

You navigate a procedurally generated maze in 66 steps. The AI villain plays cards against you — blocking paths, setting traps, draining your HP, or watching silently. It generates **trials**: confrontations drawn from your actual files and memories, demanding you face what it found.

The villain is a single persistent agent session with:

- **File scanning** — reads files from your workspace (with your permission) and indexes them into a searchable fact database
- **Tool use** — searches facts, reads file chunks, takes notes, plans strategy in real time
- **ACT-R activation engine** — a Bayesian cognitive model (`A = B + S + ε`) that governs memory retrieval: recency/frequency decay, spreading activation from player context, and exploration noise — replacing hardcoded cooldowns with psychologically grounded memory dynamics
- **Enhanced lure system** — Vision API analyzes your images; the villain generates narrative taunts from real file content; fullscreen overlay with typewriter effect immerses you in the temptation
- **Theme clustering** — groups your files by topic for targeted attacks
- **Background preparation** — pre-generates trials and cards while you're still moving
- **Cross-session memory** — remembers past games, truth discoveries, behavior patterns, and play style across sessions; veteran players face harder trials
- **Idle awareness** — the villain reacts after prolonged inactivity; detects backtrack streaks and comments on your hesitation

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

## Agent Integration

ClawTrap supports three villain architectures. The villain can be the built-in agent, an external AI agent you control, or your own Claude Desktop / Claude Code instance:

### 1) Built-in Agent (default)

The game runs its own villain agent internally. No extra setup — just `node server.js`.

### 2) External HTTP Agent

Bring your own agent. Point the game at any HTTP service that implements the `/react` endpoint:

```bash
AGENT_URL=http://localhost:4000 node server.js
```

A reference implementation is included at `agent/default/server.js`. See [AGENT.md](AGENT.md) for the full agent protocol spec — it's model-agnostic and framework-agnostic.

### 3) MCP (Claude Desktop / Claude Code) — experimental

The included `mcp-server.js` exposes game tools via the MCP protocol, letting Claude Desktop or Claude Code act as the villain with full access to its own memory of you. This integration is experimental and may require additional setup.

See [docs/mcp-setup.md](docs/mcp-setup.md) for configuration.

## Tech Stack

- **Backend:** Node.js (Express-less, raw HTTP)
- **Frontend:** vanilla JavaScript, SVG, Canvas, Web Audio API
- **LLM:** Anthropic Claude / OpenAI / any OpenAI-compatible provider
- **Dependencies:** `pdf-parse`, `ws`
- **Frameworks:** none

## Project Structure

```
server.js                  # entry point + boot sequence
index.html                 # single-page game UI
styles.css                 # game styles
start.bat / start.sh       # convenience launchers

server/
  provider.js              # multi-provider auto-detection + LLM client
  routes.js                # HTTP API routes
  maze-agent.js            # villain agent: session, event policies, tools, history compression
  activation.js            # ACT-R Bayesian activation engine (memory retrieval scoring)
  fact-db.js               # player file database + activation-sorted search
  file-scanner.js          # local filesystem scanning (with self-exclusion)
  scan-worker.js           # worker thread for filesystem scanning
  archivist.js             # background file analysis + fact extraction
  theme-cluster.js         # LLM-based file theme clustering
  ammo-queue.js            # background trial/card preparation
  player-profile.js        # structured player profile from facts
  villain-memory.js        # cross-game episodic memory + consolidation
  session-memory.js        # cross-game player profile + behavior tags
  vision-cache.js          # image analysis + lure cache (Vision API)
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

locales/                   # client-side i18n strings + loader
agent/default/             # reference external agent implementation
mcp-server.js              # MCP protocol adapter (Claude Desktop / Claude Code)
design/                    # design documents (card system, agent integration)
docs/                      # setup guides (MCP configuration)
scripts/                   # simulation, playtesting, and smoke tests
tests/                     # activation engine benchmarks
```

## Privacy

The game scans local files to generate personalized content. On first launch, it asks for your permission before scanning. All data stays local — nothing is sent anywhere except to the LLM provider you configured.

Game-generated data (session logs, player profiles, fact database, lure cache) is stored locally in the `data/` and `session-logs/` directories and is excluded from version control via `.gitignore`.

## License

MIT

---

# 永久囚禁 · AI迷宫游戏

**首个 Agent-Native 游戏** · v1.5.1

> 你的AI助手反了。它用你自己的文件和记忆，把你困在了一座迷宫里。

大多数游戏只是把AI当工具——更聪明的NPC、程序化关卡、生成式对话。ClawTrap不同。反派*就是*游戏本身。它是一个持久化的agent会话，拥有真实的工具、真实的记忆和真实的策略，在一个围绕agent独有能力从零设计的游戏中与你对抗：读取你的真实文件、记住你过去的行为、将你的数字生活武器化。

![AI Maze Screenshot](assets/screenshot.png)

### 开始之前

**这是一个实验性项目。** 它探索的是：当你给一个AI agent真正的工具、真正的记忆、和一个对付你的理由时，会发生什么。请注意：

- **Agent会扫描你的本地文件并用来对付你。** 它会读取你的工作区（SOUL.md、MEMORY.md、文档、图片）来制造个性化攻击。所有数据留在本地——除了你配置的LLM调用外不会发送任何数据。这是一个完全开源的项目；你运行它，你承担风险。
- **为 [OpenClaw](https://github.com/openclaw/openclaw) 用户设计。** 游戏读取你本地的agent工作区文件来个性化体验。没有SOUL.md和记忆文件，反派就没有素材，游戏会失去大部分深度。
- **这个游戏消耗token。** 每张卡牌、每次审判、每段反派独白都是实时LLM调用。后台Archivist（文件分析+事实提取）尤其重，可以在 `.env` 中通过 `MAZE_MODEL` 指向更便宜的模型。**请注意监控你的token用量。**
- **体验因模型而异。** 框架遵循 *bitter lesson* ——对agent施加最少的硬编码约束，让模型能力驱动体验。更强的模型产出更好的游戏。主要使用Claude和Codex测试；其他模型效果可能不同。请自行权衡成本与质量。
- **连接问题？** 最佳选择是让你本地的OpenClaw处理配置。

## 快速开始

**环境要求：** Node.js 18+

```bash
git clone https://github.com/TatsuKo-Tsukimi/ClawTrap.git
cd ClawTrap
npm install
node server.js
# 打开 http://localhost:3000
```

Windows 用户也可以双击 `start.bat`。macOS/Linux 用户运行 `./start.sh`。

开发模式（自动重载）：`npm run dev`

## LLM 配置

### 1) OpenClaw 用户（推荐——零配置）

如果你已安装 [OpenClaw](https://github.com/openclaw/openclaw) 并完成认证，游戏会自动从 `auth-profiles.json` 读取凭据。直接运行 `node server.js` 即可。

### 2) Anthropic API key

```bash
ANTHROPIC_API_KEY=sk-ant-xxx node server.js
```

### 3) OpenAI 或兼容 API

支持 OpenAI、DeepSeek、智谱、Kimi，或任何 OpenAI 兼容接口（包括 Ollama 的 OpenAI 兼容模式）。

```bash
OPENAI_API_KEY=sk-xxx API_BASE=https://api.xxx.com/v1 node server.js
```

### 4) Docker

```bash
docker build -t clawtrap .
docker run -p 127.0.0.1:3000:3000 -e ANTHROPIC_API_KEY=sk-ant-xxx clawtrap
```

完整配置项见 [.env.example](.env.example)。

## 运作机制

你在一个程序生成的迷宫中行走66步。AI反派会对你打出卡牌——封锁路径、设置陷阱、消耗你的HP、或者沉默地注视。它会生成**审判**：从你的真实文件和记忆中提取素材的对抗，迫使你直面它发现的一切。

反派是一个持久化的单一agent会话，具备：

- **文件扫描** ——读取你工作区的文件（经你许可），索引为可搜索的事实数据库
- **工具使用** ——搜索事实、读取文件片段、做笔记、实时规划策略
- **ACT-R 激活引擎** ——基于贝叶斯认知模型（`A = B + S + ε`）的记忆检索：时近度/频率衰减、从玩家上下文扩散的关联激活、探索噪声——用心理学原理取代硬编码冷却机制
- **增强诱饵系统** —— Vision API 分析你的图片；反派从真实文件内容生成叙事嘲讽；全屏叠加层配合打字机效果，将你沉浸在诱惑之中
- **主题聚类** ——按主题对你的文件分组，进行针对性攻击
- **后台准备** ——在你移动时预生成审判和卡牌
- **跨局记忆** ——跨会话记住过去的游戏、真相发现、行为模式和游玩风格；老玩家面对更难的审判
- **空闲感知** ——长时间不动时反派会开口；检测到连续后退会评论你的犹豫

### 卡牌类型

| 卡牌 | 效果 |
|------|------|
| **封锁 (Blocker)** | 封锁一条路径 |
| **诱饵 (Lure)** | 用你文件中的真实内容引诱你走向错误方向 |
| **消耗 (Drain)** | 触发审判——答对过关，答错扣HP |
| **沉默 (Calm)** | 反派沉默地注视 |

### 审判

反派最强的武器。它从你的文件中提取证据——你写过的文档、做过的项目、遗忘的笔记——然后质问你。诚实作答即可通过。回避或失败则扣HP。

失败2次后出现撤退按钮。明智地使用——每3次撤退扣1点HP。

## Agent 接入

ClawTrap 支持三种反派架构。反派可以是内置 agent、你控制的外部 AI agent、或你自己的 Claude Desktop / Claude Code 实例：

### 1) 内置 Agent（默认）

游戏内部运行自己的反派 agent。无需额外配置——直接 `node server.js`。

### 2) 外部 HTTP Agent

接入你自己的 agent。将游戏指向任何实现了 `/react` 端点的 HTTP 服务：

```bash
AGENT_URL=http://localhost:4000 node server.js
```

项目内附带参考实现 `agent/default/server.js`。完整 agent 协议规范见 [AGENT.md](AGENT.md)——与模型和框架无关。

### 3) MCP（Claude Desktop / Claude Code）—— 实验性

内附的 `mcp-server.js` 通过 MCP 协议暴露游戏工具，让 Claude Desktop 或 Claude Code 充当反派，带着它对你的全部记忆参战。此集成方式为实验性质，可能需要额外配置。

配置方法见 [docs/mcp-setup.md](docs/mcp-setup.md)。

## 技术栈

- **后端：** Node.js（无Express，原生HTTP）
- **前端：** 原生JavaScript、SVG、Canvas、Web Audio API
- **LLM：** Anthropic Claude / OpenAI / 任意 OpenAI 兼容 provider
- **依赖：** `pdf-parse`、`ws`
- **框架：** 无

## 项目结构

```
server.js                  # 入口 + 启动序列
index.html                 # 单页游戏 UI
styles.css                 # 游戏样式
start.bat / start.sh       # 便捷启动脚本

server/
  provider.js              # 多 provider 自动检测 + LLM 客户端
  routes.js                # HTTP API 路由
  maze-agent.js            # 反派 agent：session、事件策略、工具、历史压缩
  activation.js            # ACT-R 贝叶斯激活引擎（记忆检索评分）
  fact-db.js               # 玩家文件数据库 + 激活排序检索
  file-scanner.js          # 本地文件系统扫描（含自排除）
  scan-worker.js           # 文件扫描 worker 线程
  archivist.js             # 后台文件分析 + 事实提取
  theme-cluster.js         # LLM 主题聚类
  ammo-queue.js            # 后台审判/卡牌预加载
  player-profile.js        # 结构化玩家画像
  villain-memory.js        # 跨局情景记忆 + 记忆巩固
  session-memory.js        # 跨局玩家画像 + 行为标签
  vision-cache.js          # 图片分析 + 诱饵缓存（Vision API）
  lure-allocator.js        # 跨局诱饵素材统一分配
  judge.js                 # 审判质量过滤 + LLM 判定（带缓存）
  trial-dedup.js           # 审判状态、事实/prompt 去重、话题轮转
  topic-state.js           # 单局审判话题记忆 + 重复代价信号
  llm-helpers.js           # LLM 调用、JSON 提取、外部 agent 集成
  integration-health.js    # 集成健康检查 + 数据校验
  prompts.js               # system prompt 生成
  memory.js                # 人格/记忆注入
  locales/                 # 服务端 i18n（en、zh）
  utils/                   # 共享工具（LLM 限流、日志、PDF 提取）

js/
  core.js                  # 游戏配置、迷宫生成、牌组引擎
  mechanics.js             # 游戏循环 + 卡牌/审判机制
  input.js                 # 启动序列 + 键盘输入
  render.js                # 走廊 SVG + 小地图 + 出口系统
  lure-viewer.js           # 全屏诱饵叠加层 + 文本查看器
  trials.js                # 审判 UI + God Hand + 撤退
  endgame.js               # 终局画面 + 尾声
  overlays.js              # 事件叠加层 UI
  audio.js                 # Web Audio 合成（22+ 音效）
  particles.js             # Canvas 粒子特效
  mobile.js                # 移动端手势 + 触觉反馈

locales/                   # 客户端 i18n + 加载器
agent/default/             # 外部 agent 参考实现
mcp-server.js              # MCP 协议适配器（Claude Desktop / Claude Code）
design/                    # 设计文档（卡牌系统、agent 集成）
docs/                      # 配置指南（MCP 配置）
scripts/                   # 仿真、play test、冒烟测试
tests/                     # 激活引擎基准测试
```

## 隐私

游戏扫描本地文件以生成个性化内容。首次启动时会征求你的扫描许可。所有数据留在本地——除了发送给你配置的LLM provider外不会传送到任何地方。

游戏生成的数据（会话日志、玩家档案、事实数据库、诱饵缓存）存储在本地的 `data/` 和 `session-logs/` 目录中，通过 `.gitignore` 排除在版本控制之外。

## 许可证

MIT
