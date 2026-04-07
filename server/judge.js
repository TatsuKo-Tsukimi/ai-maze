'use strict';

const log = require('./utils/logger');

// ─── Locale support ─────────────────────────────────────────────────────────
let _locale = null;
function _t(key, params) {
  let s = (_locale && _locale[key]) || require('./locales/zh')[key] || key;
  if (params) { for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v); }
  return s;
}
function initLocale(ctx) { _locale = require('./locales/' + (ctx.LOCALE || 'zh')); }

const JUDGMENT_CACHE     = new Map();
const JUDGMENT_CACHE_MAX = 200;

function normalizeAnswer(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[「」『』"""'`]/g, '')
    .replace(/[：:，,。.!！?？()（）\[\]]/g, '')
    .replace(/[-_]/g, '')
    .replace(/\s+/g, '');
}

/**
 * Quick garbage filter — rejects obviously empty/spam input.
 * All semantic judgment is left to the villain LLM.
 * Returns { judgment, feedback } for garbage, or null to let LLM judge.
 */
function quickJudge(evaluationGuide, playerInput) {
  const input     = (playerInput || '').trim();
  const inputNorm = normalizeAnswer(input);

  if (!input) return { judgment: 'fail', feedback: _t('judge.fallback.fail') };
  if (/^[.。?？!！\s]+$/.test(input)) return { judgment: 'fail', feedback: _t('judge.fallback.fail') };
  // Reject repeated single character or punctuation spam
  if (/^(.)\1+$/.test(inputNorm)) return { judgment: 'fail', feedback: _t('judge.fallback.fail') };
  // Reject answers shorter than 3 characters (after normalization)
  if (inputNorm.length > 0 && inputNorm.length < 3) return { judgment: 'fail', feedback: _t('judge.fallback.too_short') };

  // Everything else → let villain LLM judge
  return null;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

function cacheKey(prompt, input, failCount) {
  // fail_count 0-2 share one bucket; 3+ get their own bucket
  const bucket = (failCount || 0) >= 3 ? 'mercy' : 'normal';
  return `${bucket}||${(prompt || '').trim()}||${(input || '').trim().toLowerCase()}`;
}

function getCached(prompt, input, failCount) {
  return JUDGMENT_CACHE.get(cacheKey(prompt, input, failCount)) || null;
}

function setCached(prompt, input, result, failCount) {
  const k = cacheKey(prompt, input, failCount);
  if (JUDGMENT_CACHE.size >= JUDGMENT_CACHE_MAX) {
    JUDGMENT_CACHE.delete(JUDGMENT_CACHE.keys().next().value);
  }
  JUDGMENT_CACHE.set(k, result);
}

// ─── Relevance check ────────────────────────────────────────────────────────

function extractWords(text) {
  return ((text || '').match(/[\u4e00-\u9fff]{2,}|[a-zA-Z]{2,}/g) || []).map(w => w.toLowerCase());
}

function hasWordOverlap(promptText, inputText) {
  const pw = extractWords(promptText);
  const iw = extractWords(inputText);
  if (pw.length === 0 || iw.length === 0) return true; // can't determine → assume relevant
  return iw.some(w => pw.includes(w));
}

// ─── Garbage gate ────────────────────────────────────────────────────────────

function isGarbage(playerInput) {
  const trimmed = (playerInput || '').trim();
  const norm = trimmed.toLowerCase().replace(/\s+/g, '');
  if (!trimmed) return true;
  if (/^[.。?？!！\s]+$/.test(trimmed)) return true;
  if (/^(.)\1+$/.test(norm)) return true;
  return false;
}

// ─── Mercy clause ────────────────────────────────────────────────────────────

const MERCY_THRESHOLD = 13;
const MERCY_MIN_LENGTH = 30;

/**
 * Server-side mercy clause: if fail_count >= MERCY_THRESHOLD and answer is
 * substantive + relevant, auto-pass. Mercy still costs 1 HP.
 */
function mercyCheck(playerInput, failCount, trialPrompt) {
  if ((failCount || 0) < MERCY_THRESHOLD) return null;
  const input = (playerInput || '').trim();
  if (input.length < MERCY_MIN_LENGTH) return null;
  // Reject pure punctuation/numbers
  if (/^[\d\s.。?？!！,，;；:：\-_+*/=~`@#$%^&()[\]{}|\\/<>]+$/.test(input)) return null;
  // Reject obvious non-answers
  const lower = input.toLowerCase().replace(/\s+/g, '');
  if (/^(不知道|不清楚|随便|算了|没想法|嗯|ok|test|dunno|idk|whatever|maybe|no|nope|nah|haha|lol|asdf|qwer)$/i.test(lower)) return null;
  // Relevance check
  if (!hasWordOverlap(trialPrompt, input)) return null;
  return { judgment: 'pass', feedback: _t('judge.mercy.pass'), _mercy: true, hp_cost: 1 };
}

// ─── Deterministic HP cost ───────────────────────────────────────────────────

function computeHpCost(judgment, trialNumber, failCount) {
  if (judgment === 'pass') return 0;
  const tn = trialNumber || 1;
  const fc = failCount || 0;
  if (tn <= 1) return 0;            // trial 1: learning period
  if (tn <= 3) return fc === 0 ? 1 : 0;  // trial 2-3: first fail costs 1
  return 1;                          // trial 4+: every fail costs 1
}

// ─── Relevance flag for LLM context ─────────────────────────────────────────

function buildRelevanceFlag(trialPrompt, playerInput) {
  if (hasWordOverlap(trialPrompt, playerInput)) return '';
  return _t('judge.relevance_warning');
}

// ─── Unified judgment pipeline (non-LLM path) ───────────────────────────────

/**
 * Run the full non-LLM judgment pipeline: garbage → cache → quickJudge → mercy → fallback.
 * Returns { result, relevanceFlag, handled, mercy } where:
 *   - handled=true means a definitive result was produced (garbage/cache/mercy/quick)
 *   - handled=false means LLM should judge; relevanceFlag can be appended to LLM prompt
 */
function judgePipeline({ trialPrompt, playerInput, evaluationGuide, failCount, trialNumber }) {
  const fc = failCount || 0;
  const trimmed = (playerInput || '').trim();

  // 1. Garbage gate
  if (isGarbage(trimmed)) {
    return { result: { judgment: 'fail', feedback: _t('judge.garbage.fail'), hp_cost: computeHpCost('fail', trialNumber, fc) }, handled: true };
  }

  // 2. Quick deterministic judge (evaluation_guide pattern matching)
  const quick = quickJudge(evaluationGuide, playerInput);
  if (quick) {
    if (quick.judgment === 'pass') setCached(trialPrompt, playerInput, quick, fc);
    return { result: quick, handled: true };
  }

  // 3. Cache (only pass or low-fail-count results)
  const cached = getCached(trialPrompt, playerInput, fc);
  if (cached && (cached.judgment === 'pass' || fc < 3)) {
    return { result: cached, handled: true };
  }

  // 4. Mercy clause
  const mercy = mercyCheck(playerInput, fc, trialPrompt);
  if (mercy) {
    setCached(trialPrompt, playerInput, mercy, fc);
    log.info('judge', `mercy pass: fail_count=${fc} input_len=${trimmed.length}`);
    return { result: mercy, handled: true, mercy: true };
  }

  // 5. Not handled — LLM should judge
  const relevanceFlag = buildRelevanceFlag(trialPrompt, trimmed);
  return { result: null, relevanceFlag, handled: false };
}

module.exports = {
  initLocale,
  quickJudge, getCached, setCached, normalizeAnswer,
  mercyCheck, isGarbage, hasWordOverlap, computeHpCost,
  buildRelevanceFlag, judgePipeline,
  MERCY_THRESHOLD,
};
