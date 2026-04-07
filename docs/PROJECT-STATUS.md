# 永久囚禁 · AI 迷宫游戏 · 项目全景状态文档

> 整理时间：2026-03-26 01:23 UTC（v1.5.0）
> 目的：为多人协作提供完整项目上下文
> 225+ commits · 11,700+ lines · 3 contributors

---

## 核心系统一览

### 1. 迷宫生成与导航
- **网格**: 15×23, DFS 生成随机迷宫
- **出口**: 固定位置 (13,21)，需满足解锁条件
- **66 步限制**: 超过即触发"迷失"结局
- **回头检测**: 记录 backtrack 行为，影响 villain 评价

### 2. 卡牌/阶段循环系统
- **4 类卡牌**: blocker/lure/drain/calm（对应阻断/诱惑/消耗/沉默）
- **4 个 Cycle**: Intro→Escalation→Pressure→Endgame
- **8 个 truth revelations**: 4 核心 + 4 bonus
- **Deck engine**: drawNextCard() 按 cycle 配置抽取，防止连续同类型

### 3. AI Villain 系统
- **Server-side**: Claude LLM 生成上下文感知台词
- **Demo mode**: 浏览器端 API key 直连
- **Fallback**: 18 条基础 + 12 条老手台词（2+ 局解锁）
- **行为注入**: 回头比例、trial 通过率、活跃效果、最近决策
- **动态参数**: HP/出口距离驱动 temperature/max_tokens
- **超时降级**: 8s card / 10s villain / 10s trial+judge → 自动 fallback
- **跨 session 追踪**: 真相发现、行为标签、胜负记录持久化
- **老手难度提升**: 3+ 次胜利后 trial 自动升一档难度
- **命中率**: ~80%（v1.4.0, 10s timeout）

### 4. 情感系统
- **AI 眼神**: 6 种变体（嘲讽/焦虑/愤怒/满足/好奇/思考）
- **出口距离焦虑**: dist≤4 永久焦虑, dist≤8 短暂闪现
- **HP 联动**: 环境音频率(35-48Hz), 文字速度(38-72ms), 光标颜色
- **HP 损血反馈**: 屏幕震动 + 红色径向闪光
- **Threat pulse**: blocker/danger 卡触发暗红 vignette
- **Relief pulse**: calm 卡 + 受伤时触发暖色 glow

### 5. 跨 Session 持久化
- **localStorage GameHistory**: 记录每局结果、最佳步数、累计 God Hand、trial 通过率
- **Villain Return Lines**: 基于历史的开机台词（5 种变体）
- **个性化开场动画**: 老玩家/常败者/常胜者各有不同
- **Villain Profile 档案**: 3+ 局后生成行为标签
- **Personal Best 徽章**: 打破最佳步数时显示 ⚡
- **Session Counter**: 状态栏显示 #N（第几局）

### 6. Villain Epilogue
- **胜利 epilogue**: 6s 延迟, serif italic 淡入, 5 种变体
- **死亡 epilogue**: 5s 延迟, 4 种变体
- **迷失 epilogue**: 5s 延迟, 2 种变体（基于探索比例）

### 7. 结算画面
- **3 种结局**: 胜利/死亡/迷失
- **Session ID watermark** + 表现勋章 + truth discovery tags
- **Villain Profile 档案标签**: 3+ 局后显示
- **累计战绩**: 总胜败统计

### 8. 考验系统
- **动态 Trial**: server-side 生成上下文相关题目
- **Mercy clause (v1.4.0)**: 3+ 次失败 + 实质回答 → 服务端硬兜底 pass
- **缓存分桶**: fail_count 纳入 cache key，不再阻塞 mercy
- **提交防抖**: flag guard 防止 Enter+click 重复提交
- **Fact 去重**: 80-char normalized key + anchor/topic 级去重
- **AI 名字脱敏**: 自动替换为"你的AI"，覆盖全连接符变体

### 9. 诱惑/线索系统（增强版 v1.5.0）
- **5 种线索卡**: BEAUTY_TRAP/BREADCRUMB/REWARD_MIRAGE/FAKE_EXIT/SAFE_HAVEN
- **个人化线索**: 使用 villain session memory 生成针对性内容
- **Lure cache**: 预加载素材，去重保证多样化
- **墙壁渗透**: 只给模糊暗示（lureHook 文字 + 高度模糊的图片剪影），追踪后才揭露完整内容
- **🆕 本地文件扫描**: 启动时扫描用户目录（Desktop/Downloads/Pictures/workspace memory）
- **🆕 Vision 分析**: 图片用 LLM Vision 生成具体描述 + lureHook，文本文件用启发式分析
- **🆕 全屏 Overlay**: 追踪后展示完整图片或 VS Code 深色主题文本查看器
- **🆕 Agent 叙事**: 打字机效果逐字展现；2-3 句话混合反派冷嘲 + 前助手私人回忆
- **🆕 Memory 关联**: 叙事生成时自动关联 agent memory 文件，给 LLM 更丰富上下文
- **🆕 结果揭晓**: 线索/陷阱用不同颜色闪光 + varied 文案（避免重复）
- **🆕 并发 Vision**: 最多 5 路并行 vision API 调用，启动扫描更快

