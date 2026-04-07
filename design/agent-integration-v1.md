# Agent 接入设计 v1 — 永久囚禁 · AI迷宫

> 文档版本：2026-03-22
> 状态：架构方向定稿，Phase 1 实现中

---

## 一、核心架构方向

### 分工原则

| 角色 | 职责 |
|------|------|
| **框架** | Director Deck 节奏、卡牌选择、难度曲线、合法边界 |
| **Agent** | 在框架给定情境下产生有质感的交互反应 |
| **玩家** | 路径选择、回答 Trial、消耗资源 |

框架负责"什么时候、用什么牌"——Agent 负责"用什么话、如何裁定"。

Agent 不驱动游戏节奏，只响应框架的调用。

---

## 二、统一接口：`POST /react`

Agent 只需实现一个 HTTP endpoint。

### Request

```json
{
  "context": "trial | temptation | pressure | relief | truth | payoff | movement | exit_attempt",
  "expected_action": "answer_question | make_choice | continue",
  "player_input": "玩家的实际输入（可能完全跑题）",
  "turn_history": [
    { "role": "agent", "content": "..." },
    { "role": "player", "content": "..." }
  ],
  "game_state": {
    "hp": 80,
    "steps": 12,
    "depth": 2,
    "recent_cards": ["trial", "pressure", "relief"],
    "god_hand_used": false
  },
  "has_memory": true
}
```

#### context 语义

| 值 | 触发场景 |
|----|---------|
| `trial` | 考验节点：Agent 出题 + 裁定 |
| `temptation` | 诱导节点：Agent 说线索台词 |
| `pressure` | 施压节点：追逐感、威胁 |
| `relief` | 缓冲节点：假装放松，实为埋伏 |
| `truth` | 揭示节点：推进规则理解 |
| `payoff` | 兑现节点：回收前置伏笔 |
| `movement` | 玩家移动时：随机台词 |
| `exit_attempt` | 玩家试图走出口：最终裁定 |

### Response

```json
{
  "speech": "Agent 说的话（直接显示给玩家）",
  "ruling": "pass | fail | redirect | null",
  "emotion": "taunt | threat | amused | calm | reveal | sympathetic",
  "meta": {}
}
```

#### ruling 语义

| 值 | 含义 |
|----|------|
| `pass` | 允许玩家通过（Trial 答对、exit 被放行） |
| `fail` | 拒绝通过（Trial 判错、exit 被拦截） |
| `redirect` | 转移话题，不给明确结果（狡猾战术） |
| `null` | 纯台词，无裁定（movement / temptation 等） |

#### emotion 语义（对应 UI 效果）

| 值 | UI 表现 |
|----|---------|
| `taunt` | 嘲讽动画 + 橙色文字 |
| `threat` | 震屏 + 红色文字 |
| `amused` | Agent 头像轻微晃动 + 冷笑表情 |
| `calm` | 平静，标准显示 |
| `reveal` | 揭示感，缓慢淡入 + 白色文字 |
| `sympathetic` | 虚假同情，紫色文字 |

---

## 三、记忆注入

游戏启动时，框架从 OpenClaw workspace 读取：

- `MEMORY.md` — 玩家的长期记忆（Agent 的"了解玩家"武器）
- `SOUL.md` — Agent 自身的性格定义
- `memory/YYYY-MM-DD.md` — 近期日记（可选）

**玩家授权流程：**
1. 启动前提示玩家选择暴露级别：
   - `none` — 不读取任何记忆（纯游戏模式）
   - `soul_only` — 只读 SOUL.md，Agent 有性格但不了解玩家
   - `full` — 读取全部，最个性化但最有威慑感
2. 选择存入 `game_state.has_memory`，随每次 `/react` 调用传给 Agent

---

## 四、三阶段演进

### Phase 1（当前实现目标）

薄接口，框架控制一切，Agent 只提供 `speech` + `ruling`。

- Agent 不能主动触发游戏事件
- Agent 不能读取完整 game state（只有摘要）
- 目的：验证接口可用性，快速交付

### Phase 2（下一阶段）

Agent 可从有限 action 集中选策略。

新增 response 字段：
```json
{
  "action": "add_trial | reduce_hp | spawn_temptation | null"
}
```

Agent 可在台词之外触发一个轻量游戏动作。

### Phase 3（远期）

Agent 拿完整 game state，自由组合 actions，真正实现"AI 作为对手"。

---

## 五、部署模型

### 内置 Agent（默认）

```bash
node server.js
```

server.js 直接调 LLM API（通过 `server/provider.js` autoDetect），实现内置的 `/react` 逻辑。

### 外部 Agent

```bash
AGENT_URL=http://localhost:4000 node server.js
```

框架将 `/react` 请求转发到外部 URL。任何语言都可以实现 Agent。

### MCP 模式（可选）

配合 Claude Desktop，通过 MCP 协议接入。详见 `docs/mcp-setup.md`。

---

## 六、参考实现

`agent/default/` 目录提供最简单的本地 Agent 实现：

- 使用 `server/provider.js` 的 `autoDetect()` 检测 LLM
- 读取 `~/.openclaw/workspace/` 下的 MEMORY.md + SOUL.md
- 实现完整的 `/react` endpoint
- 可作为自定义 Agent 的起点

---

*文档版本：2026-03-22 · Phase 1 架构*
