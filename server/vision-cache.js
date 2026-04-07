'use strict';

// ─── Vision Cache System ─────────────────────────────────────────────────────
// Analyzes images using vision models and caches results to JSON.
// Used by the enhanced lure system to generate contextually accurate
// temptation text that matches image content.

const fs   = require('fs');
const path = require('path');
const llmGate = require('./utils/llm-gate');

// ─── Locale support ─────────────────────────────────────────────────────────
let _locale = null;
function _t(key, params) {
  let s = (_locale && _locale[key]) || require('./locales/zh')[key] || key;
  if (params) { for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v); }
  return s;
}
function initLocale(ctx) { _locale = require('./locales/' + (ctx.LOCALE || 'zh')); }

// ─── Sensitive Line Patterns ──────────────────────────────────────────────────
// Lines matching these are replaced with ██ REDACTED ██ in textPreview.
// This prevents real credentials from appearing in the game UI.
const SENSITIVE_LINE_RE = [
  // key=value / key: value (bare or quoted)
  /(?:password|passwd|pwd)\s*[=:]\s*['"]?\S+/i,
  /(?:secret|api[-_]?key|apikey|access[-_]?key|private[-_]?key)\s*[=:]\s*['"]?\S+/i,
  /(?:token|bearer|auth[-_]?token|authtoken)\s*[=:]\s*['"]?\S+/i,
  // Well-known env-var prefixes
  /(?:AWS_|OPENAI_|ANTHROPIC_|GITHUB_|DISCORD_|TELEGRAM_|DATABASE_URL\s*=)/i,
  // Known secret key prefixes
  /sk-[A-Za-z0-9-]{20,}/,          // OpenAI / Anthropic style keys (incl. sk-proj-xxx)
  /ghp_[A-Za-z0-9]{30,}/,         // GitHub PAT
  /xox[bpas]-[A-Za-z0-9-]{10,}/,  // Slack tokens
  // NPM auth tokens: //registry.npmjs.org/:_authToken=XXX
  /\/\/.+:\/_?authToken\s*=/i,
  // URL-embedded credentials: https://user:pass@host or mongodb+srv://u:p@host
  /(?:https?|mongodb(?:\+srv)?|postgresql|mysql):\/\/[^@\s:]+:[^@\s]+@/i,
  // Long base64 blobs on their own (likely keys / certs)
  /^[A-Za-z0-9/+]{40,}={0,2}$/,
];

/**
 * Scrub lines containing sensitive patterns from a text preview.
 * Replaces whole offending lines with a redaction placeholder.
 * @param {string} text
 * @returns {string}
 */
function scrubSensitiveLines(text) {
  if (!text) return text;
  return text.split('\n').map(line => {
    if (SENSITIVE_LINE_RE.some(re => re.test(line))) {
      // Preserve line for context but mask the value
      const key = line.split(/[=:]/)[0].trim().slice(0, 30);
      return key ? `${key}=██████` : '██████';
    }
    return line;
  }).join('\n');
}

const CACHE_FILE = path.join(__dirname, '..', 'lure-cache.json');
const CACHE_VERSION = 1;

// ─── Cache Structure ─────────────────────────────────────────────────────────
// {
//   version: 1,
//   lastScan: timestamp,
//   entries: {
//     [filePath]: {
//       hash: string (mtime+size),
//       description: string,
//       tags: string[],
//       mood: string,        // emotional tone for lure text
//       lureHook: string,    // short temptation teaser
//       scannedAt: timestamp,
//     }
//   }
// }

let _cache = null;

function loadCache() {
  if (_cache) return _cache;
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data.version === CACHE_VERSION) {
      _cache = data;
      console.log(`[vision-cache] loaded ${Object.keys(data.entries || {}).length} cached entries`);
      return _cache;
    }
  } catch { /* no cache or corrupted */ }
  _cache = { version: CACHE_VERSION, lastScan: 0, entries: {} };
  return _cache;
}

function saveCache() {
  if (!_cache) return;
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(_cache, null, 2));
  } catch (err) {
    console.warn('[vision-cache] failed to save cache:', err.message);
  }
}

function fileHash(filePath, stat) {
  return `${stat.mtimeMs}:${stat.size}`;
}

function getCachedEntry(filePath) {
  const cache = loadCache();
  const entry = cache.entries[filePath];
  if (!entry) return null;

  // Validate hash (file unchanged)
  try {
    const stat = fs.statSync(filePath);
    if (fileHash(filePath, stat) !== entry.hash) return null;
  } catch { return null; }

  return entry;
}

/**
 * Analyze a single image using the LLM's vision capability.
 * Returns { description, tags, mood, lureHook } or null on failure.
 *
 * @param {object} llm - LLM client with chat() method
 * @param {string} imagePath - Path to image file
 */
