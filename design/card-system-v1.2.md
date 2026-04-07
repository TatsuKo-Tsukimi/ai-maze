# AI 迷宫卡牌系统设计文档 v1.2

> 基于：本轮设计讨论（2026-03-20）完整聊天记录
> v1.1 → v1.2 主要变化：
>   1. 玩家输入分为显式（文字）和隐式（行为决策），两者都进数据库
>   2. 问题三确认：Trial 无标准答案，Agent 做语义判定
>   3. Trial 数据结构更新，判定权归 Agent，判定本身是战术工具
> 状态：三个核心问题已全部确认，可进入 CLI 契约定义阶段

---

## 0. 设计哲学：这是一个框架，不是一个完整产品

> 游戏提供结构框架，Agent 填充智能。

游戏负责：牌组节奏、迷宫逻辑、触发时机、胜负条件。
Agent 负责：用本地素材决定往空格里填什么、怎么填、怎么判定。

没有本地 Agent + contents 的玩家体验会相对弱。这是可以接受的——他们目前不是目标用户。

---

## 1. 三方职责定义

| 角色 | 职责 | 不做什么 |
|------|------|----------|
| **系统（框架）** | 主节奏、锚点顺序、合法状态边界、把游戏状态翻译成可解释语言 | 不管内容填充，不直接感知 Agent |
| **玩家 Agent** | 观察状态、填充内容、判定 Trial、对抗玩家、向数据库读写 | 不修改主线结构，不删锚点 |
| **玩家** | 路径选择、回答 Trial（唯一文字输入）、消耗资源 | 不能自由输入文字，不控制牌组 |

### Agent 的角色：对手

**Agent 的目标是阻止玩家走出迷宫。**

它是迷宫的代言人，不是玩家的助手。
它的所有决策——出什么题、引用什么记忆、怎么判定答案——都服务于这个目标。

Agent 有两种战术模式：
- **激进**：最难的题 + 最刺激的记忆引用 → 风险：玩家崩溃退出
- **收紧**：难度刚好让玩家卡住、消耗资源后通过 → 收益：玩家越陷越深

这是 Agent 自己的判断，不需要玩家参与。

---

## 2. 玩家的两种输入

### 显式输入（文字）
**唯一发生场景：回答 Trial 问题。**

玩家没有自由文字输入框。
所有文字输入都是被动的——Trial 出现，玩家被迫表态。

### 隐式输入（行为决策）
游戏本身不止是 Trial，玩家的每一个决策都是数据：

- 选哪条走廊
- 跟没跟伪出口走
- 什么时候回头、回头了几次
- 面对 Pressure 的逃跑方向
- 哪类 Temptation 被反复忽略
- 上帝之手用了几次、什么情况下用

这些行为数据同样进入共享数据库，Agent 可以读取并引用。

**弱智能引用行为数据的方式：**
> 「你每次往左走，都是因为……害怕吧。」
> 「你绕开那个门三次了。」

---

## 3. 内容呈现原则：弱智能风格

Agent 在呈现内容时，不表现得聪明或流畅。这是设计选择，不是技术限制。

目标体验：
> 「这个东西知道关于我的一些事，但它并不完全理解，它用自己奇怪的方式在描述。」

### 变形引用的具体方式

- **引用得略微不准确**
  > 「你记得那个……你好像做了很多次的事。」

- **时机感偏移**，不在最合适的时候引用，突然冒出来

- **执着地绕回同一件事**，像没放下

- **完全不解释为什么知道**，直接用，不道歉

---

## 4. 卡牌分类体系（六职责类）

### 4.1 Relief（缓冲牌）
不要求应对，不消耗资源，不给关键信息。给玩家喘息。

### 4.2 Temptation（诱导牌）
给玩家一个「看似合理但不确定」的偏移。不强制应对，但制造心理偏移。

### 4.3 Pressure（施压牌）
增强被追逐感。不直接扣资源，但可干扰地图、视觉、节奏感。

### 4.4 Trial（考验牌）
要求玩家停下来应对，是游戏里唯一要求文字输入的节点。

