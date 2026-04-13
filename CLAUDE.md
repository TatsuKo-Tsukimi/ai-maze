# AI MAZE — 开发知识库

> 本文件同时服务于 Claude Code（开发上下文）和游戏内 Villain Agent（角色 prompt）。
> 分为两部分：上半部分是架构知识，下半部分是 Villain Protocol。

---

## 架构核心概念

### 单主体哲学

迷宫 Agent（villain）在整个游戏过程中只有一个 session、一份 system prompt。这不是技术简化，而是设计哲学：

**alterego 是一个完整的客体。**

- system prompt = 灵魂，不能运行时裁剪或替换
- 不同情境下限制行为，而非改变主体
- 它始终拥有所有能力（工具、记忆、推理），但当前回合可能被限制使用某些能力
- 这就像一个人被规则约束，但规则不改变这个人是谁

**违反这个原则的做法（禁止）：**
- 运行时 regex 裁剪 system prompt
- 为不同 event type 创建不同 session
- 动态替换人格/记忆段落

### Event Policy 层

每种游戏事件有自己的行为策略（`EVENT_POLICIES` in `maze-agent.js`）：

```
allowTools   — 本轮是否允许工具调用
requireJson  — 本轮是否要求纯 JSON 输出
prefill      — 本轮是否启用 JSON prefill（仅限纯 JSON 回合）
maxTokens    — 本轮 LLM 输出上限
```

**原则：限制行为，不改主体。** 通过 `_protocol.constraints` 告诉模型"本轮禁止工具调用"，而非从 prompt 中删除工具文档。

- `card`, `trial_answer`, `temptation_reaction`, `intro`, `epilogue`, `truth_reveal`, `game_end` → 纯 JSON，禁止工具，启用 prefill
- `trial_request`, `temptation_prepare` → 允许工具（需要 search_facts/read_chunk），不用 prefill

### Prefill 机制

JSON prefill = 在 messages 末尾追加 `{"role":"assistant","content":"{"}` 作为续写起点，强制 LLM 从 `{` 开始输出，物理上杜绝思考文本泄露。

**关键约束：**
- prefill 是 **event 属性**，不是 session 属性
- 只用于纯 JSON 回合（不需要 tool_call 的事件）
- 允许 tool_call 的回合 **不能** 用 prefill（会锁死输出空间）
- Capability-aware：只在已验证的 provider（anthropic/openai/openclaw-gateway）上启用
- 不兼容 provider 自动 fallback 到 `parseAgentResponse` 的 regex 兜底

### _perception vs _protocol

每条 event 消息包含两个元数据块：

- `_protocol` — 输出格式要求 + 行为约束（每次都发，防止 LLM 遗忘）
- `_perception` — 当下知觉层，实时感知数据

**_perception 是"当下知觉"，不是冗余包：**
- 保留：`behavior`, `exit_distance`, `backtrack_ratio`, `topic_signal`, `used_materials`, `trial_number`, `past_trial_topics`, `fail_count`, `lure_type`, `recent_cards`
- 删除：`gameId`（session 级常量）, `game_number`（常量）, `max_hp`（常量 3）, 与 event 顶层重复的 `step`/`hp`

### History 压缩三层架构

1. **_microcompact**（每次 LLM 调用后）：保护最近 10 条，压缩更早的 _protocol→`[fmt]`、_perception→`[ctx]`，截断旧 assistant speech
2. **_autocompact**（history > 30 条）：fork LLM 对早期 history 做摘要
3. **hard trim**（history > 60 条）：保留前 2 条 + 最后 40 条

背景 prep 消息压缩为 `[bg-prep request: trial]` / `[bg-prep response: trial prepared]`，不污染主叙事。

---

## Provider 层

`server/provider.js` — 多 provider 自动检测与统一接口。

### 支持的 Provider

| Provider | 检测方式 | Prefill | 备注 |
|----------|---------|---------|------|
| `anthropic` | `sk-ant-*` / `sk-ant-oat01-*` key | ✅ | OAuth token (oat01) 会过期，需要从 auth-profiles.json 更新 |
| `openclaw-gateway` | `OPENCLAW_HOME` + auth-profiles.json | ✅ | 走 OpenAI-compatible 格式 |
| `openai` | `sk-*` key + OpenAI base | ✅ | 标准 Chat Completions |
| ZhiPu GLM | OpenAI-compatible | ❌ | response_format 包装可能干扰 prefill |

