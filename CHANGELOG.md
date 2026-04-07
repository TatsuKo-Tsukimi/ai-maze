# Changelog

## v1.5.1 (2026-04-07)

### Security
- **CORS**: Replaced wildcard `Access-Control-Allow-Origin: *` with localhost-only origin check
- **Network**: Default bind changed from `0.0.0.0` to `127.0.0.1` (Docker unaffected — keeps `0.0.0.0` via Dockerfile)
- **Command injection**: All `execSync` calls with file paths replaced by `execFileSync` (no shell), preventing injection via crafted filenames (8 call sites in archivist.js + file-scanner.js)
- **File access**: `/api/lure/image` allowlist narrowed from entire homedir to explicit scan directories; removed cache bypass for path check; added file extension whitelist

### Fixes
- **OpenClaw URL**: Corrected link from `anthropics/openclaw` to `openclaw/openclaw`
- **Version**: Unified version display across index.html, package.json, and CHANGELOG

## v1.5.0 (2026-03-26)

### Enhanced Lure System

#### File Scanning + Vision Analysis
- **server/file-scanner.js**: Scans local filesystem (Desktop/Downloads/Documents/Pictures/workspace/WSL Windows paths); supports images + text files; skips system directories, AppData, Teams logs, and other noise
- **server/vision-cache.js**: LLM Vision API analyzes image content (description + tags + mood + lureHook); heuristic analysis for text files; results cached to `lure-cache.json` with mtime validation
- **Concurrent analysis**: `batchAnalyze()` uses `Promise.allSettled` with up to 5 parallel workers
- **server/lure-narrative.js**: LLM generates villain narrative (2-3 sentences mixing cold taunts + private memories); banned phrases list prevents template output; 8s timeout + fallback

#### API
- **GET /api/lure/enhanced**: Returns analyzed lure materials (up to 50, prioritized by value)
- **POST /api/lure/narrative**: Generates villain narrative for a specific lure material
- **GET /api/lure/image**: Serves images from scanned paths (allowlisted directories only)
- **POST /api/villain/react**: Enhanced lure_follow context with vision analysis results

#### Frontend
- **Fullscreen lure overlay**: Noise texture background, breathing glow animation, typewriter narrative effect
- **Text viewer**: VS Code dark theme with line numbers + basic syntax highlighting
- **Result reveal**: Clue/trap differentiated by color flash + varied text to prevent repetition
- **Two-phase temptation**: Wall seepage shows lureHook tease; tracking triggers fullscreen overlay

#### Engineering
- **smoke-test.sh**: Expanded to 28 checks (file-scanner, vision-cache, lure-narrative, judge imports + 7 frontend JS existence checks)

## v1.4.0 (2026-03-25)

### Bug Fixes
- **Trial mercy clause**: Fixed judge cache bypassing mercy for fail_count >= 3 — added `mercyCheck()` server-side hard override + cache key bucketing by failCount
- **AI name sanitization**: Fixed doubling ("your AI and your AI") — regex now covers all conjunction patterns with whitespace tolerance
- **Trial fact dedup**: Enhanced `factKey()` normalization (80-char window + whitespace stripping) to prevent same-fact reuse
- **Trial submit debounce**: Added `_submitting` flag to prevent Enter+click double submissions
- **Villain fallback rate**: Timeout raised 6s -> 10s, improving LLM hit rate from 21% to 80%

### Refactoring
- **mechanics.js split**: 1956 -> 1330 lines (-32%) — extracted `overlays.js`, `trials.js`, `endgame.js`
- **Server logger**: Migrated from console.log to structured Logger with timestamps + color tags
- **.env.example**: Documented all environment variable options

### Engineering
- **npm test**: Added `scripts/smoke-test.sh` (17 checks: syntax, imports, secrets, git hygiene)
- **Git hygiene**: Removed `lure-cache.json` from tracking

## v1.3.2 (2026-03-24)

### Tone Pass — Calm Horror
- All villain speech follows "calm, restrained, occasionally sincere" principle
- Event text stripped to raw sensation
- Fallback lines expanded to 30 (18 base + 12 veteran)
- Few-shot examples shortened to match 15-char guideline
- Judge feedback labels calmed

### Cross-Session Memory
- Truth discoveries tracked across sessions
- Villain knows which truths you've already discovered
- Veteran winners (3+ wins) face harder trials
- Behavior tags and play patterns persist via localStorage

### Gameplay
- Idle whisper: villain reacts after 15s of inactivity
- Backtrack streak: 3 consecutive retreats trigger villain observation
- Ambient log entries at key step milestones
- Number keys 1-4 for event overlay choices

### Performance
- LLM timeout degradation: 8s card / 6s villain / 10s trial+judge
- Automatic fallback on timeout — gameplay never blocks

## v1.2.0 — v1.3.1

### Highlights
- Personal best badge + session counter
- Villain epilogue (victory/death/maze-lost variants)
- Eye emotion system + thinking animation
- Wall projection lure system
- Cross-session GameHistory via localStorage
- Truth discovery tags + session ID watermark
- Personalized intro (5 variants)
- Villain profile system
- Threat pulse / Relief pulse effects
- Dynamic difficulty adjustment

## v1.0.0 — v1.1.0

Initial release:
- 15x23 DFS maze generation
- 4-card system (blocker/lure/drain/calm)
- 4-cycle difficulty progression
- AI villain via Claude LLM
- SVG corridor rendering with perspective
- Minimap with fog of war
- Trial/minigame system + God Hand mechanic
- Mobile swipe support
