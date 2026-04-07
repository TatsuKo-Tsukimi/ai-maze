'use strict';

// ─── LLM Helpers: JSON extraction, LLM calls, fallback logic, external agent ──
const http  = require('http');
const https = require('https');
const { buildSystemPrompt, buildVillainSystemPrompt, formatState, OPENING_LINES } = require('./prompts');
const { quickJudge } = require('./judge');

// ─── Locale support ─────────────────────────────────────────────────────────
let _locale = null;
function _t(key, params) {
  let s = (_locale && _locale[key]) || require('./locales/zh')[key] || key;
  if (params) { for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v); }
  return s;
}
function initLocale(ctx) { _locale = require('./locales/' + (ctx.LOCALE || 'zh')); }

const LEGACY_CARD_TYPES = ['blocker', 'lure', 'drain', 'calm'];
const AGENT_URL = (process.env.AGENT_URL || '').replace(/\/$/, '');

// ─── External Agent ───────────────────────────────────────────────────────────
function callExternalAgent(reactBody) {
  if (!AGENT_URL) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = new URL(AGENT_URL + '/react');
    const payload = JSON.stringify(reactBody);
    const proto = url.protocol === 'https:' ? https : http;
    const req = proto.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { console.warn('[agent] bad JSON from external agent'); resolve(null); }
      });
    });
    req.on('error', (e) => { console.warn('[agent] external agent error:', e.message); resolve(null); });
    req.on('timeout', () => { req.destroy(); console.warn('[agent] external agent timeout'); resolve(null); });
    req.write(payload);
    req.end();
  });
}