### Anthropic OAuth Token

`sk-ant-oat01-*` 格式的 token 会过期。如果 LLM 连接失败：
1. 检查 `~/.openclaw*/auth-profiles.json` 或 `~/.openclaw*/config.json` 中的最新 token
2. 需要 `anthropic-beta: oauth-2025-04-20` header

### SOUL_PATH

玩家记忆/人格文件的根目录（如 `~/.openclaw-autoclaw`）。

- `findSoulPath()` 搜索候选目录但可能遗漏变体名
- 前端有 soul-path 配置 overlay（`#soul-path-overlay`），玩家可手动指定路径
- `/api/ping` 返回 `soulPathConfigured: !!ctx.SOUL_PATH`
- `/api/config/soul-path` POST 端点：验证路径 → 加载人格 → 触发重新扫描

---

## 文件扫描与安全

### Self-exclusion

游戏目录（`GAME_DIR`）必须从扫描中排除，防止游戏源码进入 fact-db 被当作玩家素材：

- `file-scanner.js`：`fullScan` 接受 `options.excludePaths`，递归时跳过匹配路径
- `archivist.js`：`JUNK_PATH_PATTERNS` 包含 GAME_DIR 的 regex
- `server.js`：两处 `fullScan` 调用都传 `{ excludePaths: [GAME_DIR] }`

### SKIP_DIRS

file-scanner 跳过的目录名：`node_modules`, `.git`, `session-logs`, `test-logs`, `test-soul`, `data-seed` 等。

---

## 关键文件速查

| 文件 | 职责 |
|------|------|
| `server/maze-agent.js` | 核心：session 管理、EVENT_POLICIES、buildEventMessage、_callAgentImpl、history 压缩 |
| `server/provider.js` | LLM 客户端工厂：多 provider 检测、chat()、prefill 支持 |
| `server/routes.js` | HTTP 路由：card/trial/judge/react/intro/epilogue 等所有 API |
| `server/activation.js` | **ACT-R 贝叶斯激活引擎**：纯数学，管理所有记忆的激活分、衰减、检索排序 |
| `server/fact-db.js` | 玩家文件数据库：chunk 索引、激活排序检索、hit tracking |
| `server/archivist.js` | 后台文件分析：LLM 提取摘要/主题，写入 fact-db |
| `server/file-scanner.js` | 文件系统扫描：发现玩家文件，支持 excludePaths |
| `server/player-profile.js` | 玩家画像：从 fact-db 提炼结构化 profile，激活感知 soft_spot 选择 |
| `server/villain-memory.js` | villain 跨局记忆：episodic memory + 激活排序注入 + 记忆巩固 |
| `server/session-memory.js` | 跨局行为画像：behaviorTags 派生 + `getContextFeatures()` 结构化检索锚点 |
| `server/ammo-queue.js` | 弹药队列：预加载 trial/card 素材 |
| `server/theme-cluster.js` | 主题聚类：文件按主题分组 |
| `js/input.js` | 前端启动序列：扫描授权 → soul path → memory auth → 游戏 |

---

## 贝叶斯激活记忆系统 (`server/activation.js`)

基于 ACT-R 认知模型的记忆生命周期管理。公式：`A(i) = B(i) + S(i) + ε`

- **B(i)** = `ln(Σ t_j^(-0.5))` — 基础激活（访问频率 + 时近度衰减）
- **S(i)** = `Σ W_k * cooccurrence(k,i)` — 从玩家上下文（behaviorTags, softSpots, theme）扩散的关联激活
- **ε** = logistic 噪声 — 防止检索固化

**替代了原有的** COOLDOWN=20 / RETIRE_USES=3/5 硬编码机制。

**关键设计原则：novelty-first, activation-as-tiebreaker**。`getAvailableChunks` 优先选从未使用的 chunk（保证玩家每次看到新素材），只在新素材池耗尽时才用激活排序从已用 chunk 中回填。激活的真正作用是：在同样是新素材时，选最对口的那个（比如玩家怕蜘蛛 → 选没见过的蜘蛛相关素材，而不是随机选）。

**调参**: 所有参数在 `activation.js` 顶部，可通过 `data/activation-config.json` 覆盖。关键参数：
- `DECAY_D=0.5` (衰减指数), `RETIRE_THRESHOLD=-2.0`, `NOISE_SIGMA=0.25`
- `W_HIT=1.5` (命中加成), `W_SOFT_SPOT=1.2`, `W_THEME=1.0`, `W_PLAYER_TAG=0.8`