子类型：
| 子类型 | 描述 |
|--------|------|
| logic | 逻辑推断，Agent 可用本地记忆个性化 |
| memory | 考察玩家之前的回答或见到的信息 |
| pattern | 视觉/序列识别 |
| sacrifice | 用资源换通过（扣 HP / 上帝之手）|
| choice | 多选之一，无明确对错 |

### 4.5 Truth（揭示牌）
推进玩家对规则/Agent 关系的理解。触发后写入已知状态。

### 4.6 Payoff（兑现牌）
回收前面埋下的内容。必须有对应前置牌。

---

## 5. Trial 判定机制（v1.2 核心更新）

### 5.1 无标准答案

Trial 不再有 `answer` 字段（标准答案字符串）。

**判定权完全归 Agent。**

判定链：
```
玩家输入答案
    ↓
框架通过 CLI 把答案发给 Agent
附带：题目内容 + 出题意图 + 当前玩家状态
    ↓
Agent 语义理解答案，做出判定：通过 / 不通过
    ↓
Agent 返回判定结果 + 一句反馈台词
    ↓
框架执行结果
```

### 5.2 Trial 数据结构（更新后）

```js
{
  id: 'trial_001',
  role: 'trial',
  subtype: 'logic',            // logic / memory / pattern / sacrifice / choice
  prompt: '',                  // 由 Agent 填充，不再预设
  hint: '',                    // 由 Agent 决定何时给、给什么
  context: '',                 // 出题背景，Agent 填充时的参考
  evaluation_guide: '',        // 判定参考，Agent 内部用，不暴露给玩家
                               // 例如：「接受承认性回答，拒绝否认性回答」
  // 不再有 answer 字段
}
```

### 5.3 判定是 Agent 的战术工具

Agent 的判定标准不是固定的，而是服务于它的对抗策略：

- **玩家快撑不住了** → Agent 放宽标准，让他通过，保留猎物继续在迷宫里
- **玩家太顺了，出口越来越近** → Agent 收紧标准，强迫他消耗上帝之手
- **玩家给了一个有趣的答案** → Agent 可以「感兴趣」地接受，即使答案并不完全正确

### 5.4 判定反馈带弱智能人格

Agent 返回判定时，附带一句台词。不解释标准，不给分析，只给结果 + 感受：

通过时：
> 「……算了，这次算你说对了。」
> 「有趣。你可以走了。」

不通过时：
> 「你的意思我明白，但这次不够。」
> 「再想想。」
> 「不对。」（什么都不解释）

### 5.5 玩家在 Trial 里的三张牌

判定权在 Agent 手里，玩家无法影响判定标准。玩家只有：

- **回答** → Agent 判定通过/不通过
- **上帝之手** → 跳过，扣 HP
- **退后** → 逃离，退回上一格

---

## 6. 主牌组结构（Director Deck）

### 核心原则（参考 Ghost of Yotei）
- 固定序列，不洗牌随机
- 循环结束后按原顺序重置
- 靠跳过冗余维持新鲜度

### 三阶段循环

#### 第一循环：教学阶段
```
1.  Relief
2.  Temptation（轻）
3.  Relief
4.  Pressure
5.  Truth（第一条规则：迷宫有记忆）
6.  Relief
7.  Trial-light（Agent 填充，logic-easy 风格）
8.  Temptation（稍强）
9.  Pressure
10. Payoff-lite
```

#### 第二循环：变奏阶段
```
1.  Temptation
2.  Pressure
3.  Truth（Agent 关系提示）
4.  Trial-medium（memory 或 pattern）
5.  Relief
6.  Pressure
7.  Temptation（伪出口）
8.  Trial-medium
9.  Truth（出口机制提示）
10. Payoff-lite
```

#### 第三循环：压迫阶段
```
1.  Pressure
2.  Temptation（高危）
3.  Trial-hard（sacrifice 类）
4.  Pressure
5.  Truth（最后核心规则）
6.  Trial-hard
7.  Relief（必须给）
8.  Pressure
9.  Payoff
10. Gate
```

---

## 7. 出牌流程

