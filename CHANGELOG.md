# Changelog

## v1.5.0 (2026-03-26)

### Feature: 增强诱惑系统 (Enhanced Lure System)

#### Backend — 文件扫描 + Vision 分析 + 缓存
- **server/file-scanner.js** (NEW): 启动时扫描本地文件系统（Desktop/Downloads/Documents/Pictures/workspace/WSL Windows 路径）；支持图片 + 文本文件；跳过系统目录、AppData、Teams 日志等噪声路径
- **server/vision-cache.js** (NEW): 用 LLM Vision API 分析图片内容（具体描述 + tags + mood + lureHook）；文本文件用启发式分析；结果缓存至 `lure-cache.json`（mtime 缓存校验）
- **并发 Vision 分析**: `batchAnalyze()` 改为 `Promise.allSettled` 批次处理，最多 5 路并行，启动扫描速度大幅提升
- **server/lure-narrative.js** (NEW): LLM 生成 Agent 心路历程叙事（2-3 句话，混合反派冷嘲 + 前助手私人回忆）；内置 banned phrases 列表防止模板化输出；timeout 8s + fallback mood-based 文案
- **Memory 关联**: `findRelatedMemory()` 从 MEMORY.md + 最近 5 天日记文件关键词匹配，注入叙事上下文

#### Backend — API 端点
- **GET /api/lure/enhanced**: 返回 vision 分析后的 lure 素材列表（最多 50 个，高价值路径优先排序）
- **POST /api/lure/narrative**: 为特定 lure 素材生成 Agent 叙事
- **GET /api/lure/image**: 支持任意已缓存路径的图片服务（安全校验：仅允许缓存内 or 允许目录）
- **POST /api/villain/react**: 增强 lure_follow 上下文（lure_description 字段注入 vision 分析结果）
- **server.js**: 启动时后台触发预扫描（30min 缓存 TTL，仅在 stale 时重扫）

#### Frontend — 全屏 Overlay + 文本查看器
- **js/lure-viewer.js** (ENHANCED): 全屏 lure overlay（含噪点纹理背景、图片发光呼吸动画、打字机叙事效果）；VS Code 深色主题文本查看器（行号 + 基础语法高亮）；结果揭晓（线索/陷阱不同颜色闪光 + varied 文案防重复）；ESC 关闭支持；12s safety net timeout
- **js/core.js**: 启动时 fetch `/api/lure/enhanced`，注入最多 3 张图片 + 3 个文本文件到 lure pool
- **js/mechanics.js**: 两阶段诱惑展示 — 墙壁渗透只显示 lureHook tease；追踪后展示全屏 overlay；提前计算结果，onClose 回调应用游戏状态

#### Styles
- **styles.css**: 新增全屏 overlay / 图片呼吸动画 / shimmer loading / 打字机光标 / 文本查看器 / 结果揭晓闪光 / 墙壁投影 teaser blur / 移动端响应式 (~400 新行)

### Engineering
- **smoke-test.sh**: 扩展至 28 项检查（新增 server/file-scanner、vision-cache、lure-narrative、judge 导入检查 + 7 个前端 JS 文件存在检查）

### Stats
- 5 commits this session
- 1 contributor (Tatsuko 🦞)
- 28/28 smoke checks passing

## v1.4.0 (2026-03-25)

### Bug Fixes
- **Trial mercy clause**: Fixed critical bug where judge cache bypassed mercy for fail_count≥3 — added `mercyCheck()` server-side hard override + cache key bucketing by failCount
- **AI name sanitization**: Fixed "你的AI 和 你的AI" doubling — regex now covers 和/与/&/、/逗号 with whitespace tolerance
- **Trial fact dedup**: Enhanced `factKey()` normalization (80-char window + whitespace stripping) to prevent same-fact reuse with minor wording differences
- **Trial submit debounce**: Added `_submitting` flag guard to prevent Enter+click double submissions
- **Villain fallback rate**: Timeout raised 6s→10s, improving LLM hit rate from 21%→80%

### Refactoring
- **mechanics.js split**: 1956→1330 lines (−32%) — extracted `overlays.js` (69), `trials.js` (181), `endgame.js` (400)
- **Server Logger**: Migrated routes.js + memory.js from console.log to structured Logger with timestamps + color tags
- **Logger utility**: Added `server/utils/logger.js` for consistent server-side logging

### Engineering
- **npm test**: Added `scripts/smoke-test.sh` (17 checks: syntax, imports, secrets, git hygiene)
- **Git hygiene**: Removed `lure-cache.json` from tracking, added to `.gitignore`
- **.env.example**: Documented all environment variable options
- **Collaboration**: Added `docs/dev-pipeline.md` (Shiori×Tatsuko development pipeline spec)
- **Version bump**: 1.1.0→1.4.0 (was severely outdated)
- **Refactor plan**: `plans/mechanics-split-plan.md` blueprint for future work

### Stats
- 15+ commits this session
- 2 contributors (Tatsuko 🦞 + Shiori 🔖)
- All fixes verified via API-level testing

## v1.3.2 (2026-03-24)

### Tone Pass — "冷静恐怖"
- All villain speech follows "calm, restrained, occasionally sincere" principle
- Event text stripped to raw sensation ("裂缝里有光。" not "从某个裂缝中透出一缕光。它似乎来自很远的地方。")
- Fallback lines expanded to 30 (18 base + 12 veteran)
- Few-shot examples shortened to match 15-char guideline
- Judge feedback labels calmed ("平静但坚定" not "嘲讽")

### Cross-Session Memory
- Truth discoveries tracked across sessions
- Villain knows which truths you've already discovered
- Veteran winners (3+ wins) face harder trials
- Behavior tags and play patterns persist via localStorage

### Gameplay
- Idle whisper: villain reacts after 15s of inactivity
- Backtrack streak: 3 consecutive retreats → villain observes
- Ambient log entries at key step milestones
- Number keys 1-4 for event overlay choices
- Depth 20 milestone reaction

### Performance
- LLM timeout degradation: 8s card / 6s villain / 10s trial+judge
- Automatic fallback on timeout — gameplay never blocks

### Polish
- Emoji favicon (👁️)
- Meta description + theme-color
- ARIA attributes for screen readers
- Dead CSS cleanup (glitchJitter/glitchFlicker removed)
- Agent name sanitization in trial prompts
- Version tag updated in UI

## v1.2.0 – v1.3.1

See git log for detailed changes. Key features added:
- Personal best badge
- Session counter in header
- Villain epilogue (victory/death/maze-lost)
- Eye emotion system + thinking animation
- Wall projection lure system
- Cross-session GameHistory via localStorage
- Truth discovery tags
- Session ID watermark
- Personalized intro (5 variants)
- Villain profile system
- Threat pulse / Relief pulse effects
- Dynamic difficulty adjustment

## v1.0.0 – v1.1.0

Initial release with:
- 15×23 DFS maze generation
- 4-card type system (blocker/lure/drain/calm)
- 4-cycle difficulty progression
- AI villain via Claude LLM
- Demo mode with browser-side API key
- SVG corridor rendering with perspective
- Minimap with fog of war
- Trial/minigame system
- God Hand mechanic
- Mobile swipe support