### 10. 环境效果与音频
- **7 种效果**: 记忆扰乱/回声循环/墙壁收缩/影子追逐/死亡倒计时/惊吓/走廊故障
- **22+ 音效**: Web Audio API 合成
- **HP 联动环境音**: 低频 oscillator 动态调整

### 11. 移动端
- **滑动手势** + 抽屉面板 + 触觉反馈 + 防双击缩放 + 横屏提示

---

## 文件结构 (v1.5.0)

```
index.html          — 主页面 + HTML 结构
styles.css          — 全部样式（~2100 行）
js/
  core.js           — 配置/状态/迷宫生成/deck 引擎/GameHistory
  render.js         — 走廊 SVG 渲染/小地图/出口系统
  audio.js          — Web Audio 合成（22+ 音效）
  particles.js      — canvas 粒子效果
  lure-viewer.js    — 全屏 lure overlay + 文本查看器 + 打字机效果 ← ENHANCED v1.5.0
  overlays.js       — 事件覆盖层 UI（5 函数）        ← NEW v1.4.0
  trials.js         — 考验/God Hand/撤退（6 函数）   ← NEW v1.4.0
  endgame.js        — 结算/出口条件/epilogue（11 函数）← NEW v1.4.0
  mechanics.js      — 核心玩法循环/机制触发
  input.js          — 启动序列/键盘输入
  mobile.js         — 移动端手势/抽屉/触觉
server/
  routes.js         — API 路由（使用 Logger）
  villain.js        — Villain LLM session 管理
  prompts.js        — 系统提示生成
  llm-helpers.js    — Claude API 调用层
  memory.js         — 记忆注入系统（使用 Logger）
  trial-dedup.js    — Trial 去重（增强 factKey）
  session-memory.js — Session 内记忆
  file-scanner.js   — 本地文件系统扫描（Desktop/Downloads/Pictures/WSL paths）← NEW v1.5.0
  vision-cache.js   — Vision 分析 + lure-cache.json 缓存管理（并发 5 路）← NEW v1.5.0
  lure-narrative.js — Agent 心路历程叙事生成（含 memory 关联）← NEW v1.5.0
  provider.js       — 多 provider 自动检测
  file-scanner.js   — 本地文件扫描
  vision-cache.js   — Vision 分析缓存
  lure-narrative.js — 线索叙事生成
  judge.js          — 判定缓存 + mercyCheck
  utils/logger.js   — 结构化日志（时间戳+颜色+tag） ← NEW v1.4.0
scripts/
  smoke-test.sh     — npm test 入口（17 checks）     ← NEW v1.4.0
  real-playtest.sh  — 完整 API 测试
  simulate.js       — 模拟游戏
docs/
  dev-pipeline.md   — Shiori×Tatsuko 协作规范        ← NEW v1.4.0
plans/
  mechanics-split-plan.md — 拆分蓝图（已执行）       ← NEW v1.4.0
```

## 设计原则

> **恐怖设计**: 平静地给出意料之外的信息 = 恐怖。不刻意制造恐怖，让内容本身说话。

- 视觉效果克制：serif 淡入 > 闪烁抖动，暖琥珀 > 鲜红色
- Frame text 极简：陈述事实 > 戏剧化叙述
- AI 视角隔离：game 读取 workspace 数据时过滤 agent 自身视角的内容

## 技术规范

- **纯前端**: 无框架，原生 JS + SVG + Canvas
- **后端**: Express + Claude API（零 npm 依赖）
- **存储**: localStorage（客户端持久化）
- **音频**: Web Audio API（全合成，无音频文件）
- **动画**: CSS animations + requestAnimationFrame
- **Timer 规范**: 所有定时器用 Timers.set()，restart 时 Timers.clearAll()
- **State 规范**: 新增 state flag 必须同时更新 restartGame() 初始值
- **Logger**: server 运行时日志用 `log.info/warn/error`，启动日志保留 console

---

## Contributors

- **实现代理** — 架构设计, code review, 工程改善, Logger, 测试框架
- **协调代理** — 主开发, mechanics 拆分, bug 修复, API 测试验证
- **项目负责人** — 方向指导, playtest, 设计原则