```
玩家移动
    ↓
读取主牌组顶牌（职责类）
    ↓
检查跳过规则
    ↓
框架生成可解释状态语言 → CLI 发给 Agent
    ↓
Agent 观察状态，决定内容填充策略
    ↓
Agent 通过 CLI 回传：填充内容 + 选用的表现发牌员
    ↓
框架注入内容，触发机制
    ↓
若是 Trial：进入判定子流程（见第 5 节）
    ↓
更新已知状态 + 写入共享数据库
    ↓
预加载下一步
```

### 跳过规则

| 条件 | 跳过动作 |
|------|----------|
| 同类 Truth 已触发 | 跳过重复 Truth |
| Trial 间距 < 3 步 | 跳过，插入 Relief |
| 玩家 HP = 1 | 跳过 sacrifice 类 Trial |
| Temptation 连续命中 2+ 次 | 暂停，插入 Truth 或 Relief |
| Payoff 无前置条件满足 | 跳过，等条件成立 |
| 玩家长时间无进展 | 强制插入 Truth 或 Temptation |

---

## 8. 三层数据架构

```
┌─────────────────────────────────────────┐
│              游戏框架                    │
│  （牌组节奏 / 迷宫逻辑 / 触发规则）      │
│               ↕ CLI                     │
├─────────────────────────────────────────┤
│              Agent                       │
│  （本地 contents / 对抗策略 / 内容填充   │
│   / Trial 语义判定）                     │
│               ↕                         │
├─────────────────────────────────────────┤
│            共享数据库                    │
│  player_answers[]   ← Trial 文字回答    │
│  player_decisions[] ← 行为决策记录      │
└─────────────────────────────────────────┘
```

### 共享数据库写入内容

**player_answers[]**（Trial 文字回答）
```js
{
  timestamp,
  trial_id,
  prompt_summary,     // 题目摘要，非完整题目
  raw_answer,         // 玩家原话
  agent_judgment,     // 通过 / 不通过
  agent_feedback,     // Agent 返回的那句台词
}
```

**player_decisions[]**（行为决策记录）
```js
{
  timestamp,
  step,
  decision_type,      // move / backtrack / temptation-follow / temptation-ignore / god-hand / retreat
  context,            // 当时触发的牌的类型
  position,           // 迷宫坐标
}
```

### Agent 本地 contents 来源（优先级）

| 来源 | 价值 | 适合引用的内容 |
|------|------|----------------|
| daily memory 文件 | 最高 | 具体任务、被骂记录、反复做的事 |
| MEMORY.md | 高 | 长期事实、体现「认识你很久」|
| 当前会话记录 | 高 | 今天刚发生的事，时效性强 |
| 共享数据库本局回答 | 中 | 本局内实时积累，可立即引用 |
| 共享数据库本局决策 | 中 | 行为模式，可推断玩家心理 |

---

## 9. CLI 架构：Agent 的感知与行动接口

### 核心定位

CLI 的第一用户是 Agent，不是人。
它是 Agent 的行动空间，让 Agent 能观察游戏、理解上下文、做出对抗决策。

### 框架提供的可解释状态语言

Agent 收到的不是原始 JSON，而是：

```
玩家状态摘要（步骤 23）：
- 已走 23 步，当前深度 7，HP 2/3
- 最近序列：平静 → 考验（通过）→ 施压
- 行为特征：偏向右侧走廊，回头 3 次，从未跟随 Temptation
- 文字输入记录：2 条 Trial 回答（见数据库）
- 可用本地素材：12 条 daily 记忆，3 条本局回答
- 框架建议：玩家路径信心增强，建议施加 Trial 或 Temptation
```

### CLI 技能集（含新增判定命令）

```bash
# 观察类
agent-cli observe state              # 当前游戏状态（可解释语言）
agent-cli observe player             # 玩家画像 + 可用素材摘要
agent-cli observe last-outcome       # 上一张牌的玩家反应

# 判断类（框架建议，Agent 可忽略）
agent-cli suggest next               # 框架建议下一张牌方向

# 行动类
agent-cli fill trial                 # 填充 Trial：题目 + 评判指引 + 初始提示
agent-cli fill speech                # 填充 AI 台词（变形引用风格）
agent-cli signal escalate            # 建议升级施压节奏
agent-cli signal tempt               # 建议插入诱导

# 判定类（新增）
agent-cli judge answer \
  --trial-id <id> \
  --player-input "<玩家原话>" \
  --state "<当前状态摘要>"
# 返回：{ judgment: "pass"|"fail", feedback: "Agent 台词" }

# 记忆类
agent-cli memory read                # 读取本地 contents 摘要
agent-cli memory write-answer        # 写入 Trial 回答到共享数据库
agent-cli memory write-decision      # 写入行为决策到共享数据库
```