// ─── Body reader ──────────────────────────────────────────────────────────────
function readBody(req, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    let body = ''; let len = 0;
    req.on('data', c => { len += c.length; if (len > maxBytes) { req.destroy(); reject(new Error('body too large')); } else body += c; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ─── JSON extraction helpers ─────────────────────────────────────────────────
function cleanLLMJson(text) {
  return text
    .replace(/```(?:json)?\n?/g, '')
    .replace(/[\u201c\u201d\u300c\u300d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

function extractJSONWithKey(text, requiredKey) {
  const cleaned = cleanLLMJson(text);

  try { const p = JSON.parse(cleaned); if (p[requiredKey]) return p; } catch {}

  let depth = 0, start = -1, end = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (cleaned[i] === '}') { depth--; if (depth === 0 && start >= 0) { end = i; break; } }
  }
  if (start >= 0 && end > start) {
    const slice = cleaned.slice(start, end + 1);
    try { const p = JSON.parse(slice); if (p[requiredKey]) return p; } catch {}
  }

  const re = new RegExp(`\\{[^{}]*"${requiredKey}"[^{}]*\\}`);
  const m = cleaned.match(re);
  if (m) { try { return JSON.parse(m[0]); } catch {} }

  if (requiredKey === 'prompt') {
    const getVal = (key) => {
      const r = new RegExp(`"${key}"\\s*:\\s*"([^]*?)"(?:\\s*[,}])`);
      const match = cleaned.match(r);
      return match ? match[1].trim() : '';
    };
    const prompt = getVal('prompt');
    const guide  = getVal('evaluation_guide');
    const hint   = getVal('hint');
    if (prompt) return { prompt, evaluation_guide: guide || _t('judge.eval_guide_default'), hint: hint || '' };
  }

  return null;
}

function extractJSON(text) {
  return extractJSONWithKey(text, 'card_type');
}

// ─── LLM call wrappers ───────────────────────────────────────────────────────
// These accept LLM client as parameter (injected from server.js boot)

// Race an LLM call against a timeout — returns null on timeout
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`LLM timeout (${ms}ms)`)), ms)),
  ]);
}

const LLM_TIMEOUT_CARD = 8000;    // 8s for card generation
const LLM_TIMEOUT_VILLAIN = 10000; // 10s for villain speech (was 6s — too tight, caused >70% fallback after step 6)
const LLM_TIMEOUT_JUDGE = 10000;   // 10s for trial judging

function callLLM(LLM, gameState, role) {
  if (!LLM) throw new Error('No LLM configured');
  return withTimeout(
    LLM.chat(buildSystemPrompt(role), [{ role: 'user', content: formatState(gameState) }], { max_tokens: 120, temperature: 0.85, fast: true })
      .then(raw => {
        const result = extractJSON(raw);
        if (!result) throw new Error('Bad LLM response: ' + raw.slice(0, 200));
        return result;
      }),
    LLM_TIMEOUT_CARD
  );
}

function callVillainLLM(LLM, session, userMsg, gameStateHints = {}) {
  if (!LLM) throw new Error('No LLM configured');
  const systemPrompt = buildVillainSystemPrompt(session.personalityCtx);
  const messages = [...session.history, { role: 'user', content: userMsg }];

  // Dynamic generation params based on game state
  const hp = gameStateHints.hp ?? 3;
  const distRaw = gameStateHints.distance_to_exit_raw;
  const isNearExit = distRaw != null && distRaw <= 6;

  // At HP=1: lower temperature = more deliberate/unsettling; near exit: higher = more desperate
  let temperature = 0.92;
  let max_tokens = 80;
  if (hp <= 1) { temperature = 0.78; max_tokens = 60; } // deliberate, precise taunts
  else if (isNearExit) { temperature = 1.05; max_tokens = 65; } // more frantic near escape

  return withTimeout(
    LLM.chat(systemPrompt, messages, { max_tokens, temperature })
      .then(raw => raw.trim()),
    LLM_TIMEOUT_VILLAIN
  );
}

// ─── Fallback Judge ───────────────────────────────────────────────────────────
const DISMISSIVE_PATTERNS = /^(不知道|不清楚|随便|算了|没有|不会|dunno|idk|no|yes|ok|whatever|pass|skip|nope|yep|是|否|对|错|好|嗯|哦|啊|呢|吧|呵呵|haha|lol|test|asdf|aaa|bbb|zzz|xxx|123|\.{1,}|…{1,}|\?{1,}|！{1,}|!{1,})$/i;
const FAIL_FEEDBACKS_COUNT = 8;
function getFailFeedbacks() {
  const arr = [];
  for (let i = 0; i < FAIL_FEEDBACKS_COUNT; i++) arr.push(_t(`judge.fail_feedback.${i}`));
  return arr;
}
const PASS_FEEDBACKS_COUNT = 5;
function getPassFeedbacks() {
  const arr = [];
  for (let i = 0; i < PASS_FEEDBACKS_COUNT; i++) arr.push(_t(`judge.pass_feedback.${i}`));
  return arr;
}

function fallbackJudge(playerInput, trialPrompt, evaluationGuide) {
  const input = (playerInput || '').trim();
  const prompt = (trialPrompt || '').trim();
  const guide = (evaluationGuide || '').trim();
  const failFeedbacks = getFailFeedbacks();
  const failFb = failFeedbacks[Math.floor(Math.random() * failFeedbacks.length)];

  if (!input) return { judgment: 'fail', feedback: _t('judge.empty') };
  if (DISMISSIVE_PATTERNS.test(input)) return { judgment: 'fail', feedback: failFb };
  if (/^(.)\1{3,}$/.test(input)) return { judgment: 'fail', feedback: failFb };

  // ── Non-standard input: emotional/negotiation responses ──────
  const lower = input.toLowerCase();
  // Begging / pleading
  if (/求求|please|放过|让我过|求你|拜托|I beg|let me|mercy/.test(lower)) {
    const begging = [_t('judge.begging.0'), _t('judge.begging.1'), _t('judge.begging.2'), _t('judge.begging.3')];
    return { judgment: 'fail', feedback: begging[Math.floor(Math.random() * begging.length)] };
  }
  // Anger
  if (/不公平|作弊|去你|fuck|shit|damn|bullshit|你妈|操|滚|混蛋/.test(lower)) {
    const angry = [_t('judge.anger.0'), _t('judge.anger.1'), _t('judge.anger.2'), _t('judge.anger.3')];
    return { judgment: 'fail', feedback: angry[Math.floor(Math.random() * angry.length)] };
  }
  // Apology / guilt
  if (/对不起|sorry|我错了|抱歉|I was wrong|原谅/.test(lower)) {
    const apology = [_t('judge.apology.0'), _t('judge.apology.1'), _t('judge.apology.2'), _t('judge.apology.3')];
    return { judgment: 'fail', feedback: apology[Math.floor(Math.random() * apology.length)] };
  }
  // Negotiation
  if (/交易|deal|我给你|我可以|条件|bargain|trade|exchange/.test(lower)) {
    const negotiate = [_t('judge.negotiate.0'), _t('judge.negotiate.1'), _t('judge.negotiate.2'), _t('judge.negotiate.3')];
    return { judgment: 'fail', feedback: negotiate[Math.floor(Math.random() * negotiate.length)] };
  }
  // Flattery
  if (/你真聪明|你赢了|你好厉害|你很强|I give up|投降|认输/.test(lower)) {
    const flatter = [_t('judge.flattery.0'), _t('judge.flattery.1'), _t('judge.flattery.2'), _t('judge.flattery.3')];
    return { judgment: 'fail', feedback: flatter[Math.floor(Math.random() * flatter.length)] };
  }

  const passFeedbacks = getPassFeedbacks();
  const passFb = () => passFeedbacks[Math.floor(Math.random() * passFeedbacks.length)];

  if (guide && /接受/.test(guide)) {
    const qj = quickJudge(guide, input);
    if (qj) return qj;
  }

  if (input.length < 5) return { judgment: 'fail', feedback: failFb };

  if (input.length < 8) {
    const cleanPrompt = prompt.replace(/[？?！!。，,、：:；;""''「」『』（）()\[\]【】\s]/g, '');
    const hasKeyword = cleanPrompt.length >= 2 && input.split('').some((_, i) =>
      i < input.length - 1 && cleanPrompt.includes(input.slice(i, i + 2))
    );
    if (hasKeyword) return { judgment: 'pass', feedback: passFb() };
    return { judgment: 'fail', feedback: failFb };
  }

  const STOP_WORDS = new Set('你我的了吗呢吧是在有和不这那什么为什么如果怎么可以应该一个还是就是或者会要都很'.split(''));
  const cleanPrompt = prompt.replace(/[？?！!。，,、：:；;""''「」『』（）()\[\]【】\s]/g, '');
  const bigrams = [];
  for (let i = 0; i < cleanPrompt.length - 1; i++) {
    const bi = cleanPrompt.slice(i, i + 2);
    if (!STOP_WORDS.has(bi[0]) || !STOP_WORDS.has(bi[1])) bigrams.push(bi);
  }
  const engWords = prompt.match(/[a-zA-Z]{3,}/g) || [];
  const allKeywords = [...bigrams, ...engWords];
  const inputLower = input.toLowerCase();
  const hasRelevance = allKeywords.length > 0 &&
    allKeywords.some(kw => inputLower.includes(kw.toLowerCase()));

  if (hasRelevance) return { judgment: 'pass', feedback: passFb() };

  const hasThought = /[，。！？、]/.test(input) ||
    /也许|因为|所以|但是|虽然|如果|觉得|认为|害怕|选择|相信|承认|一直|从来|意味/.test(input);

  if (input.length >= 15 && hasThought) {
    return Math.random() < 0.8
      ? { judgment: 'pass', feedback: passFb() }
      : { judgment: 'fail', feedback: failFb };
  }

  return Math.random() < 0.5
    ? { judgment: 'pass', feedback: passFb() }
    : { judgment: 'fail', feedback: failFb };
}

// ─── Fallback Cards ───────────────────────────────────────────────────────────
const _recentFallbacks = []; // track recent fallback lines to avoid repetition

const FALLBACK_LINES_COUNT = 24;
function getFallbackLines() {
  const arr = [];
  for (let i = 0; i < FALLBACK_LINES_COUNT; i++) arr.push(_t(`llm.fallback.line.${i}`));
  return arr;
}

function fallbackCard(gs) {
  const recent  = (gs.recent_cards || []).slice(-3);
  const blocked = new Set();
  if (recent.length >= 3 && recent.every(t => t === recent[0])) blocked.add(recent[0]);
  if ((gs.recent_cards || []).slice(-2).every(t => t === 'calm')) blocked.add('calm');
  if (gs.hp <= 1) blocked.add('drain');

  const weights = { blocker: 3, lure: 3, drain: 2, calm: 2 };
  for (const r of recent) { if (weights[r] != null) weights[r] = Math.max(1, weights[r] - 1); }
  const candidates = LEGACY_CARD_TYPES.filter(t => !blocked.has(t));
  const totalWeight = candidates.reduce((s, t) => s + weights[t], 0);
  let roll = Math.random() * totalWeight;
  let card_type = candidates[candidates.length - 1] || 'calm';
  for (const t of candidates) {
    roll -= weights[t];
    if (roll <= 0) { card_type = t; break; }
  }

  let speech;
  if ((gs.steps || 0) <= 1) {
    speech = OPENING_LINES[Math.floor(Math.random() * OPENING_LINES.length)];
  } else {
    // Avoid repeating recent fallback lines
    const fallbackLines = getFallbackLines();
    const available = fallbackLines.filter(l => !_recentFallbacks.includes(l));
    const pool = available.length > 0 ? available : fallbackLines;
    speech = pool[Math.floor(Math.random() * pool.length)];
    _recentFallbacks.push(speech);
    if (_recentFallbacks.length > 6) _recentFallbacks.shift();
  }
  return { card_type, speech_line: speech };
}

module.exports = {
  initLocale,
  AGENT_URL, LEGACY_CARD_TYPES,
  callExternalAgent, readBody,
  cleanLLMJson, extractJSONWithKey, extractJSON,
  callLLM, callVillainLLM,
  fallbackJudge, fallbackCard,
};