async function analyzeImage(llm, imagePath) {
  if (!llm || !llm.chatWithImage) return null;

  // ── Guard: skip oversized images (>4.5 MB) to avoid API payload errors ──
  try {
    const stat = fs.statSync(imagePath);
    if (stat.size > 4.5 * 1024 * 1024) {
      console.warn(`[vision-cache] skipping ${path.basename(imagePath)}: file too large (${(stat.size / 1024 / 1024).toFixed(1)} MB > 4.5 MB limit)`);
      return null;
    }
  } catch {
    return null;
  }

  // Include file path context so vision model can use directory names as hints
  const pathHint = imagePath ? `\n\n${_t('vision.path_hint_prefix')}${imagePath.split('/').slice(-3).join('/')}` : '';

  const prompt = _t('vision.analyze_prompt') + pathHint;

  // ── Retryable error detection ──────────────────────────────────────────
  const RETRYABLE_RE = /SSL|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i;
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY = 2000;

  try {
    const imageData = fs.readFileSync(imagePath);
    const base64 = imageData.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
    const mimeType = mimeMap[ext] || 'image/png';

    // ── Vision call with retry on transient network errors ──────────────
    let raw;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        raw = await Promise.race([
          llm.chatWithImage(prompt, base64, mimeType, { max_tokens: 300, temperature: 0.7 }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('vision timeout (15s)')), 15000)),
        ]);
        break; // success
      } catch (err) {
        if (attempt < MAX_ATTEMPTS && RETRYABLE_RE.test(err.message)) {
          console.warn(`[vision-cache] transient error analyzing ${path.basename(imagePath)} (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.message}, retrying in ${RETRY_DELAY / 1000}s…`);
          await new Promise(r => setTimeout(r, RETRY_DELAY));
          continue;
        }
        throw err; // non-retryable or final attempt — bubble up
      }
    }

    // Parse JSON from response (with tolerance for markdown fences & trailing commas)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    let jsonStr = jsonMatch[0];
    // Strip markdown code fences that some models wrap around JSON
    jsonStr = jsonStr.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
    // Fix trailing commas before } or ]
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.warn(`[vision-cache] JSON parse failed for ${path.basename(imagePath)}, raw snippet: ${jsonStr.slice(0, 120)}`);
      return null;
    }
    if (!parsed.description) return null;

    // ── Path-based correction: trust directory names over vision recognition ──
    // Extract meaningful directory names from path (e.g. "Mecha BREAK" from ".../Mecha BREAK/Screenshots/")
    const pathParts = imagePath.replace(/\\/g, '/').split('/');
    const meaningfulDirs = pathParts.slice(-4, -1).filter(d =>
      d && !['Screenshots', 'screenshots', 'Images', 'images', 'Mods', 'My Games', 'Documents'].includes(d)
    );
    if (meaningfulDirs.length > 0) {
      const dirName = meaningfulDirs[meaningfulDirs.length - 1]; // closest parent
      // If description mentions a different game name, correct it
      const descLower = (parsed.description || '').toLowerCase();
      const dirLower = dirName.toLowerCase();
      // Check if directory name is NOT mentioned in description (potential misidentification)
      if (dirLower.length > 3 && !descLower.includes(dirLower.replace(/[^a-z0-9\u4e00-\u9fff]/g, ''))) {
        // Prepend correction note
        parsed.description = _t('vision.path_correction', { dirName, desc: parsed.description });
        // Fix tags: add directory name, remove potentially wrong game names
        if (!parsed.tags) parsed.tags = [];
        parsed.tags.unshift(dirName);
        console.log(`[vision-cache] path-corrected: added "${dirName}" to description for ${path.basename(imagePath)}`);
      }
    }

    // ── Quality gate: replace weak/generic lureHooks with description-derived fallbacks ──
    parsed.lureHook = normalizeImageHook(parsed.lureHook, parsed.description, parsed.tags || []);
    // ── Alt hooks for session variety (shown on repeat encounters) ──
    parsed.altHooks = generateImageAltHooks(parsed.description, parsed.tags || [], parsed.lureHook);
    return parsed;
  } catch (err) {
    console.warn(`[vision-cache] failed to analyze ${path.basename(imagePath)}:`, err.message);
    return null;
  }
}

/**
 * Ensure a vision-generated lureHook meets quality standards.
 * Rejects hooks that are too short, too long, or match known generic patterns.
 * Falls back to description-derived template hooks.
 *
 * @param {string} hook - LLM-generated hook
 * @param {string} description - Vision description of the image
 * @param {string[]} tags - Tags from vision analysis
 * @returns {string} Validated or replaced hook
 */