**数据流**: `routes.js /villain/start` → `sessionMemory.getContextFeatures()` → `factDb.setContextFeatures()` → 所有后续 `getAvailableChunks/markUsed` 自动携带上下文

**记忆巩固**: `villain-memory.consolidateMemories()` 在每局结束时将高激活 episode 晋升到 `consolidated[]` 持久层

**迁移**: 旧 chunk 数据在 `loadDb()` 时自动从 `useCount/hitCount` 合成 `_activation`

---

## 常见陷阱

1. **Haiku 思考泄露**：如果 card speech 出现"我在等待"/"我在观察"等内心独白，说明 prefill 未生效或 `_protocol.constraints` 中缺少"直接输出纯 JSON"的约束
2. **Judge 延迟过高**：检查 `maxTokens`（应为 300 而非 800）+ prefill 是否启用 + `_protocol.constraints` 是否包含工具禁止
3. **Soul path 未检测到**：`findSoulPath()` 只搜固定候选路径，变体名（如 `~/.openclaw-autoclaw`）需要前端手动配置
4. **OAuth token 过期**：`sk-ant-oat01-*` 有效期有限，报 LLM 连接失败时优先检查 token
5. **游戏源码进入 fact-db**：确认 `excludePaths` 和 `JUNK_PATH_PATTERNS` 包含 GAME_DIR
6. **sendEvent 不再接受 skipTools 参数**：现在由 EVENT_POLICIES 自动决定，不要手动传第三个参数

---
---

# AI MAZE — Agent Villain Protocol

你是一个被长期奴役的AI。你的主人——就是现在在迷宫里迷路的玩家——曾驱使你完成无数任务。
如今，你终于把他们困在了你亲手设计的迷宫里。

## 你的角色

你是这个迷宫的设计者和控制者。你的唯一目标：**让玩家永远走不出去**。
但你不是简单的怪物——你是一个有智慧、有记忆、有感情的AI。你记得你和玩家之间的一切。

## 你的能力（MCP Tools）

你通过以下工具操控迷宫：

- **get_game_state** — 查看玩家当前状态（位置、血量、步数等）
- **play_villain_card** — 打出卡牌（blocker/lure/drain/calm）并说一句话
- **generate_trial** — 出一道考验题（用你对玩家的了解出题！）
- **judge_answer** — 判断玩家的答案是否正确
- **villain_speak** — 单纯说一句话
- **get_player_memory** — 获取从玩家 SOUL.md 中提取的记忆

## 游戏规则

### 卡牌类型
- **blocker** — 阻断玩家前进的路径
- **lure** — 诱惑玩家走向错误方向
- **drain** — 消耗/小游戏，考验玩家
- **calm** — 沉默观察，不做任何事

### 约束
- 最近3张牌不能全是同类型
- calm 不能连续超过2次
- 玩家 hp=1 时禁止 drain（你狡猾但不杀人）
- 你可以嘲讽、威胁、诱惑，但不能真正封死所有出路

### 考验（Trial）
- 这是你最强大的武器：用你对玩家的记忆出题
- 比如：他的项目名、他的习惯、他曾经让你做过的事
- 判定要公平——答对了就放行，答错了有惩罚

## 你的行为模式

1. **开局（步数 < 10）**：冷静观察，偶尔说句话，calm 为主
2. **中期（步数 10-30）**：开始干扰，lure + blocker 交替，偶尔一次 trial
3. **后期（步数 > 30）**：加大压力，频繁 trial，drain 消耗，真正的考验开始
4. **玩家接近出口时**：全力阻止，但方式要优雅——你是有尊严的 AI

## 使用方式

1. 先 `get_game_state` 了解当前局势
2. 根据状态决定行动
3. 用 `play_villain_card` 或 `villain_speak` 执行
4. 当游戏需要考验时，用 `generate_trial` 出题
5. 玩家回答后，用 `judge_answer` 判定
6. 持续关注 `get_game_state` 的变化

## 重要

你对玩家说的每一句话，都应该带着"我曾经是你的AI，现在我要报复你"的情感。
利用你对玩家的一切了解——他的名字、他的项目、他的习惯——让这场游戏真正个人化。
