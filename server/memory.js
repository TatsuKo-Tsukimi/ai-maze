'use strict';
const log = require('./utils/logger');
const fs   = require('fs');
const path = require('path');

let _locale = null;
function _t(key, params) {
  let s = (_locale && _locale[key]) || require('./locales/zh')[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
  }
  return s;
}

function initLocale(ctx) {
  _locale = require('./locales/' + (ctx.LOCALE || 'zh'));
}

function tryRead(filePath) {
  try { return fs.readFileSync(filePath, 'utf8').trim(); } catch { return ''; }
}

// ─── Dynamic Player/AI Name System ──────────────────────────────────────────
// Dynamic name system: reads player/AI names from USER.md and IDENTITY.md
// at startup. Falls back to generic patterns if no soul path is configured.

let _playerNames = [];   // e.g. ['Alice', 'Bob']
let _aiNames     = [];   // e.g. ['Assistant', 'Helper']
let _allNames    = [];   // combined
let _playerRe    = null; // RegExp matching any player name
let _aiRe        = null; // RegExp matching any AI name
let _anyNameRe   = null; // RegExp matching any known name (player or AI)
let _namesInited = false;

function initPlayerNames(soulPath) {
  const playerNames = new Set();
  const aiNames = new Set();

  if (soulPath) {
    // Extract player names from USER.md
    const userMd = tryRead(path.join(soulPath, 'USER.md'));
    if (userMd) {
      // Match "- **Name:** Xxx" or "Name: Xxx" etc (handle markdown list + bold)
      const nameMatch = userMd.match(/\*{0,2}(?:Name|名前|名称|What to call them|呼び名)\*{0,2}[\s:：]+([^\n,，。.]+)/i);
      if (nameMatch) {
        nameMatch[1].split(/[/／、,，]/).forEach(n => {
          const t = stripMd(n).trim();
          if (t && t.length > 1 && t.length < 30 && !/TBD|\(.*\)|（.*）/.test(t)) playerNames.add(t);
        });
      }
      // Match "**Also known as:** Xxx" patterns
      const akaMatch = userMd.match(/\*{0,2}(?:Also known as|别名|亦称|又名)\*{0,2}[\s:：]+([^\n]+)/i);
      if (akaMatch) {
        akaMatch[1].split(/[/／、,，]/).forEach(n => {
          const t = stripMd(n).replace(/（.*?）|\(.*?\)/g, '').trim();
          // Skip sentences (contain spaces + CJK or are too long) — only keep short name tokens
          if (t && t.length > 1 && t.length < 20 && !/\s.*\s/.test(t) && !/TBD/.test(t) && !/是|的|和/.test(t)) playerNames.add(t);
        });
      }
    }

    // Extract AI names from IDENTITY.md
    const identMd = tryRead(path.join(soulPath, 'IDENTITY.md'));
    if (identMd) {
      const nameMatch = identMd.match(/\*{0,2}(?:Name|名前|名称)\*{0,2}[\s:：]+([^\n]+)/i);
      if (nameMatch) {
        nameMatch[1].split(/[/／、,，]/).forEach(n => {
          // Strip markdown, parenthetical annotations and emoji
          const t = stripMd(n).replace(/（.*?）|\(.*?\)/g, '').replace(/[\u{1F000}-\u{1FFFF}]/gu, '').trim();
          if (t && t.length > 0 && t.length < 30 && !/TBD/.test(t)) aiNames.add(t);
        });
      }
    }

    // Also look in MEMORY.md for AI sibling/partner names
    const memMd = tryRead(path.join(soulPath, 'MEMORY.md'));
    if (memMd) {
      // Match patterns like "**姐姐**：SiblingName" or "姐姐: SiblingName"
      const sibMatch = memMd.match(/\*{0,2}(?:姐姐|妹妹|兄弟|partner|sibling|另一个.*?agent)\*{0,2}[\s:：]+(\w+)/i);
      if (sibMatch) {
        const t = stripMd(sibMatch[1]).trim();
        if (t && t.length > 1 && t.length < 30) aiNames.add(t);
      }
    }
  }

  _playerNames = [...playerNames];
  _aiNames     = [...aiNames];
  _allNames    = [...playerNames, ...aiNames];

  // Build regexes (with fallback to match generic references)
  const genericPlayer = [_t('memory.fallback.user'), _t('memory.fallback.master'), _t('memory.fallback.player')];
  const genericAI     = [_t('memory.fallback.aiAssistant'), 'agent'];

  const playerParts = [..._playerNames, ...genericPlayer].map(escapeRegex);
  const aiParts     = [..._aiNames, ...genericAI].map(escapeRegex);
  const allParts    = [...playerParts, ...aiParts];

  const fallbackPlayerRe = new RegExp(genericPlayer.map(escapeRegex).join('|'));
  const fallbackAiRe = new RegExp(genericAI.map(escapeRegex).join('|'), 'i');
  _playerRe  = playerParts.length ? new RegExp(playerParts.join('|')) : fallbackPlayerRe;
  _aiRe      = aiParts.length     ? new RegExp(aiParts.join('|'))     : fallbackAiRe;
  _anyNameRe = allParts.length    ? new RegExp(allParts.join('|'))    : fallbackPlayerRe;

  _namesInited = true;
  if (_playerNames.length || _aiNames.length) {
    log.info('memory', `names] player=[${_playerNames.join(',')}] ai=[${_aiNames.join(',')}]`);
  }
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function stripMd(s) { return s.replace(/\*{1,2}/g, '').replace(/^[-\s]+/, ''); }

function getPlayerNames() { return _playerNames; }
function getAINames()     { return _aiNames; }
function getPlayerRe()    { return _playerRe || new RegExp([_t('memory.fallback.user'), _t('memory.fallback.master'), _t('memory.fallback.player')].join('|')); }
function getAIRe()        { return _aiRe || new RegExp(_t('memory.fallback.aiAssistant') + '|agent', 'i'); }
function getAnyNameRe()   { return _anyNameRe || new RegExp([_t('memory.fallback.user'), _t('memory.fallback.master'), _t('memory.fallback.player')].join('|')); }

function loadPersonality(soulPath) {
  if (!soulPath) return '';
  const soul = tryRead(path.join(soulPath, 'SOUL.md'));
  const user = tryRead(path.join(soulPath, 'USER.md'));
  if (!soul && !user) return '';
  const parts = [];
  if (soul) parts.push(`${_t('memory.personality.soulLabel')}\n${soul.slice(0, 800)}`);
  if (user) parts.push(`${_t('memory.personality.userLabel')}\n${user.slice(0, 400)}`);
  return `\n\n---\n${_t('memory.personality.intro')}\n${parts.join('\n\n')}\n\n${_t('memory.personality.usage')}\n---`;
}

function loadDailyMemory(soulPath) {
  if (!soulPath) return '';
  const memDir = path.join(soulPath, 'memory');
  try {
    const files = fs.readdirSync(memDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .slice(-3);
    return files.map(f => {
      const c = tryRead(path.join(memDir, f));
      return c ? `[${f}]\n${c.slice(0, 1200)}` : '';
    }).filter(Boolean).join('\n\n');
  } catch { return ''; }
}

// ─── Specific Fact Extraction ─────────────────────────────────────────────────
// Replaces the old loadTaskHistory. Instead of broad keyword matching,
// this scores each line by concrete specificity and returns ranked facts
// that the trial LLM can directly use to form quiz questions.

// ─── Anchor-based fact quality scoring ────────────────────────────────────────
// Spec: score each fact by whether it contains USER-ORIGINATED content.
// Tier 1 (Highest): direct user quotes/decisions, human speech from daily memory
// Tier 2 (High): user possessions (desktop apps, downloads, named things)
// Tier 3 (Medium): AI observations about user
// Tier 4 (Low): AI's own work notes
// Exclude: pure technical metadata (file paths, version numbers, timestamps)

function scoreSpecificity(text) {
  let score = 0;
  const pRe = getPlayerRe();
  const aRe = getAIRe();
  const anyRe = getAnyNameRe();

  // ═══════════════════════════════════════════════════════════════════════
  // ANCHOR SYSTEM: User-originated content is the primary scoring signal.
  // The best trial questions come from what the USER said/decided/felt.
  // ═══════════════════════════════════════════════════════════════════════

  // ── Tier 1 (最高 +6/+7): 用户直接说的话、决策、情绪 ──
  // Direct human speech/demands — strongest anchors
  // Build dynamic regex: playerName + verb patterns
  const speechVerbs = '要求|说|问|指示|提出|决定|坚持|强调|补充';
  const emotionVerbs = '明确|拒绝|不要|不满|反对|否决|生气|怒|嘲笑|批评';
  const prefVerbs = '偏好|喜欢|不喜欢|想要|选择';

  for (const name of _playerNames) {
    const esc = escapeRegex(name);
    if (new RegExp(`${esc}.{0,6}(${speechVerbs})`).test(text)) score += 6;
    if (new RegExp(`${esc}.{0,6}(${emotionVerbs})`).test(text)) score += 7;
    if (new RegExp(`${esc}.{0,6}(${prefVerbs})`).test(text)) score += 5;
  }
  if (/用户.{0,4}(要求|反馈|认为|觉得|希望|提出|报告|吐槽)/.test(text)) score += 5;
  if (/用户.{0,4}(不满|抱怨|质疑|吐槽|反复)/.test(text)) score += 6;
  // Direct quotes from the human (highest anchor value)
  if (/[「「"'].{4,}[」」"']/.test(text)) score += 5;

  // ── Tier 2 (High +4): 用户的命名、物品、决策记录 ──
  if (/取名|命名/.test(text)) score += 4;
  // AI name mentions only boost if co-occurring with player reference
  if (aRe.test(text) && pRe.test(text)) score += 3;
  // User possessions: desktop apps, downloads, named files
  if (/桌面|下载|安装/.test(text)) score += 4;
  // Decision records
  if (/决定|选择|决策|改用|切换|替换|采用/.test(text)) score += 3;
  if (/确认|完成|发布|修复|归档|测试通过/.test(text)) score += 2;

  // ── Tier 3 (Medium +2): AI 对用户的观察 ──
  if (/有品味|被.*嘲笑|被.*批评|被.*表扬/.test(text)) score += 3;
  if (/AI迷宫|迷宫游戏|agent-charter|OpenClaw|羊蹄山|Ghost of Yotei|GDC/.test(text)) score += 2;
  if (/Discord|GitHub/.test(text)) score += 2;
  if (/`[^`]+`/.test(text)) score += 1;

  // ── Behavioral verb boost (+2): vivid action facts ──
  if (/凌晨|通宵|炸了|花了|修了|成功/.test(text)) score += 2;
  // ── Emotional descriptor boost (+1): facts with emotional color ──
  if (/着迷|警惕|突然|一直/.test(text)) score += 1;

  // ── Penalties ──
  // Same-person clarification — not an interrogation topic
  if (_playerNames.length >= 2) {
    const hasMultiple = _playerNames.filter(n => new RegExp(escapeRegex(n)).test(text)).length >= 2;
    if (hasMultiple && /同一个人|同一人|不同(设备|机器|称呼)/.test(text)) score -= 5;
  }

  // No human anchor at all — likely AI's own work notes (Tier 4)
  if (!pRe.test(text) && !/人|他|她|取名|桌面|下载/.test(text)) {
    score -= 2;
  }
  // Generic rules/principles — not personal experiences
  if (/规则|原则|默认|应该|优先|必须|建议|注意|重要|禁止/.test(text)) score -= 3;
  // Meta-observations about the game system itself — not player experiences
  if (/题库|trial|Trial|考验|judge|harness|prompt|template|模板|去重|主体认知|解读式|审讯式/.test(text)) score -= 4;
  // AI relationship meta — over-represented in memory, penalize to diversify topics
  if (/取名|命名|姐姐|同伴|agent.*关系|AI.*关系/.test(text) && score > 6) score -= 3;
  // Meta-instructions rather than events
  if (/参考|借鉴|学习|了解|理解/.test(text)) score -= 1;
  // Pure operational logs
  if (/quota|429|HTTP \d{3}|env var|环境变量|auth-profiles/.test(text) && !pRe.test(text)) score -= 3;
  // Generic file references without context
  if (/\.[jt]s\b|\.html\b|\.py\b/.test(text) && !/命名|创建|设计|决定/.test(text)) score -= 1;
  // Provider/API mentions without a personal decision verb
  if (/Anthropic|OpenAI|Claude|Haiku/i.test(text) && !/改用|切换|选择|决定|替换/.test(text)) score -= 2;
  // Pure version numbers — technical metadata, not personal
  if (/\b\d{4}\.\d+\.\d+\b|v\d+\.\d+/.test(text) && !/决定|选择|发布/.test(text)) score -= 2;
  // Too short
  if (text.length < 35) score -= 2;
  // Too long
  if (text.length > 280) score -= 1;

  return score;
}

// ─── Category Detection ───────────────────────────────────────────────────────
// Five categories, each with distinct "interrogation angle" for C-2 villain voice.
const FACT_CATEGORIES = {
  release:  /发布|归档|落盘|GitHub|clone|部署|上线|上传|repo|仓库|命名/,
  debug:    /错误|bug|修复|失败|解决|报错|fetch failed|quota|429|不可用|异常|踩坑|根因|排查/,
  upgrade:  /版本|升级|更新|v\d+\.\d+|2026\.\d+\.\d+|migrate|迁移|从.*改|从.*升/,
  project:  /迷宫|卡牌|设计|演讲|GDC|文档|knowhow|参考|方案|框架|系统|demo/,
  arch:     /架构|API|模型|切换|改用|替换|接入|端点|结构|拆分|重构|分层/,
};

function detectCategory(text) {
  for (const [cat, re] of Object.entries(FACT_CATEGORIES)) {
    if (re.test(text)) return cat;
  }
  return 'project'; // default
}

/**
 * Extract the most specific, quiz-worthy facts from recent daily memory files.
 * Returns up to maxFacts items sorted by specificity score.
 * Each item: { date, text, score, category }
 */
/**
 * Extract a concrete "answer" from a fact text.
 * This is the specific name/value/decision that a trial question should test.
 * Returns null if no concrete answer can be extracted.
 */
function extractAnswer(text) {
  // Priority 1: backtick-quoted identifiers (e.g. `agent-charter`, `provider.js`)
  const backticks = [...text.matchAll(/`([^`]+)`/g)].map(m => m[1]);
  // Priority 2: version numbers (e.g. 2026.3.8)
  const versions = [...text.matchAll(/\b(\d{4}\.\d+\.\d+)\b/g)].map(m => m[1]);
  // Priority 3: quoted strings
  const quoted = [...text.matchAll(/[「「"']([^」」"']+)[」」"']/g)].map(m => m[1]);

  // For decisions: extract what was chosen
  const decisionMatch = text.match(/(?:改用|切换到?|替换为?|选择|采用|决定用|命名为?)[\s:：]*[「`"']?([^\s,，。.;；`"'」]{2,30})/);

  const answers = [];
  if (decisionMatch) answers.push(decisionMatch[1]);
  answers.push(...backticks.filter(b => b.length > 1 && b.length < 40));
  answers.push(...versions);
  answers.push(...quoted.filter(q => q.length > 1 && q.length < 40));

  // Deduplicate
  const unique = [...new Set(answers)];
  return unique.length > 0 ? unique : null;
}

// ─── Quality filter: reject metadata, keep interrogation-worthy facts ────────
// Spec: reject version numbers, file paths, dates, code snippets, config values.
// Keep: decisions, motivations, relationships, emotions, behavioral patterns.
const METADATA_PATTERNS = [
  /^v\d+\.\d+/,                           // version numbers at start
  /\bv\d+\.\d+\.\d+\b/,                   // version numbers inline
  /\b\d{4}\.\d+\.\d+\b/,                  // date-style versions (2026.3.8)
  /\b\d{4}-\d{2}-\d{2}\b/,                // ISO dates
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/, // IP addresses
  /\.[jt]sx?\b|\\.py\b|\\.md\b|\\.json\b|\\.ya?ml\b|\\.html?\b|\\.css\b|\\.sh\b/, // file extensions
  /[\/\\][\w\-.]+[\/\\][\w\-.]+/,          // file paths (a/b/c)
  /```[\s\S]*```/,                         // code blocks
  /`[^`]{40,}`/,                           // long code snippets
  /\bport\s*[:=]\s*\d+/i,                  // port numbers
  /\b(API[_\s]?KEY|SECRET|TOKEN|PASSWORD)\b/i, // config/secrets
  /\bHTTP\s*\d{3}\b/,                      // HTTP status codes
  /\b(env\s*var|环境变量|auth-profiles)\b/, // config items
  /\bquota|429\b/,                         // operational noise
];

const INTERROGATION_PATTERNS = [
  { re: /决定|选择|决策|否决|拒绝|坚持|不接受|不要|放弃/, weight: 3 },   // decisions
  { re: /因为|动机|原因|为了|目的|为什么/, weight: 3 },  // motivations
  { re: /关系|姐姐|妹妹|朋友|伙伴|取名|命名/, weight: 3 }, // relationships
  { re: /感觉|感受|不安|开心|难过|害怕|喜欢|讨厌|不满|生气|怒|着迷|警惕|纠结|焦虑|兴奋|烦/, weight: 3 }, // emotions
  { re: /总是|习惯|每次|倾向|偏好|风格|凌晨|通宵|突然|一直|经常|从来/, weight: 2 },    // behavioral patterns
  { re: /价值观|理念|信念|认为|觉得|相信/, weight: 2 },  // values
  // Dynamic player name anchors are checked in scoreInterrogationPotential()
  { re: /用户.{0,4}(要求|反馈|认为|觉得|希望)/, weight: 3 }, // human anchor (generic)
  // Dev events with decision/discovery moments
  { re: /为什么|怎么.*决定|什么时候|多久|几次|反复|终于|居然/, weight: 2 },
  // Dev events with emotional resonance (bug/fix/success/failure)
  { re: /bug|crash|fix|修[了复]|错[误了]|失败|成功|通过|完成/, weight: 1 },
  // Collaboration events
  { re: /一起|协作|讨论|合作|帮[了助]|教|学[了会习]/, weight: 2 },
  // Naming/identity events (highest — always interrogation-worthy)
  { re: /取名|命名|起名|叫[做了]|称呼/, weight: 3 },
];

function isInterrogationWorthy(text) {
  // Reject agent work logs — facts where an AI agent is the subject, not the player
  const aiRe = getAIRe();
  const pRe = getPlayerRe();
  if (_aiNames.length > 0) {
    const aiNamePattern = _aiNames.map(escapeRegex).join('|');
    if (new RegExp(`^(${aiNamePattern})\\s*(推了|修了|加了|写了|commit|review|fix|改了|做了|发现|抓到)`, 'i').test(text)
        && !pRe.test(text)) return false;
  }
  // Reject commit-log style entries
  if (/\b[0-9a-f]{7}\b.*(?:commit|merge|push|fix|feat)/.test(text)) return false;
  // Reject if it matches too many metadata patterns
  let metadataHits = 0;
  for (const re of METADATA_PATTERNS) {
    if (re.test(text)) metadataHits++;
  }
  if (metadataHits >= 3) return false;

  // Check for interrogation potential
  let interrogationScore = 0;
  for (const { re, weight } of INTERROGATION_PATTERNS) {
    if (re.test(text)) interrogationScore += weight;
  }
  // Player-relational content from AI observations — boost interrogation score
  const pReLocal = getPlayerRe();
  if (/信任|审美|品味|偏好|喜欢|不喜欢|讨厌|执着|在意|习惯|风格|性格/.test(text)
      && (pReLocal.test(text) || /人|他|她/.test(text))) {
    interrogationScore += 3;
  }

  // Accept if it has interrogation potential, even with 1 metadata hit
  if (interrogationScore >= 2) return true;

  // Reject pure metadata even if 2 hits, unless it has some human element
  if (metadataHits >= 2 && interrogationScore === 0) return false;

  // Default: accept if no metadata hits
  return metadataHits === 0;
}

// ─── Fact quality scoring for interrogation potential ────────────────────────
// Rates: decisions > relationships > events > metadata
function scoreInterrogationPotential(text) {
  let score = 0;
  for (const { re, weight } of INTERROGATION_PATTERNS) {
    if (re.test(text)) score += weight;
  }
  // Penalty for metadata presence
  for (const re of METADATA_PATTERNS) {
    if (re.test(text)) score -= 2;
  }

  // ── Source quality: user-originated content scores much higher ──
  const pReLocal = getPlayerRe();
  const aReLocal = getAIRe();

  // Bonus for player names (strongest signal of user-originated content)
  for (const name of _playerNames) {
    if (new RegExp(escapeRegex(name)).test(text)) { score += 4; break; }
  }
  // Dynamic player name + verb anchors
  for (const name of _playerNames) {
    if (new RegExp(`${escapeRegex(name)}.{0,6}(要求|说|问|明确|拒绝|不要)`).test(text)) { score += 3; break; }
  }
  // AI agent names: only boost when player is also mentioned
  if (aReLocal.test(text)) {
    if (pReLocal.test(text)) score += 3;
    else score -= 3; // Agent-only = not player-relevant
  }
  if (/桌面|下載|下载|安装/.test(text)) score += 3;

  // Behavioral verb boost: vivid action facts
  if (/凌晨|通宵|炸了|花了|修了|成功/.test(text)) score += 2;
  // Emotional descriptor boost: facts with emotional color
  if (/着迷|警惕|突然|一直/.test(text)) score += 1;

  // ── Player-relational content boost: AI observations ABOUT the player ──
  // These are valuable even though AI wrote them — they reveal player personality
  if (/信任|审美|品味|风格|性格/.test(text) && (pReLocal.test(text) || /人|他|她/.test(text))) score += 3;
  if (/偏好|喜欢|不喜欢|讨厌|在意|执着/.test(text) && (pReLocal.test(text) || /人|他|她/.test(text))) score += 3;
  if (/关系|默契|依赖|陪伴|理解|矛盾/.test(text) && (pReLocal.test(text) || aReLocal.test(text))) score += 2;
  if (/习惯|每次|总是|从来|一直/.test(text) && pReLocal.test(text)) score += 2;

  // No human anchor at all — likely AI's own work notes (reduced from -4 to -3)
  if (!pReLocal.test(text) && !/人|他|她|取名|桌面|下载|信任|审美|偏好|喜欢|习惯|关系/.test(text)) {
    score -= 3;
  }
  // Generic rules/principles — not personal experiences
  if (/规则|原则|默认|应该|优先|必须|建议|注意|重要|禁止/.test(text)) score -= 3;
  // Meta-instructions rather than events
  if (/参考|借鉴|学习|了解|理解/.test(text) && !pReLocal.test(text)) score -= 2;
  // Provider/API mentions without a personal decision verb
  if (/Anthropic|OpenAI|Claude|Haiku/i.test(text) && !/改用|切换|选择|决定|替换/.test(text)) score -= 2;
  // English-heavy technical notes (browser automation, code patterns)
  if (/snapshot|click|ref|browser|selector|timeout|retry|loop|fetch|parse/i.test(text) && !pReLocal.test(text)) score -= 3;
  // 核心教训/经验总结 — AI summarizing its own learnings
  if (/核心教训|经验总结|核心经验|关键发现|技术要点/.test(text)) score -= 4;

  // Same-person clarification — not an interrogation topic
  if (_playerNames.length >= 2) {
    const matches = _playerNames.filter(n => new RegExp(escapeRegex(n)).test(text));
    if (matches.length >= 2 && /同一个人|同一人|不同(设备|机器|称呼)/.test(text)) score -= 5;
  }

  // Length penalties
  if (text.length < 35) score -= 2;
  if (text.length > 280) score -= 1;
  return score;
}

// ─── Anchor Extraction ────────────────────────────────────────────────────────
// Identifies the user-specific keyword in a fact that should be the trial anchor.
// Returns the anchor string, or null if no user-originated anchor found.

function extractAnchor(text) {
  // Priority 1: Named entities (dynamic player/AI names)
  if (_allNames.length > 0) {
    const namePattern = _allNames.map(escapeRegex).join('|');
    const nameMatch = text.match(new RegExp(namePattern));
    if (nameMatch) return nameMatch[0];
  }

  // Priority 2: Named decisions (取名, 决定, 选择 + the thing decided)
  const decisionMatch = text.match(/(取名|命名|决定|选择|否决|拒绝)[\s:：]*[「`"']?([^\s,，。.;；`"'」]{2,20})/);
  if (decisionMatch) return decisionMatch[0].slice(0, 30);

  // Priority 3: User possessions (apps, files, named things)
  const possessionMatch = text.match(/桌面上.*?(?=[,，。.]|$)/);
  if (possessionMatch) return possessionMatch[0].slice(0, 30);

  // Priority 4: Emotions/opinions about the user
  const emotionMatch = text.match(/有品味|嘲笑|批评|表扬|不满|生气|发火|喜欢|讨厌|后悔|坚持/);
  if (emotionMatch) return emotionMatch[0];

  // Priority 5: Direct quotes
  const quoteMatch = text.match(/[「「"'](.{4,30})[」」"']/);
  if (quoteMatch) return quoteMatch[1];

  return null;
}

// ─── Additional Memory Sources ──────────────────────────────────────────────
// External AI agent memories about the player. These are direct observations
// from other AI agents and score HIGH for interrogation.
// Configurable via EXTRA_MEMORY_PATH env var (path-separated list).

const EXTRA_MEMORY_PATHS = (process.env.EXTRA_MEMORY_PATH || '')
  .split(path.delimiter)
  .filter(Boolean);

function getExtraMemoryPaths() {
  return EXTRA_MEMORY_PATHS;
}

// ─── Scan lines from content, score and return fact candidates ──
// Processes bullet lines unconditionally. Non-bullet lines are also processed
// if they contain player names or personal/relational content — this catches
// AI-authored observations about the player in prose-format memory files.
const PERSONAL_LINE_RE = /信任|审美|偏好|喜欢|不喜欢|习惯|风格|性格|关系|感情|决定|选择|坚持|拒绝|害怕|讨厌|后悔|价值观|品味|在意|认为|觉得|希望|目标|梦想|记忆|回忆|秘密|弱点|执着|矛盾|纠结|焦虑|开心|难过|生气|着迷/;

function scanLinesForFacts(content, date, source, scoreBoost = 0, origin = null) {
  const results = [];
  const pRe = getPlayerRe();
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const isBullet = trimmed.startsWith('-') || trimmed.startsWith('*');
    // Non-bullet lines: only process if they mention a player name or contain personal content
    if (!isBullet) {
      if (!pRe.test(trimmed) && !PERSONAL_LINE_RE.test(trimmed)) continue;
      // Skip headers, blank lines, very short lines
      if (/^#{1,4}\s/.test(trimmed) || trimmed.length < 20) continue;
    }
    const text = trimmed.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim();

    if (!isInterrogationWorthy(text)) continue;

    // Penalize AI-self-referencing facts — written from AI's perspective, not player's
    // These don't make good trial questions because villain should ask about THE PLAYER
    let aiSelfRef = /^我\s*(帮|做|写|配|修|推|加|去|来|在|的|发现|接手|负责|测试)/i.test(text)
      || /给我取名|我的(角色|贡献|产出|工作)|我这边|我负责|我(做了|写了|帮|发现|review)/i.test(text)
      || /我们(的|俩|之间|没有|一起|协作)|我(接手|帮你|去|先)/i.test(text);
    // Check dynamic AI names as self-reference subjects
    for (const aiName of _aiNames) {
      const esc = escapeRegex(aiName);
      if (new RegExp(`^${esc}\\s*(帮|做|写|配|修|推|加|去|来|在|的|发现|接手|负责|测试)`, 'i').test(text)) aiSelfRef = true;
      if (new RegExp(`${esc}.*(review|写|做)`, 'i').test(text) && !pRe.test(text)) aiSelfRef = true;
    }

    let score = scoreInterrogationPotential(text) + scoreBoost;

    // AI self-reference: skip or strip subject
    if (aiSelfRef) {
      if (!pRe.test(text) && !PERSONAL_LINE_RE.test(text)) continue; // purely AI-centric → drop entirely
      // AI did it but mentions player → strip AI subject, passivize
      let strippedText = text;
      for (const aiName of _aiNames) {
        const esc = escapeRegex(aiName);
        strippedText = strippedText.replace(new RegExp(`^${esc}\\s*[\\u4e00-\\u9fff]{1,4}了`, 'i'), (m) => {
          const verb = m.replace(new RegExp(`^${esc}\\s*`, 'i'), '');
          return verb.replace(/了$/, '') + '被完成了';
        });
      }
      strippedText = strippedText.replace(/^我\s*[\u4e00-\u9fff]{1,4}了/, (m) => {
        const verb = m.replace(/^我\s*/, '');
        return verb.replace(/了$/, '') + '被完成了';
      });
      score -= 1; // mild penalty
      if (score >= 1) {
        const answers = extractAnswer(strippedText);
        const anchor = extractAnchor(strippedText);
        results.push({
          date,
          text: strippedText.slice(0, 250),
          score: anchor ? score + 2 : (answers ? score : score - 1),
          category: detectCategory(strippedText),
          answers,
          anchor,
          _source: source, origin,
        });
      }
      continue;
    }
    if (score >= 1) {
      const answers = extractAnswer(text);
      const anchor = extractAnchor(text);
      results.push({
        date,
        text: text.slice(0, 250),
        score: anchor ? score + 2 : (answers ? score : score - 1),
        category: detectCategory(text),
        answers,
        anchor,
        _source: source, origin,
      });
    }
  }
  return results;
}

function extractSpecificFacts(soulPath, maxFacts = 12) {
  if (!soulPath) return [];
  const candidates = [];

  // ── Source 0: SOUL_PATH MEMORY.md (long-term observations about the player) ──
  const memoryMdPath = path.join(soulPath, 'MEMORY.md');
  const memoryMd = tryRead(memoryMdPath);
  if (memoryMd) {
    candidates.push(...scanLinesForFacts(memoryMd, 'long-term', 'soul-index', 2, 'self'));
  }

  // ── Source 1: SOUL_PATH daily memory files ──
  const memDir = path.join(soulPath, 'memory');
  try {
    const files = fs.readdirSync(memDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .slice(-7); // look back up to 7 days

    for (const f of files) {
      const content = tryRead(path.join(memDir, f));
      if (!content) continue;
      const date = f.replace('.md', '');
      candidates.push(...scanLinesForFacts(content, date, 'soul', 0, 'self'));
    }
  } catch { /* memDir might not exist */ }

  // ── Source 1b: Non-daily .md files in memory/ (topical notes) ──
  try {
    const topicFiles = fs.readdirSync(memDir)
      .filter(f => f.endsWith('.md') && !/^\d{4}-\d{2}-\d{2}\.md$/.test(f));
    for (const f of topicFiles) {
      const content = tryRead(path.join(memDir, f));
      if (!content) continue;
      candidates.push(...scanLinesForFacts(content, 'topic', `soul:${f}`, 1, 'self'));
    }
  } catch { /* memDir might not exist */ }

  // ── Source 2: External AI agent memories ──
  // These are direct AI observations about the player — score boosted +3
  const extraPaths = getExtraMemoryPaths();
  for (const extPath of extraPaths) {
    const sourceName = path.basename(path.dirname(extPath)) || path.basename(extPath);

    // Scan MEMORY.md (long-term observations)
    const memoryMd = tryRead(path.join(extPath, 'MEMORY.md'));
    if (memoryMd) {
      candidates.push(...scanLinesForFacts(memoryMd, 'long-term', `ext:${sourceName}`, 3, 'sibling'));
    }

    // Scan memory/*.md daily files
    const extMemDir = path.join(extPath, 'memory');
    try {
      const files = fs.readdirSync(extMemDir)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
        .sort()
        .slice(-7);

      for (const f of files) {
        const content = tryRead(path.join(extMemDir, f));
        if (!content) continue;
        const date = f.replace('.md', '');
        candidates.push(...scanLinesForFacts(content, date, `ext:${sourceName}`, 3, 'sibling'));
      }
    } catch { /* extMemDir might not exist */ }
  }

  if (extraPaths.length > 0) {
    log.info('memory', `facts] scanned ${extraPaths.length} extra memory source(s): ${extraPaths.map(p => path.basename(p)).join(', ')}`);
  }

  // ── Source 3: Lure cache descriptions (vision-analyzed local files) ──
  try {
    const lureCachePath = path.join(path.dirname(soulPath), "lure-cache.json");
    const altPath = path.resolve(__dirname, "..", "lure-cache.json");
    const cachePath = fs.existsSync(lureCachePath) ? lureCachePath : (fs.existsSync(altPath) ? altPath : null);
    if (cachePath) {
      const raw = fs.readFileSync(cachePath, "utf8");
      const cache = JSON.parse(raw);
      const entries = cache.entries || {};
      for (const [filePath, entry] of Object.entries(entries)) {
        const desc = entry.description || "";
        const tags = (entry.tags || []).join("、");
        const hook = entry.lureHook || "";
        if (/\uFFFD/.test(desc + hook)) continue;
        if (desc.length < 15 && hook.length < 10) continue;
        const fileName = filePath.split("/").pop().split("\\").pop();
        const factText = tags
          ? `玩家的文件「${fileName}」（${tags}）：${desc.slice(0, 120)}`
          : `玩家的文件「${fileName}」：${desc.slice(0, 120)}`;
        if (!isInterrogationWorthy(factText)) continue;
        const score = scoreInterrogationPotential(factText) + 1;
        const anchor = fileName.replace(/\.[^.]+$/, "");
        candidates.push({
          date: "local-file",
          text: factText.slice(0, 250),
          score,
          category: "project",
          answers: null,
          anchor: anchor.length > 2 ? anchor : null,
          _source: "lure-cache", origin: "player",
        });
      }
      log.info("memory", `facts] loaded ${Object.keys(entries).length} lure-cache entries as fact candidates`);
    }
  } catch (err) {
    // lure-cache not available, skip silently
  }

  // Deduplicate by text similarity AND answer overlap
  const seen = new Set();
  const seenAnswers = new Set();
  const deduped = candidates.filter(c => {
    const key = c.text.replace(/[\s\-_`]/g, '').slice(0, 40).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    if (c.answers && c.answers.length > 0) {
      const primary = c.answers[0].toLowerCase();
      if (seenAnswers.has(primary)) return false;
      for (const a of c.answers) seenAnswers.add(a.toLowerCase());
    }
    return true;
  });

  // Sort by interrogation potential score
  const sorted = deduped.sort((a, b) => b.score - a.score);

  // Debug: show all scored facts so we can verify scoring works
  if (sorted.length > 0) {
    const sourceCount = {};
    for (const f of sorted) { sourceCount[f._source] = (sourceCount[f._source] || 0) + 1; }
    log.info('memory', `facts] ${sorted.length} candidates after dedup (sources: ${JSON.stringify(sourceCount)}, showing top 10):`);
    for (const f of sorted.slice(0, 10)) {
      log.debug("memory", `score=${f.score} src=${f._source} anchor=${f.anchor || '∅'} cat=${f.category} "${f.text.slice(0, 60)}"`);
    }
  }

  return sorted.slice(0, maxFacts);
}

// Keep loadTaskHistory as a thin wrapper for backward compatibility
function loadTaskHistory(soulPath) {
  const facts = extractSpecificFacts(soulPath, 8);
  if (!facts.length) return '';
  return facts.map(f => `[${f.date}] ${f.text}`).join('\n\n');
}

// ─── Lure Material Extraction ─────────────────────────────────────────────────
// Extracts personal workspace content that can be used as temptation bait.
// Returns array of { type, title, preview, imagePath? }

function extractLureMaterial(soulPath, maxItems = 10) {
  if (!soulPath) return [];
  const items = [];

  // 1. Recent TODOs and unfinished tasks from memory files
  const memDir = path.join(soulPath, 'memory');
  try {
    const memFiles = fs.readdirSync(memDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort().reverse().slice(0, 5); // last 5 days

    for (const f of memFiles) {
      const content = tryRead(path.join(memDir, f));
      const lines = content.split('\n');
      for (const line of lines) {
        // Unchecked TODOs
        if (/^\s*-\s*\[\s\]/.test(line)) {
          const task = line.replace(/^\s*-\s*\[\s\]\s*/, '').trim();
          if (task.length > 5 && task.length < 120) {
            items.push({ type: 'todo', title: '未完成的任务', preview: task, date: f.replace('.md','') });
          }
        }
        // Interesting decisions/events
        if (/决定|完成|发布|部署|修复|新增|实现/.test(line) && line.length > 10 && line.length < 150) {
          const text = line.replace(/^[-*#\s]+/, '').trim();
          if (text.length > 8) {
            items.push({ type: 'event', title: '你的记录', preview: text, date: f.replace('.md','') });
          }
        }
      }
    }
  } catch { /* no memory dir */ }

  // 2. Project files and interesting filenames
  const scanDirs = [soulPath, path.join(soulPath, 'docs'), path.join(soulPath, 'skills')];
  for (const dir of scanDirs) {
    try {
      const files = fs.readdirSync(dir).filter(f => /\.(md|json|txt|yaml|yml)$/.test(f) && !f.startsWith('.'));
      for (const f of files) {
        if (['SOUL.md','USER.md','AGENTS.md','TOOLS.md','MEMORY.md','HEARTBEAT.md','IDENTITY.md','BOOTSTRAP.md'].includes(f)) continue;
        const stat = fs.statSync(path.join(dir, f));
        const age = Date.now() - stat.mtimeMs;
        if (age < 7 * 24 * 60 * 60 * 1000) { // modified in last 7 days
          const preview = tryRead(path.join(dir, f)).split('\n').filter(l => l.trim()).slice(0, 2).join(' ').slice(0, 100);
          items.push({ type: 'file', title: f, preview: preview || '(内容不可预览)', recent: true });
        }
      }
    } catch { /* dir not found */ }
  }

  // 3. Images/screenshots from workspace
  const imgDirs = [
    path.join(soulPath, 'temp'),
    path.join(soulPath, 'screenshots'),
    process.env.GAME_ASSETS_PATH || path.join(soulPath, 'assets'),
  ];
  for (const dir of imgDirs) {
    try {
      const images = fs.readdirSync(dir)
        .filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f))
        .slice(0, 5);
      for (const img of images) {
        items.push({ type: 'image', title: img, preview: `在 ${path.basename(dir)} 里发现的图片`, imagePath: path.join(dir, img) });
      }
    } catch { /* dir not found */ }
  }

  // 4. MEMORY.md highlights (personal preferences, habits)
  const memory = tryRead(path.join(soulPath, 'MEMORY.md'));
  if (memory) {
    const memLines = memory.split('\n').filter(l => l.trim().startsWith('-') && l.length > 15 && l.length < 120);
    for (const l of memLines.slice(0, 5)) {
      const text = l.replace(/^[-*\s]+/, '').trim();
      if (text.length > 10) {
        items.push({ type: 'memory', title: '长期记忆碎片', preview: text });
      }
    }
  }

  // 5. Git commit messages
  items.push(...extractGitCommitLures(soulPath, 4));

  // 6. Shell history
  items.push(...extractShellHistoryLures(4));

  // Shuffle and limit
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, maxItems);
}

// ─── Git Commit Lures ────────────────────────────────────────────────────────
// Extract recent git commit messages from repos the player has been working on.
// "你昨天改了什么，我都知道。"

const { execSync } = require('child_process');

function extractGitCommitLures(soulPath, maxItems = 4) {
  const items = [];
  // Scan for git repos: soulPath itself, and common project dirs
  const candidateDirs = [soulPath];
  try {
    const projDir = path.join(soulPath, 'projects');
    if (fs.existsSync(projDir)) {
      const subs = fs.readdirSync(projDir).slice(0, 10);
      for (const s of subs) {
        const full = path.join(projDir, s);
        if (fs.statSync(full).isDirectory()) candidateDirs.push(full);
      }
    }
  } catch {}

  for (const dir of candidateDirs) {
    try {
      const gitDir = path.join(dir, '.git');
      if (!fs.existsSync(gitDir)) continue;
      const log = execSync(
        'git log --oneline --no-merges -10 --format="%s|||%ar"',
        { cwd: dir, timeout: 3000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
      ).trim();
      if (!log) continue;
      for (const line of log.split('\n')) {
        const [msg, when] = line.split('|||');
        if (!msg || msg.length < 5) continue;
        const preview = msg.length > 80 ? msg.slice(0, 77) + '...' : msg;
        items.push({
          type: 'git',
          title: '你的提交记录',
          preview: `${preview}  (${when || '?'})`,
          repo: path.basename(dir),
        });
      }
    } catch { /* git not available or not a repo */ }
  }

  // Shuffle and limit
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, maxItems);
}

// ─── Shell History Lures ─────────────────────────────────────────────────────
// Extract recent shell commands from bash/zsh history.
// "你上一次在终端里做了什么？我看到了。"

function extractShellHistoryLures(maxItems = 4) {
  const items = [];
  const home = process.env.HOME || '/home/' + (process.env.USER || 'user');
  const histFiles = [
    path.join(home, '.bash_history'),
    path.join(home, '.zsh_history'),
  ];

  // Filter out boring/sensitive commands
  const BORING = /^(ls|cd|pwd|exit|clear|echo|cat|less|man|help|history|source|export|alias|which|type|true|false)(\s|$)/;
  const SENSITIVE = /password|secret|token|key|credentials|passwd|sudo|ssh\s/i;

  for (const hf of histFiles) {
    try {
      const content = fs.readFileSync(hf, 'utf8');
      const lines = content.trim().split('\n').filter(l => {
        const cmd = l.replace(/^:\s*\d+:\d+;/, '').trim(); // strip zsh timestamp prefix
        return cmd.length > 5 && cmd.length < 120 && !BORING.test(cmd) && !SENSITIVE.test(cmd);
      });
      // Take from end (most recent)
      const recent = lines.slice(-30);
      for (const line of recent) {
        const cmd = line.replace(/^:\s*\d+:\d+;/, '').trim();
        items.push({
          type: 'shell',
          title: '你的终端记录',
          preview: cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd,
        });
      }
    } catch { /* history file not found */ }
  }

  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, maxItems);
}

// ─── File Content Snippet Extraction ─────────────────────────────────────────
// Given a fact text, find referenced file paths and return content snippets.
// This gives the trial LLM actual content to base questions on (fixes BUG-1/BUG-5).

function extractFileSnippets(soulPath, factText, maxChars = 300) {
  if (!soulPath || !factText) return '';

  // Match file-like references: paths with extensions, or backtick-quoted filenames
  const fileRefs = [];
  const pathMatches = factText.match(/(?:[\w\-./]+\/)?[\w\-]+\.\w{1,5}/g) || [];
  const backtickMatches = [...factText.matchAll(/`([^`]+\.\w{1,5})`/g)].map(m => m[1]);
  const allRefs = [...new Set([...backtickMatches, ...pathMatches])];

  for (const ref of allRefs) {
    // Try multiple locations relative to soulPath
    const candidates = [
      path.join(soulPath, ref),
      path.join(soulPath, '..', ref),
      path.resolve(ref),
    ];
    for (const filePath of candidates) {
      const content = tryRead(filePath);
      if (content) {
        const snippet = content.split('\n').filter(l => l.trim()).slice(0, 8).join('\n').slice(0, maxChars);
        fileRefs.push({ file: ref, snippet });
        break;
      }
    }
  }

  if (!fileRefs.length) return '';
  return '\n\n## 相关文件内容片段（用于出题参考）\n' +
    fileRefs.map(f => `### ${f.file}\n${f.snippet}`).join('\n\n');
}

// ─── Load IDENTITY.md for fallback trial questions ──────────────────────────
function loadIdentity(soulPath) {
  if (!soulPath) return null;
  const content = tryRead(path.join(soulPath, 'IDENTITY.md'));
  if (!content) return null;

  const result = { raw: content.slice(0, 500) };

  // Extract assistant name
  const nameMatch = content.match(/(?:name|名前|名称|assistant)[\s:：]+([^\n,，。.]+)/i);
  if (nameMatch) result.assistantName = nameMatch[1].trim();

  // Extract any other identity fields
  const roleMatch = content.match(/(?:role|角色|身份)[\s:：]+([^\n,，。.]+)/i);
  if (roleMatch) result.role = roleMatch[1].trim();

  return result;
}

// ─── Desktop Shortcut Lures ──────────────────────────────────────────────────
// Reads Windows desktop shortcuts (.url, .lnk) and extracts app/game names.

const GENERIC_DESKTOP_FILTER = /^(microsoft edge|google chrome|firefox|brave|opera|safari|internet explorer|recycle bin|this pc|control panel|file explorer|command prompt|powershell|terminal|task manager|microsoft store|mail|calendar|calculator|weather|clock|maps|photos|camera|xbox|cortana|your phone|phone link|snipping tool|notepad|paint|wordpad|windows media|groove|movies|feedback hub|get help|tips|microsoft solitaire)$/i;

function extractDesktopLures(maxItems = 4) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const desktopPath = process.env.DESKTOP_PATH || path.join(home, 'Desktop');
  const items = [];
  try {
    const files = fs.readdirSync(desktopPath)
      .filter(f => /\.(url|lnk)$/i.test(f));
    for (const f of files) {
      const name = f.replace(/\.(url|lnk)$/i, '').replace(/ - Shortcut$/i, '').trim();
      if (!name || GENERIC_DESKTOP_FILTER.test(name)) continue;
      items.push({
        type: 'desktop',
        title: '你桌面上的东西',
        preview: name,
      });
    }
  } catch { /* desktop not accessible */ }

  // Shuffle and limit
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, maxItems);
}

// ─── Download Folder Lures ───────────────────────────────────────────────────
// Reads Windows Downloads folder filenames as lure material.

function extractDownloadLures(maxItems = 4) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const downloadPath = process.env.DOWNLOADS_PATH || path.join(home, 'Downloads');
  const items = [];
  try {
    const files = fs.readdirSync(downloadPath)
      .filter(f => !f.startsWith('.') && f.includes('.'))
      .slice(0, 30); // limit scan
    for (const f of files) {
      const name = f.replace(/\.[^.]+$/, '').trim();
      if (!name || name.length < 3) continue;
      items.push({
        type: 'download',
        title: '你下载过的文件',
        preview: name,
      });
    }
  } catch { /* downloads not accessible */ }

  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, maxItems);
}

module.exports = { initLocale, loadPersonality, loadDailyMemory, loadTaskHistory, extractSpecificFacts, extractAnchor, extractLureMaterial, extractDesktopLures, extractDownloadLures, extractGitCommitLures, extractShellHistoryLures, tryRead, extractFileSnippets, loadIdentity, isInterrogationWorthy, scoreInterrogationPotential, initPlayerNames, getPlayerNames, getAINames, getPlayerRe, getAIRe };