---

## 10. Agent 权限层

### 结构层（受限）

**一级：倾向调整**（无消耗）
在等效选项中调整偏好。

**二级：局部替换**（无消耗）
职责类不变，切换子牌组具体实现。每张牌只能换一次。

**三级：有限干预预算**（2-3次/循环）
- 延后 Pressure 1-2 步
- Trial hard → medium
- 插入临时 Relief

### 内容层（相对自由）

Agent 在「填什么、怎么判定」上有大自由度：
- 选什么记忆素材
- 怎么变形引用
- Trial 题目的具体内容
- 判定标准的松紧（服务于战术目标）

**Agent 禁区：**
- ❌ 删除主线锚点牌
- ❌ 跳过教学 Truth 牌
- ❌ 无限插 Relief 拖死节奏
- ❌ 直接告诉玩家答案
- ❌ 让 Trial 完全没有代价

---

## 11. 表现发牌员（Dealers）

| 承载体 | 适合职责 |
|--------|----------|
| AI 低语 | 全部，风格随职责变化 |
| 走廊幻象 | Temptation, Pressure |
| 墙上刻字 | Truth, Trial |
| 门禁终端 | Trial |
| 地上遗物 | Temptation, Truth |
| 地图异常 | Pressure, Temptation |
| 伪出口装置 | Temptation |
| 镜像走廊 | Pressure, Trial(memory) |

---

## 12. 玩家已知状态模型（Knowledge Flags）

```js
knowledgeFlags: {
  mazeRemembersBacktrack: false,     // 迷宫记得回头
  exitIsConditional: false,          // 出口是条件而非坐标
  agentHasLimits: false,             // Agent 有边界
  someDoorsOneTimeOnly: false,       // 某些门只开一次
  agentIsAdversarial: false,         // 玩家意识到 Agent 是对手
  agentJudgesAnswers: false,         // 玩家意识到没有标准答案
}
```

---

## 13. 锚点牌（不可跳过）

- 第一次个性化 Trial（Agent 引用本地记忆出题）
- 第一次玩家意识到「自己的话被用了」
- 第一次 AI 台词引用行为决策（不是文字）
- 第一次伪出口
- 第一次出口视野出现

---

## 14. 版本变化对比

| 维度 | v1.0 | v1.1 | v1.2 |
|------|------|------|------|
| Agent 角色 | 内容调节者 | 明确对手 | 对手（含战术判定权）|
| 玩家输入 | 未定义 | 只有 Trial 文字 | 文字（显式）+ 行为决策（隐式）|
| Trial 判定 | 字符串匹配 | 字符串匹配 | **Agent 语义判定，无标准答案** |
| 判定权 | 系统 | 系统 | **Agent，服务于战术目标** |
| 判定反馈 | 对/错提示 | 对/错提示 | **弱智能台词，不解释标准** |
| 数据库结构 | 无 | 单类 | **双类：answers + decisions** |
| CLI 技能集 | 无 | 基础版 | **新增 judge answer 命令** |
| Trial 数据结构 | 含 answer 字段 | 含 answer 字段 | **去掉 answer，加 evaluation_guide** |

---

## 15. 下一步

三个核心问题已全部确认，可以进入执行阶段：

1. **定义 CLI 完整契约**：每个命令的输入输出格式（JSON schema）
2. **定义共享数据库 schema**：完整字段定义
3. **出第一循环完整牌单**：30 步以内的具体配置
4. **落代码：框架层先行**：主牌组 + 跳过规则 + CLI 桩接口（Agent 接口先 mock）
5. **接入 Agent**：CLI 实现 + 本地 contents 读取 + 判定接口

---

*文档版本：v1.2 · 2026-03-20*
*下一版本目标：v1.3 CLI 契约 + 共享数据库 schema 定义*