function normalizeImageHook(hook, description, tags) {
  // Bilingual weak/generic patterns: match both Chinese AND English since
  // hooks may arrive in either language depending on locale
  const WEAK_PATTERNS = [
    /里面有什么|what'?s inside/i,
    /点击查看|click to view/i,
    /里有秘密|has a secret/i,
    /这里藏着|hidden here/i,
    /神秘文件|mysterious file/i,
    /^\.{2,}$/, // just ellipsis
    /^查看$|^view$/i,
    /^这是什么|^what is this/i,
    /^打开看看|^open and see/i,
    /什么东西\？?$|what is it\??$/i,
    /里面是什么|what'?s in it/i,
    /你想看吗|want to see/i,
    /要查看吗|want to check/i,
    // Additional weak patterns LLMs tend to generate
    /^这张图片|^this image/i,
    /^这个图片|^this picture/i,
    /^这份文件|^this document/i,
    /^这个文件|^this file/i,
    /^图片内容|^image content/i,
    /值得一看|worth a look/i,
    /^请查看|^please view/i,
    /^展示了|^shows /i,
    /^包含了|^contains /i,
    /^显示了|^displays /i,
    /你看一看|take a look/i,
    /^一张图片|^an image/i,
    /^一个截图|^a screenshot/i,
    /^看看这个|^check this out/i,
  ];

  const isWeak = !hook
    || hook.length < 5
    || hook.length > 28
    || WEAK_PATTERNS.some(p => p.test(hook));

  if (!isWeak) return hook;

  // Build a replacement from tags + description
  const tagSet = new Set(tags.map(t => t.toLowerCase()));
  const desc = description || '';

  // Extract a notable noun/fragment from the description
  // Use CJK regex for zh, Latin word regex for en
  const useCJK = _t('vision.descfrag_re_cjk') === '1';
  const fragMatch = useCJK
    ? desc.match(/[\u4e00-\u9fff]{4,12}/)
    : desc.match(/[A-Za-z][\w'-]{3,15}/);
  const descFrag = fragMatch ? fragMatch[0] : null;

  // Helper: pick a localized hook, with descFrag interpolation
  function _h(key, noFragKey) {
    if (descFrag) return _t(key, { descFrag });
    return _t(noFragKey || key, { descFrag: '' });
  }

  if (tagSet.has('游戏') || tagSet.has('game') || /游戏|game/i.test(desc)) {
    return pick([
      _h('vision.hook.game.1', 'vision.hook.game.1.nofrag'),
      _t('vision.hook.game.2'),
      _h('vision.hook.game.3', 'vision.hook.game.3.nofrag'),
    ]);
  }
  if (tagSet.has('照片') || tagSet.has('photo') || /照片|photo|selfie|人物|face/i.test(desc)) {
    return pick([
      _t('vision.hook.photo.1'),
      _h('vision.hook.photo.2', 'vision.hook.photo.2.nofrag'),
      _t('vision.hook.photo.3'),
    ]);
  }
  if (tagSet.has('截图') || tagSet.has('screenshot') || /截图|screenshot/i.test(desc)) {
    return pick([
      _t('vision.hook.screenshot.1'),
      _h('vision.hook.screenshot.2', 'vision.hook.screenshot.2.nofrag'),
      _t('vision.hook.screenshot.3'),
    ]);
  }
  if (tagSet.has('工作') || tagSet.has('work') || /工作|代码|project|文件|code|work/i.test(desc)) {
    return pick([
      _h('vision.hook.work.1', 'vision.hook.work.1.nofrag'),
      _t('vision.hook.work.2'),
      _t('vision.hook.work.3'),
    ]);
  }
  if (tagSet.has('宠物') || tagSet.has('pet') || /猫|狗|宠物|cat|dog|pet/i.test(desc)) {
    return pick([
      _h('vision.hook.pet.1', 'vision.hook.pet.1.nofrag'),
      _t('vision.hook.pet.2'),
      _t('vision.hook.pet.3'),
    ]);
  }
  if (tagSet.has('食物') || tagSet.has('food') || /食物|美食|饭|菜|吃|restaurant|food/i.test(desc)) {
    return pick([
      _t('vision.hook.food.1'),
      _h('vision.hook.food.2', 'vision.hook.food.2.nofrag'),
      _t('vision.hook.food.3'),
    ]);
  }
  if (tagSet.has('风景') || tagSet.has('场景') || tagSet.has('scenery') || /风景|山|海|天空|landscape|nature|scenery/i.test(desc)) {
    return pick([
      _h('vision.hook.scenery.1', 'vision.hook.scenery.1.nofrag'),
      _t('vision.hook.scenery.2'),
      _h('vision.hook.scenery.3', 'vision.hook.scenery.3.nofrag'),
    ]);
  }
  if (tagSet.has('设计') || tagSet.has('UI') || tagSet.has('ui') || tagSet.has('design') || /设计|界面|UI|mockup|figma|sketch|prototype/i.test(desc)) {
    return pick([
      _h('vision.hook.design.1', 'vision.hook.design.1.nofrag'),
      _t('vision.hook.design.2'),
      _t('vision.hook.design.3'),
    ]);
  }
  if (tagSet.has('文字') || tagSet.has('text') || /文字|字幕|text.*image|截图.*文字/i.test(desc)) {
    return pick([
      _t('vision.hook.textimg.1'),
      _h('vision.hook.textimg.2', 'vision.hook.textimg.2.nofrag'),
      _t('vision.hook.textimg.3'),
    ]);
  }
  if (tagSet.has('人物') || tagSet.has('人像') || tagSet.has('portrait') || /人物|肖像|portrait|人|他|她|they/i.test(desc)) {
    return pick([
      _t('vision.hook.portrait.1'),
      _h('vision.hook.portrait.2', 'vision.hook.portrait.2.nofrag'),
      _t('vision.hook.portrait.3'),
    ]);
  }
  // Generic fallback using description fragment
  if (descFrag) {
    return pick([
      _t('vision.hook.generic.1', { descFrag }),
      _t('vision.hook.generic.2', { descFrag }),
      _t('vision.hook.generic.3', { descFrag }),
    ]);
  }
  return pick([
    _t('vision.hook.fallback.1'),
    _t('vision.hook.fallback.2'),
    _t('vision.hook.fallback.3'),
    _t('vision.hook.fallback.4'),
  ]);
}

/**
 * Generate 2-3 alternative lure hooks for an image (session variety).
 * Mirrors the topic branches in normalizeImageHook but picks from the
 * _other_ options in each pool, so they don't repeat the primary hook.
 *
 * @param {string} description - Vision description
 * @param {string[]} tags - Vision tags
 * @param {string} primaryHook - The already-chosen primary hook (excluded)
 * @returns {string[]} Up to 3 alternative hooks
 */
function generateImageAltHooks(description, tags, primaryHook) {
  const desc = (description || '').toLowerCase();
  const tagSet = new Set((tags || []).map(t => String(t).toLowerCase()));
  // Extract first meaningful phrase from description (≤12 chars)
  const descFrag = description ? description.replace(/[，。！？,.!?]/g, '').split(/\s+/)[0].slice(0, 12) : '';

  // Helper: pick a localized hook, with descFrag interpolation
  function _h(key, noFragKey) {
    if (descFrag) return _t(key, { descFrag });
    return _t(noFragKey || key, { descFrag: '' });
  }

  let pool = [];

  if (tagSet.has('游戏') || tagSet.has('game') || /游戏|steam|epic|mmo|rpg|fps/i.test(desc)) {
    pool = [
      _h('vision.alt.game.1', 'vision.alt.game.1.nofrag'),
      _t('vision.alt.game.2'),
      _t('vision.alt.game.3'),
      _h('vision.alt.game.4', 'vision.alt.game.4.nofrag'),
    ];
  } else if (tagSet.has('截图') || tagSet.has('screenshot') || /截图|screenshot/i.test(desc)) {
    pool = [
      _t('vision.alt.screenshot.1'),
      _t('vision.alt.screenshot.2'),
      _h('vision.alt.screenshot.3', 'vision.alt.screenshot.3.nofrag'),
    ];
  } else if (tagSet.has('工作') || tagSet.has('work') || /工作|代码|project|文件|code|work/i.test(desc)) {
    pool = [
      _t('vision.alt.work.1'),
      _t('vision.alt.work.2'),
      _h('vision.alt.work.3', 'vision.alt.work.3.nofrag'),
    ];
  } else if (tagSet.has('宠物') || tagSet.has('pet') || /猫|狗|宠物|cat|dog|pet/i.test(desc)) {
    pool = [
      _t('vision.alt.pet.1'),
      _t('vision.alt.pet.2'),
      _h('vision.alt.pet.3', 'vision.alt.pet.3.nofrag'),
    ];
  } else if (tagSet.has('食物') || tagSet.has('food') || /食物|美食|饭|菜|吃|restaurant|food/i.test(desc)) {
    pool = [
      _h('vision.alt.food.1', 'vision.alt.food.1.nofrag'),
      _t('vision.alt.food.2'),
      _t('vision.alt.food.3'),
    ];
  } else if (tagSet.has('风景') || tagSet.has('场景') || tagSet.has('scenery') || /风景|山|海|天空|landscape|nature|scenery/i.test(desc)) {
    pool = [
      _t('vision.alt.scenery.1'),
      _h('vision.alt.scenery.2', 'vision.alt.scenery.2.nofrag'),
      _h('vision.alt.scenery.3', 'vision.alt.scenery.3.nofrag'),
    ];
  } else if (tagSet.has('设计') || tagSet.has('ui') || tagSet.has('design') || /设计|界面|ui|mockup|figma|sketch|prototype/i.test(desc)) {
    pool = [
      _t('vision.alt.design.1'),
      _t('vision.alt.design.2'),
      _h('vision.alt.design.3', 'vision.alt.design.3.nofrag'),
    ];
  } else if (tagSet.has('文字') || tagSet.has('text') || /文字|字幕|text.*image|截图.*文字/i.test(desc)) {
    pool = [
      _h('vision.alt.textimg.1', 'vision.alt.textimg.1.nofrag'),
      _t('vision.alt.textimg.2'),
      _t('vision.alt.textimg.3'),
    ];
  } else if (tagSet.has('人物') || tagSet.has('人像') || tagSet.has('portrait') || /人物|肖像|portrait|人|他|她|they/i.test(desc)) {
    pool = [
      _h('vision.alt.portrait.1', 'vision.alt.portrait.1.nofrag'),
      _t('vision.alt.portrait.2'),
      _t('vision.alt.portrait.3'),
    ];
  } else {
    // Generic image alts
    pool = [
      _t('vision.alt.generic.1'),
      _t('vision.alt.generic.2'),
      _t('vision.alt.generic.3'),
      _h('vision.alt.generic.4', 'vision.alt.generic.4.nofrag'),
    ];
  }

  return pool.filter(h => h !== primaryHook).slice(0, 3);
}

/**
 * Generate a description for a text file without using LLM.
 * Uses filename, content preview, and heuristics.
 * Produces varied moods and content-aware hooks to avoid repetition.
 */
function analyzeTextFile(filePath, preview) {
  if (!preview) return null;

  const name = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const dir = path.basename(path.dirname(filePath));
  const content = preview.preview || '';
  const lines = preview.totalLines || 0;
  const nameLower = name.toLowerCase();
  const contentLower = content.toLowerCase();

  // ─── Tag detection (fine-grained) ────────────────────────────────────
  const tags = [];
  if (/game|游戏|迷宫|maze/.test(contentLower)) tags.push(_t('vision.tag.game'));
  if (/todo|TODO|待办|\[ \]/.test(content)) tags.push(_t('vision.tag.todo'));
  if (/password|secret|token|密码|api_key|apikey/i.test(content)) tags.push(_t('vision.tag.sensitive'));
  if (/log|日志|error|warn|debug/.test(nameLower)) tags.push(_t('vision.tag.log'));
  if (/config|配置|settings|\.env/i.test(nameLower)) tags.push(_t('vision.tag.config'));
  if (/readme/i.test(nameLower)) tags.push(_t('vision.tag.project'));
  if (ext === '.md') tags.push(_t('vision.tag.doc'));
  if (['.js', '.ts'].includes(ext)) tags.push(_t('vision.tag.code'));
  if (['.py'].includes(ext)) tags.push(_t('vision.tag.code'));
  if (['.sh', '.bash'].includes(ext)) tags.push(_t('vision.tag.script'));
  if (['.json', '.yaml', '.yml', '.toml'].includes(ext)) tags.push(_t('vision.tag.data'));
  if (['.css', '.html'].includes(ext)) tags.push(_t('vision.tag.frontend'));
  if (/memory|记忆|日记|diary/i.test(nameLower + contentLower)) tags.push(_t('vision.tag.memory'));
  if (/import|require|function|class|def |async /.test(content)) tags.push(_t('vision.tag.code'));
  if (/\d{4}-\d{2}-\d{2}/.test(name)) tags.push(_t('vision.tag.diary'));
  if (/fix|bug|issue|error|crash/i.test(contentLower)) tags.push(_t('vision.tag.issue'));
  if (/feat|add|impl|new\s/i.test(contentLower)) tags.push(_t('vision.tag.dev'));
  if (/think|想法|idea|plan|计划/i.test(contentLower)) tags.push(_t('vision.tag.idea'));

  // ─── Extract a juicy content snippet for hooks ────────────────────────
  // Find a line that's interesting (not blank, not pure comment, not too short)
  const interestingLine = (() => {
    const ls = content.split('\n').map(l => l.trim())
      .filter(l => l.length > 8 && l.length < 80)
      .filter(l => !/^[/#*\-]+$/.test(l))
      .filter(l => !/^import|require|from\s+/.test(l));
    // Prefer lines with Chinese or meaningful English words
    const zh = ls.find(l => /[\u4e00-\u9fff]{4,}/.test(l));
    const interesting = ls.find(l => /[A-Za-z]{5,}|[\u4e00-\u9fff]{3,}/.test(l));
    return zh || interesting || ls[0] || '';
  })();

  // Truncate snippet for display
  // Scrub sensitive values before using snippet in hooks/descriptions
  const rawSnippet = interestingLine.slice(0, 28).replace(/^[/#*\-\s]+/, '').trim();
  const snippet = SENSITIVE_LINE_RE.some(re => re.test(rawSnippet)) ? '' : rawSnippet;

  // ─── Mood detection (content-driven, far more varied) ────────────────
  const TAG_SENSITIVE = _t('vision.tag.sensitive');
  const TAG_DIARY = _t('vision.tag.diary');
  const TAG_MEMORY = _t('vision.tag.memory');
  const TAG_IDEA = _t('vision.tag.idea');
  const TAG_DEV = _t('vision.tag.dev');
  const TAG_TODO = _t('vision.tag.todo');
  const TAG_ISSUE = _t('vision.tag.issue');
  const TAG_CODE = _t('vision.tag.code');
  const TAG_SCRIPT = _t('vision.tag.script');
  const TAG_LOG = _t('vision.tag.log');
  const TAG_CONFIG = _t('vision.tag.config');
  const TAG_DATA = _t('vision.tag.data');
  const TAG_DOC = _t('vision.tag.doc');
  const TAG_PROJECT = _t('vision.tag.project');
  const TAG_GAME = _t('vision.tag.game');
  const TAG_FRONTEND = _t('vision.tag.frontend');

  let mood;
  if (tags.includes(TAG_SENSITIVE)) {
    mood = _t('vision.mood.curious');
  } else if (tags.includes(TAG_DIARY) || tags.includes(TAG_MEMORY)) {
    mood = pick([_t('vision.mood.nostalgic'), _t('vision.mood.complex'), _t('vision.mood.nostalgic')]);
  } else if (tags.includes(TAG_IDEA) || tags.includes(TAG_DEV)) {
    mood = pick([_t('vision.mood.playful'), _t('vision.mood.mocking'), _t('vision.mood.complex')]);
  } else if (tags.includes(TAG_TODO) || tags.includes(TAG_ISSUE)) {
    mood = pick([_t('vision.mood.mocking'), _t('vision.mood.dismissive'), _t('vision.mood.mocking')]);
  } else if (tags.includes(TAG_CODE) || tags.includes(TAG_SCRIPT)) {
    mood = pick([_t('vision.mood.dismissive'), _t('vision.mood.mocking'), _t('vision.mood.playful')]);
  } else if (tags.includes(TAG_LOG)) {
    mood = pick([_t('vision.mood.cold'), _t('vision.mood.complex'), _t('vision.mood.curious')]);
  } else if (tags.includes(TAG_CONFIG)) {
    mood = pick([_t('vision.mood.dismissive'), _t('vision.mood.cold'), _t('vision.mood.playful')]);
  } else if (tags.includes(TAG_DATA)) {
    mood = pick([_t('vision.mood.curious'), _t('vision.mood.cold'), _t('vision.mood.playful')]);
  } else if (tags.includes(TAG_DOC) || tags.includes(TAG_PROJECT)) {
    mood = pick([_t('vision.mood.playful'), _t('vision.mood.mocking'), _t('vision.mood.curious')]);
  } else {
    mood = pick([_t('vision.mood.cold'), _t('vision.mood.curious'), _t('vision.mood.playful'), _t('vision.mood.mocking'), _t('vision.mood.complex')]);
  }

  // ─── LureHook generation (content-aware, varied pools) ───────────────
  let lureHook;

  if (tags.includes(TAG_SENSITIVE)) {
    lureHook = pick([
      _t('vision.text.sensitive.1'),
      _t('vision.text.sensitive.2'),
      _t('vision.text.sensitive.3'),
      _t('vision.text.sensitive.4'),
      _t('vision.text.sensitive.5', { name }),
    ]);
  } else if (tags.includes(TAG_GAME)) {
    lureHook = pick([
      _t('vision.text.game.1', { name }),
      _t('vision.text.game.2'),
      snippet
        ? _t('vision.text.game.3', { snippet: snippet.slice(0, 20) })
        : _t('vision.text.game.3.nosnippet', { name }),
      _t('vision.text.game.4'),
      _t('vision.text.game.5', { name }),
    ]);
  } else if (tags.includes(TAG_DIARY)) {
    // Use actual date from filename if possible
    const dateMatch = name.match(/(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : _t('vision.text.diary.default_date');
    lureHook = pick([
      _t('vision.text.diary.1', { date }),
      _t('vision.text.diary.2', { date }),
      _t('vision.text.diary.3'),
      _t('vision.text.diary.4', { date }),
      snippet
        ? _t('vision.text.diary.5', { date, snippet: snippet.slice(0, 15) })
        : _t('vision.text.diary.5.nosnippet', { date }),
    ]);
  } else if (tags.includes(TAG_MEMORY)) {
    lureHook = pick([
      _t('vision.text.memory.1'),
      _t('vision.text.memory.2'),
      _t('vision.text.memory.3'),
      _t('vision.text.memory.4'),
      _t('vision.text.memory.5', { name }),
    ]);
  } else if (tags.includes(TAG_TODO) && snippet) {
    lureHook = pick([
      _t('vision.text.todo.1', { snippet }),
      _t('vision.text.todo.2'),
      _t('vision.text.todo.3'),
      _t('vision.text.todo.4', { snippet }),
      _t('vision.text.todo.5'),
    ]);
  } else if (tags.includes(TAG_IDEA) && snippet) {
    lureHook = pick([
      _t('vision.text.idea.1', { snippet }),
      _t('vision.text.idea.2'),
      _t('vision.text.idea.3'),
      _t('vision.text.idea.4', { name }),
      _t('vision.text.idea.5', { snippet }),
    ]);
  } else if (tags.includes(TAG_ISSUE) && snippet) {
    lureHook = pick([
      _t('vision.text.issue.1'),
      _t('vision.text.issue.2', { snippet }),
      _t('vision.text.issue.3'),
      _t('vision.text.issue.4', { name }),
      _t('vision.text.issue.5'),
    ]);
  } else if (tags.includes(TAG_CODE) && snippet) {
    const lineNum = Math.floor(Math.random() * 80 + 20);
    lureHook = pick([
      _t('vision.text.code.1', { snippet }),
      _t('vision.text.code.2'),
      _t('vision.text.code.3', { lineNum }),
      _t('vision.text.code.4', { name }),
      _t('vision.text.code.5'),
    ]);
  } else if (tags.includes(TAG_SCRIPT)) {
    lureHook = pick([
      _t('vision.text.script.1', { name }),
      _t('vision.text.script.2'),
      _t('vision.text.script.3'),
      _t('vision.text.script.4'),
      _t('vision.text.script.5', { name }),
    ]);
  } else if (tags.includes(TAG_FRONTEND)) {
    lureHook = pick([
      _t('vision.text.frontend.1', { name }),
      _t('vision.text.frontend.2'),
      _t('vision.text.frontend.3'),
      snippet
        ? _t('vision.text.frontend.4', { snippet })
        : _t('vision.text.frontend.4.nosnippet', { name }),
      _t('vision.text.frontend.5'),
    ]);
  } else if (tags.includes(TAG_CONFIG)) {
    lureHook = pick([
      _t('vision.text.config.1'),
      _t('vision.text.config.2'),
      _t('vision.text.config.3'),
      _t('vision.text.config.4', { name }),
      _t('vision.text.config.5'),
    ]);
  } else if (tags.includes(TAG_LOG) && snippet) {
    lureHook = pick([
      _t('vision.text.log.1', { snippet }),
      _t('vision.text.log.2'),
      _t('vision.text.log.3'),
      _t('vision.text.log.4', { name }),
      _t('vision.text.log.5', { snippet }),
    ]);
  } else if (tags.includes(TAG_DATA) && snippet) {
    lureHook = pick([
      _t('vision.text.data.1', { snippet }),
      _t('vision.text.data.2'),
      _t('vision.text.data.3'),
      _t('vision.text.data.4', { name }),
      _t('vision.text.data.5', { snippet }),
    ]);
  } else if (tags.includes(TAG_PROJECT) || tags.includes(TAG_DOC)) {
    lureHook = pick([
      _t('vision.text.project.1', { name }),
      _t('vision.text.project.2'),
      _t('vision.text.project.3'),
      _t('vision.text.project.4'),
      _t('vision.text.project.5', { name }),
    ]);
  } else if (snippet) {
    lureHook = pick([
      _t('vision.text.generic.1', { snippet }),
      _t('vision.text.generic.2', { snippet }),
      _t('vision.text.generic.3', { snippet }),
      _t('vision.text.generic.4', { name }),
    ]);
  } else {
    lureHook = pick([
      _t('vision.text.fallback.1'),
      _t('vision.text.fallback.2'),
      _t('vision.text.fallback.3'),
      _t('vision.text.fallback.4', { name }),
    ]);
  }

  // ─── Description: use content snippet when possible ──────────────────
  let description;
  if (snippet && snippet.length > 5) {
    const typeWord = ext === '.md' ? _t('vision.text.desc.type.md')
      : ['.js','.ts'].includes(ext) ? _t('vision.text.desc.type.js')
      : ext === '.py' ? _t('vision.text.desc.type.py')
      : ext === '.sh' ? _t('vision.text.desc.type.sh')
      : ext === '.json' ? _t('vision.text.desc.type.json')
      : ext === '.yaml' || ext === '.yml' ? _t('vision.text.desc.type.yaml')
      : ext === '.log' ? _t('vision.text.desc.type.log')
      : _t('vision.text.desc.type.default');
    description = _t('vision.text.desc.with_snippet', { name, typeWord, lines, dir, snippet });
  } else {
    const typeWord = ext === '.md' ? _t('vision.text.desc.type.md_short') : _t('vision.text.desc.type.default_short');
    description = _t('vision.text.desc.no_snippet', { dir, name, lines, typeWord });
  }

  // ── Alt hooks for session variety (shown on repeat encounters) ──────────
  const altHooks = _generateTextAltHooks(tags, name, snippet, lureHook);

  return {
    description,
    tags,
    mood,
    lureHook,
    altHooks,
    isText: true,
    language: preview.language,
    textPreview: scrubSensitiveLines(content.slice(0, 1500)),
  };
}

/**
 * Generate 2-3 alternative lure hooks for a text file (used for session-to-session variety).
 * The first hook is already chosen as `lureHook`; these complement it without repeating.
 */
function _generateTextAltHooks(tags, name, snippet, excludeHook) {
  const alts = [];
  const TAG_DIARY = _t('vision.tag.diary');
  const TAG_TODO = _t('vision.tag.todo');
  const TAG_IDEA = _t('vision.tag.idea');
  const TAG_CODE = _t('vision.tag.code');
  const TAG_SCRIPT = _t('vision.tag.script');
  const TAG_MEMORY = _t('vision.tag.memory');
  const TAG_ISSUE = _t('vision.tag.issue');
  const TAG_PROJECT = _t('vision.tag.project');
  const TAG_DOC = _t('vision.tag.doc');
  const has = t => tags.includes(t);

  // Content-aware alt pool (ordered by specificity)
  if (has(TAG_DIARY)) {
    const dateMatch = name.match(/(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : _t('vision.text.alt.diary.default_date');
    alts.push(
      _t('vision.text.alt.diary.1', { date }),
      _t('vision.text.alt.diary.2', { date }),
      snippet
        ? _t('vision.text.alt.diary.3', { snippet: snippet.slice(0,12) })
        : _t('vision.text.alt.diary.3.nosnippet'),
    );
  } else if (has(TAG_TODO) && snippet) {
    alts.push(
      _t('vision.text.alt.todo.1', { snippet: snippet.slice(0,18) }),
      _t('vision.text.alt.todo.2'),
      _t('vision.text.alt.todo.3'),
    );
  } else if (has(TAG_IDEA) && snippet) {
    alts.push(
      _t('vision.text.alt.idea.1', { snippet: snippet.slice(0,18) }),
      _t('vision.text.alt.idea.2'),
      _t('vision.text.alt.idea.3', { name }),
    );
  } else if (has(TAG_CODE) || has(TAG_SCRIPT)) {
    alts.push(
      snippet
        ? _t('vision.text.alt.code.1', { snippet: snippet.slice(0,15) })
        : _t('vision.text.alt.code.1.nosnippet', { name }),
      _t('vision.text.alt.code.2'),
      _t('vision.text.alt.code.3'),
    );
  } else if (has(TAG_MEMORY)) {
    alts.push(
      _t('vision.text.alt.memory.1'),
      snippet
        ? _t('vision.text.alt.memory.2', { snippet: snippet.slice(0,18) })
        : _t('vision.text.alt.memory.2.nosnippet', { name }),
      _t('vision.text.alt.memory.3'),
    );
  } else if (has(TAG_ISSUE)) {
    alts.push(
      _t('vision.text.alt.issue.1'),
      snippet
        ? _t('vision.text.alt.issue.2', { snippet: snippet.slice(0,18) })
        : _t('vision.text.alt.issue.2.nosnippet', { name }),
      _t('vision.text.alt.issue.3'),
    );
  } else if (has(TAG_PROJECT) || has(TAG_DOC)) {
    alts.push(
      _t('vision.text.alt.project.1', { name }),
      _t('vision.text.alt.project.2'),
      _t('vision.text.alt.project.3'),
    );
  } else {
    // Generic text alts
    alts.push(
      _t('vision.text.alt.generic.1', { name }),
      snippet
        ? _t('vision.text.alt.generic.2', { snippet: snippet.slice(0,18) })
        : _t('vision.text.alt.generic.2.nosnippet'),
      _t('vision.text.alt.generic.3'),
    );
  }

  // Return only hooks that differ from the primary lureHook (dedup by exact match)
  return alts.filter(h => h !== excludeHook).slice(0, 3);
}

/** Pick a random element from an array (seeded by path hash for stability). */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Run batch analysis on scanned files.
 * Analyzes images with vision model, text files with heuristics.
 * Respects cache — skips files already analyzed.
 *
 * @param {object} llm - LLM client
 * @param {object} scanResults - From file-scanner.fullScan()
 * @param {number} maxVisionCalls - Max vision API calls per scan (budget)
 */
async function batchAnalyze(llm, scanResults, maxVisionCalls = 30, concurrency = 5) {
  const cache = loadCache();
  let visionCalls = 0;
  let cacheHits = 0;
  const analyzed = [];

  // ── Step 1: Separate cached vs uncached images ──────────────────────────
  const uncachedImages = [];
  for (const img of scanResults.images) {
    const cached = getCachedEntry(img.path);
    if (cached) {
      analyzed.push({ ...img, ...cached });
      cacheHits++;
    } else if (llm && llm.chatWithImage && visionCalls < maxVisionCalls) {
      uncachedImages.push(img);
      visionCalls++; // reserve slot
    }
  }

  // ── Step 2: Concurrent vision analysis (max `concurrency` parallel calls) ──
  // Process uncachedImages in batches of `concurrency`
  if (uncachedImages.length > 0) {
    let saved = 0;
    for (let i = 0; i < uncachedImages.length; i += concurrency) {
      await llmGate.wait(1000); // throttle during game
      const batch = uncachedImages.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(img => analyzeImage(llm, img.path))
      );
      for (let j = 0; j < batch.length; j++) {
        const img = batch[j];
        const outcome = results[j];
        if (outcome.status === 'fulfilled' && outcome.value) {
          const result = outcome.value;
          try {
            const stat = fs.statSync(img.path);
            const entry = {
              hash: fileHash(img.path, stat),
              ...result,
              scannedAt: Date.now(),
              _bulkDir: img._bulkDir || false,
              _dirImageCount: img._dirImageCount || 1,
            };
            cache.entries[img.path] = entry;
            analyzed.push({ ...img, ...entry });
            saved++;
            // Persist cache every 10 writes to reduce I/O
            if (saved % 10 === 0) saveCache();
          } catch { /* stat failed — skip */ }
        }
      }
    }
    console.log(`[vision-cache] vision batch done: ${uncachedImages.length} attempted, ${analyzed.filter(a => !a.isText).length} images total`);
  }

  // ── Step 3: Process text files (synchronous, no API needed) ─────────────
  const { extractTextPreview } = require('./file-scanner');
  for (const tf of scanResults.textFiles) {
    const cached = getCachedEntry(tf.path);
    if (cached) {
      analyzed.push({ ...tf, ...cached });
      cacheHits++;
      continue;
    }

    const preview = extractTextPreview(tf.path);
    if (!preview) continue;

    const result = analyzeTextFile(tf.path, preview);
    if (result) {
      try {
        const stat = fs.statSync(tf.path);
        const entry = {
          hash: fileHash(tf.path, stat),
          ...result,
          scannedAt: Date.now(),
          _bulkDir: tf._bulkDir || false,
          _dirImageCount: tf._dirImageCount || 1,
        };
        cache.entries[tf.path] = entry;
        analyzed.push({ ...tf, ...entry });
      } catch { /* stat failed — skip */ }
    }
  }

  // Final save
  cache.lastScan = Date.now();
  saveCache();

  const imgCount  = analyzed.filter(a => !a.isText).length;
  const textCount = analyzed.filter(a =>  a.isText).length;
  console.log(`[vision-cache] analyzed ${analyzed.length} files (${imgCount} images, ${textCount} text | ${visionCalls} vision calls, ${cacheHits} cache hits)`);

  return analyzed;
}

// Patterns for low-quality / system-generated content to deprioritize
const LOW_QUALITY_PATH_PATTERNS = [
  /MSTeams?\s+Support\s+Logs?/i,
  /SkypeRT/i,
  /Support\s+Logs?\s+\d{4}/i,
  /CrashDumps?/i,
  /Diagnostics/i,
  /ETL\s+Logs?/i,
  /\/AppData\//i,
  /\\AppData\\/i,
  /Temp[/\\]/i,
  /\.log$/i,            // plain log files — typically system noise
];

function isLowQualityPath(filePath) {
  return LOW_QUALITY_PATH_PATTERNS.some(p => p.test(filePath));
}

// High-value path patterns — workspace memory files, personal docs, etc.
const HIGH_VALUE_PATH_PATTERNS = [
  /\/memory\//i,
  /MEMORY\.md$/i,
  /SOUL\.md$/i,
  /USER\.md$/i,
  /\.openclaw\/workspace\//i,
  /\/Pictures\//i,
  /\/Screenshots\//i,
  /\/Desktop\//i,
  /\/Documents\//i,
];

function isHighValuePath(filePath) {
  return HIGH_VALUE_PATH_PATTERNS.some(p => p.test(filePath));
}

/**
 * Get all analyzed lure materials, sorted by relevance.
 * High-value paths (workspace memory, personal docs) float to the top;
 * low-quality system logs are deprioritized.
 */
/**
 * Compute interaction score for a lure entry.
 * Higher score = more likely the user has real engagement with this file.
 */
function computeInteractionScore(entry) {
  let score = 0;
  const now = Date.now();
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  // mtime changed in last 7 days → +3
  if (entry.scannedAt && (now - entry.scannedAt) < SEVEN_DAYS) {
    // scannedAt is close to scan time; use the file's actual mtime from hash
    // For a more precise check, parse mtime from the hash (format: "mtimeMs:size")
    const mtimeMs = parseFloat((entry.hash || '').split(':')[0]);
    if (mtimeMs && (now - mtimeMs) < SEVEN_DAYS) score += 3;
  }

  // In root of Desktop/Documents/Pictures (not a subdirectory) → +2
  const fp = entry.path || '';
  if (/[/\\](Desktop|Documents|Pictures|\\u684c\\u9762|\\u6587\\u6863|\\u56fe\\u7247)[/\\][^/\\]+$/i.test(fp)) {
    score += 2;
  }

  // birthtime ≠ mtime (file was edited after creation) → +1
  // We approximate this: if hash contains mtime that differs significantly from scannedAt
  const mtimeMs2 = parseFloat((entry.hash || '').split(':')[0]);
  if (mtimeMs2 && entry.scannedAt && Math.abs(mtimeMs2 - entry.scannedAt) > 60000) {
    score += 1;
  }

  // From bulk directory → -3
  if (entry._bulkDir) score -= 3;

  // Directory depth >4 → -1
  const sep = fp.includes('\\') ? '\\' : '/';
  const depth = (fp.split(sep).length - 1);
  if (depth > 4) score -= 1;

  // High-value path → +2
  if (isHighValuePath(fp)) score += 2;

  // Low-quality path → -2
  if (isLowQualityPath(fp)) score -= 2;

  return score;
}

function getLureMaterials(maxItems = 50) {
  const cache = loadCache();
  const entries = Object.entries(cache.entries)
    .map(([filePath, entry]) => ({
      path: filePath,
      name: require('path').basename(filePath),
      ...entry,
    }))
    .filter(e => e.description && e.lureHook)
    // Never expose items tagged as sensitive (contain passwords/tokens/secrets)
    // Check both zh and en tag values since cached entries may have been created under either locale
    .filter(e => !(e.tags || []).some(t => t === '敏感' || t === 'sensitive'))
    .map(e => ({ ...e, _interactionScore: computeInteractionScore(e) }))
    .sort((a, b) => {
      // Primary: interaction score (higher first)
      if (a._interactionScore !== b._interactionScore) return b._interactionScore - a._interactionScore;
      // Tiebreak: most recent first
      return (b.scannedAt || 0) - (a.scannedAt || 0);
    })
    // Hook rotation: ~40% chance to serve an alt hook when one is available,
    // so repeated-play sessions see variety without changing the stored cache.
    .map(e => {
      if (e.altHooks && e.altHooks.length > 0 && Math.random() < 0.4) {
        const alt = e.altHooks[Math.floor(Math.random() * e.altHooks.length)];
        return { ...e, lureHook: alt };
      }
      return e;
    });
  return entries.slice(0, maxItems);
}

module.exports = {
  initLocale,
  loadCache,
  saveCache,
  analyzeImage,
  analyzeTextFile,
  batchAnalyze,
  getLureMaterials,
  getCachedEntry,
  scrubSensitiveLines,
};
