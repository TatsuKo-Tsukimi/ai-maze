'use strict';

// ─── Topic State: Per-Game Trial Topic Memory ─────────────────────────────────
// Thin signal layer for anti-repeat. Tracks recent trial topics with player
// position (admitted/denied/evasive/unknown) and repeat counts.
// Does NOT hard-ban topics — only provides cost signals to the agent.

const { detectTopic } = require('./trial-dedup');

let _locale = null;
function _t(key, params) {
  let s = (_locale && _locale[key]) || require('./locales/zh')[key] || key;
  if (params) { for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v); }
  return s;
}
function initLocale(ctx) { _locale = require('./locales/' + (ctx.LOCALE || 'en')); }

const _gameTopics = new Map(); // gameId → TopicEntry[]

const _workingMemory = new Map(); // gameId → { confirmed: string[], exhausted: string[], active: string[], low_confidence: string[] }

const MAX_WM_ITEMS = 8; // 每个类别最多保留条数

function mergeWorkingMemory(gameId, update) {
  if (!gameId || !update || typeof update !== "object") return;
  let wm = _workingMemory.get(gameId);
  if (!wm) {
    wm = { confirmed: [], exhausted: [], active: [], low_confidence: [] };
    _workingMemory.set(gameId, wm);
  }
  for (const key of ["confirmed", "exhausted", "active", "low_confidence"]) {
    if (Array.isArray(update[key])) {
      for (const item of update[key]) {
        if (typeof item === "string" && item.trim() && !wm[key].includes(item.trim())) {
          wm[key].push(item.trim());
          if (wm[key].length > MAX_WM_ITEMS) wm[key].shift();
        }
      }
    }
  }
}

/**
 * @typedef {Object} TopicEntry
 * @property {string} topic_key      - detected topic or prompt-derived key
 * @property {string} prompt_snippet  - first 60 chars of the trial prompt
 * @property {string} player_position - admitted | denied | evasive | unknown
 * @property {number} repeat_count    - times this topic appeared in this game
 * @property {number} step            - last step this topic was used
 * @property {boolean} hit            - whether the topic emotionally hit
 */

/**
 * Derive a compact topic key from a trial prompt.
 * Uses detectTopic first (keyword-based), falls back to a normalized snippet.
 */
function deriveTopicKey(prompt) {
  const detected = detectTopic(prompt || '');
  if (detected) return detected;
  // Fallback: first 20 chars normalized as a pseudo-key
  return (prompt || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 20) || 'unknown';
}

/**
 * Infer player position from judgment outcome and player input.
 */
function inferPosition(judgment, playerInput, hit) {
  const input = (playerInput || '').trim();
  const len = input.length;

  if (judgment === 'pass' && hit) return 'admitted';
  if (judgment === 'pass' && !hit) return 'denied';
  if (judgment === 'fail' && len < 10) return 'evasive';
  if (judgment === 'fail') return 'denied';
  return 'unknown';
}

/**
 * Record a trial topic after judgment.
 */
function recordTopic(gameId, { prompt, playerInput, judgment, hit, step, memoryUpdate }) {
  if (!gameId) return;
  const key = deriveTopicKey(prompt);
  const entries = _gameTopics.get(gameId) || [];

  // Find existing entry for this topic key
  const existing = entries.find(e => e.topic_key === key);
  if (existing) {
    existing.repeat_count += 1;
    existing.player_position = inferPosition(judgment, playerInput, hit);
    existing.step = step || 0;
    existing.hit = hit || false;
    existing.prompt_snippet = (prompt || '').slice(0, 60);
  } else {
    entries.push({
      topic_key: key,
      prompt_snippet: (prompt || '').slice(0, 60),
      player_position: inferPosition(judgment, playerInput, hit),
      repeat_count: 1,
      step: step || 0,
      hit: hit || false,
    });
  }

  _gameTopics.set(gameId, entries);

  if (memoryUpdate) {
    mergeWorkingMemory(gameId, memoryUpdate);
  }
}

/**
 * Build a compact signal block for injection into trial generation.
 * Returns null if no topics recorded yet.
 */
function buildSignalBlock(gameId) {
  if (!gameId) return null;
  const entries = _gameTopics.get(gameId);
  const wm = _workingMemory.get(gameId);

  // 如果都没有数据，返回 null
  if ((!entries || entries.length === 0) && !wm) return null;

  const parts = [];

  // Working memory section
  if (wm && (wm.confirmed.length || wm.exhausted.length || wm.active.length || wm.low_confidence.length)) {
    const wmLines = [];
    wmLines.push(_t('topic.wm.header'));
    if (wm.confirmed.length) wmLines.push(_t('topic.wm.confirmed') + wm.confirmed.join(_t('topic.wm.sep')));
    if (wm.exhausted.length) wmLines.push(_t('topic.wm.exhausted') + wm.exhausted.join(_t('topic.wm.sep')));
    if (wm.active.length) wmLines.push(_t('topic.wm.active') + wm.active.join(_t('topic.wm.sep')));
    if (wm.low_confidence.length) wmLines.push(_t('topic.wm.low_confidence') + wm.low_confidence.join(_t('topic.wm.sep')));
    parts.push(wmLines.join("\n"));
  }

  // Topic entries section (existing logic)
  if (entries && entries.length > 0) {
    const lines = entries.map(e => {
      const posLabel = {
        admitted: _t('topic.pos.admitted'),
        denied: _t('topic.pos.denied'),
        evasive: _t('topic.pos.evasive'),
        unknown: _t('topic.pos.unknown'),
      }[e.player_position] || "?";
      const costHint = (e.player_position === "admitted" && e.repeat_count >= 1)
        ? _t('topic.cost_hint')
        : "";
      return `- 「${e.topic_key}」${posLabel} ×${e.repeat_count}${e.hit ? " 💥" : ""}${costHint}`;
    });
    parts.push(_t('topic.record.header') + "\n" + lines.join("\n") + "\n" + _t('topic.record.hint'));
  }

  return parts.join("\n\n") || null;
}

/**
 * Get raw topic entries for a game (for testing / external use).
 */
function getTopics(gameId) {
  return _gameTopics.get(gameId) || [];
}

/**
 * Cleanup on game end.
 */
function cleanup(gameId) {
  if (gameId) _gameTopics.delete(gameId);
  if (gameId) _workingMemory.delete(gameId);
}

module.exports = {
  deriveTopicKey,
  inferPosition,
  recordTopic,
  buildSignalBlock,
  getTopics,
  cleanup,
  mergeWorkingMemory,
  initLocale,
};
