'use strict';

// ─── ACT-R Bayesian Activation Engine ──────────────────────────────────────
// Computes memory activation scores using a simplified ACT-R cognitive model.
// Pure JavaScript math — zero LLM calls, zero external dependencies.
//
// Formula:  A(i) = B(i) + S(i) + ε
//   B(i) = ln(Σ t_j^(-d))           base-level activation (recency + frequency)
//   S(i) = Σ W_k * cooccurrence(k,i) spreading activation from context
//   ε    = σ * logistic_noise()       exploration noise

const fs   = require('fs');
const path = require('path');

// ─── Tunable Parameters ────────────────────────────────────────────────────

const DEFAULTS = {
  DECAY_D:                  0.5,    // ACT-R standard decay exponent
  MAX_TIMESTAMPS:           20,     // max stored access timestamps per item
  PRIOR_WEIGHT:             2.0,    // weight of LLM importance prior for cold-start
  NOISE_SIGMA:              0.25,   // noise standard deviation
  RETIRE_THRESHOLD:         -2.0,   // activation below which items are retired
  SURFACE_THRESHOLD:        0.0,    // minimum activation to be retrieval-eligible
  CONSOLIDATION_THRESHOLD:  2.0,    // episode activation needed for consolidation
  MIN_CALL_GAP:             3,      // minimum globalCallCounter gap between reuses
  CACHE_TTL_MS:             60000,  // how long a cached activation score is valid
  LOG_ROTATE_BYTES:         1048576, // 1MB log rotation threshold

  // Spreading activation weights
  W_PLAYER_TAG:  0.8,
  W_THEME:       1.0,
  W_SOFT_SPOT:   1.2,
  W_HIT:         1.5,
};

let _config = { ...DEFAULTS };

// ─── Config Loading ────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, '..', 'data', 'activation-config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const overrides = JSON.parse(raw);
      for (const key of Object.keys(DEFAULTS)) {
        if (typeof overrides[key] === 'number') {
          _config[key] = overrides[key];
        }
      }
    }
  } catch { /* use defaults */ }
}

loadConfig();

function getConfig() { return { ..._config }; }

// ─── Activation Data Structure ─────────────────────────────────────────────

function createActivation(importancePrior = 0.5) {
  return {
    accessTimestamps: [],    // epochMs[], most recent last, capped at MAX_TIMESTAMPS
    foldedActivation: 0,     // folded base from timestamps older than the kept ones
    foldedCount: 0,          // how many timestamps were folded
    contextTags: {},         // tag → access co-occurrence count
    importancePrior: Math.max(0, Math.min(1, importancePrior)),
    cachedScore: null,
    cachedAt: 0,
  };
}

// ─── Base-Level Activation B(i) ────────────────────────────────────────────
// B(i) = ln(Σ t_j^(-d))
// t_j = minutes since the j-th access (floored at 1 to avoid division by zero)

function _baseLevelActivation(act, nowMs) {
  const d = _config.DECAY_D;
  let sum = 0;

  // Contribution from stored timestamps
  for (const ts of act.accessTimestamps) {
    const minutesAgo = Math.max(1, (nowMs - ts) / 60000);
    sum += Math.pow(minutesAgo, -d);
  }

  // Contribution from folded (older) timestamps
  if (act.foldedActivation > 0) {
    sum += act.foldedActivation;
  }

  if (sum <= 0) return -Infinity;
  return Math.log(sum);
}

// ─── Spreading Activation S(i) ─────────────────────────────────────────────
// Two sources:
//   1. Co-occurrence: how often this item was accessed alongside context feature k
//   2. Intrinsic tags: does the item's OWN tags/theme match the context?
// This ensures even never-accessed items can benefit from context matching.

function _spreadingActivation(act, contextFeatures, item) {
  if (!contextFeatures) return 0;

  const totalAccesses = Math.max(1,
    act.accessTimestamps.length + act.foldedCount
  );
  let sum = 0;

  // ── Co-occurrence based (from access history) ──

  // Player behavior tags
  const tags = contextFeatures.behaviorTags || [];
  for (const tag of tags) {
    const cooc = act.contextTags[tag] || 0;
    sum += _config.W_PLAYER_TAG * (cooc / totalAccesses);
  }

  // Theme co-occurrence
  if (contextFeatures.activeTheme && act.contextTags[`theme:${contextFeatures.activeTheme}`]) {
    const cooc = act.contextTags[`theme:${contextFeatures.activeTheme}`];
    sum += _config.W_THEME * (cooc / totalAccesses);
  }

  // Soft spot topics
  const spots = contextFeatures.softSpotTopics || [];
  for (const topic of spots) {
    const cooc = act.contextTags[`spot:${topic}`] || 0;
    sum += _config.W_SOFT_SPOT * (cooc / totalAccesses);
  }

  // Hit bonus
  if (contextFeatures.hitBonus && act.contextTags._hit) {
    sum += _config.W_HIT * Math.min(1, act.contextTags._hit / totalAccesses);
  }

  // ── Intrinsic tag matching (works even for never-accessed items) ──
  if (item) {
    // Theme: item's own _theme or tags match context activeTheme
    if (contextFeatures.activeTheme) {
      const theme = contextFeatures.activeTheme;
      const hasTheme = item._theme === theme ||
        (Array.isArray(item.tags) && item.tags.some(t =>
          t === theme || t === `theme:${theme}` || t.includes(theme)
        ));
      if (hasTheme) {
        sum += _config.W_THEME; // full weight: for novel items this is the only signal
      }
    }

    // Soft spot: check if item tags overlap with soft spot topics
    if (spots.length > 0 && Array.isArray(item.tags)) {
      for (const topic of spots) {
        if (item.tags.some(t => t.includes(topic))) {
          sum += _config.W_SOFT_SPOT * 0.3;
        }
      }
    }
  }

  return sum;
}

// ─── Noise ε ───────────────────────────────────────────────────────────────
// Logistic noise: σ * ln(u / (1 - u)), u ~ Uniform(0.001, 0.999)

function _logisticNoise() {
  const u = 0.001 + Math.random() * 0.998;
  return _config.NOISE_SIGMA * Math.log(u / (1 - u));
}

// ─── Core: Compute Activation ──────────────────────────────────────────────

function computeActivation(item, contextFeatures, nowMs) {
  const act = item._activation;
  if (!act) return -Infinity;

  nowMs = nowMs || Date.now();

  // Use cached score if still valid
  if (act.cachedScore !== null && (nowMs - act.cachedAt) < _config.CACHE_TTL_MS) {
    return act.cachedScore + _logisticNoise();
  }

  // Cold-start: no access history yet — use prior
  const hasHistory = act.accessTimestamps.length > 0 || act.foldedCount > 0;
  let base;
  if (!hasHistory) {
    base = act.importancePrior * _config.PRIOR_WEIGHT;
  } else {
    base = _baseLevelActivation(act, nowMs);
  }

  const spread = _spreadingActivation(act, contextFeatures, item);
  const score = base + spread;

  // Cache the deterministic part (noise added fresh each call)
  act.cachedScore = score;
  act.cachedAt = nowMs;

  return score + _logisticNoise();
}

// ─── Record Access ─────────────────────────────────────────────────────────

function recordAccess(item, contextFeatures, nowMs) {
  if (!item._activation) item._activation = createActivation();
  const act = item._activation;
  nowMs = nowMs || Date.now();

  // Append timestamp
  act.accessTimestamps.push(nowMs);

  // Fold oldest timestamps if over limit
  while (act.accessTimestamps.length > _config.MAX_TIMESTAMPS) {
    const oldest = act.accessTimestamps.shift();
    // Fold: contribute to foldedActivation using current time reference
    const minutesAgo = Math.max(1, (nowMs - oldest) / 60000);
    act.foldedActivation += Math.pow(minutesAgo, -_config.DECAY_D);
    act.foldedCount++;
  }

  // Update co-occurrence tags
  if (contextFeatures) {
    const tags = contextFeatures.behaviorTags || [];
    for (const tag of tags) {
      act.contextTags[tag] = (act.contextTags[tag] || 0) + 1;
    }
    if (contextFeatures.activeTheme) {
      const key = `theme:${contextFeatures.activeTheme}`;
      act.contextTags[key] = (act.contextTags[key] || 0) + 1;
    }
    const spots = contextFeatures.softSpotTopics || [];
    for (const topic of spots) {
      const key = `spot:${topic}`;
      act.contextTags[key] = (act.contextTags[key] || 0) + 1;
    }
  }

  // Invalidate cache
  act.cachedScore = null;
  act.cachedAt = 0;
}

// Record a hit (trial hit feedback) — increments the _hit co-occurrence tag
function recordHitSignal(item) {
  if (!item._activation) return;
  item._activation.contextTags._hit = (item._activation.contextTags._hit || 0) + 1;
  item._activation.cachedScore = null;
}

// ─── Rank by Activation ────────────────────────────────────────────────────

function rankByActivation(items, contextFeatures, limit) {
  const nowMs = Date.now();
  const scored = items.map(item => ({
    item,
    score: computeActivation(item, contextFeatures, nowMs),
  }));
  scored.sort((a, b) => b.score - a.score);
  return limit > 0 ? scored.slice(0, limit).map(s => s.item) : scored.map(s => s.item);
}

// ─── Lifecycle Checks ──────────────────────────────────────────────────────

function shouldRetire(item) {
  const act = item._activation;
  if (!act) return false;
  // Never retire items that have never been accessed — they keep their prior
  const hasHistory = act.accessTimestamps.length > 0 || act.foldedCount > 0;
  if (!hasHistory) return false;
  const score = computeActivation(item, null, Date.now());
  return score < _config.RETIRE_THRESHOLD;
}

function shouldSurface(item) {
  const act = item._activation;
  if (!act) return false;
  const score = computeActivation(item, null, Date.now());
  return score >= _config.SURFACE_THRESHOLD;
}

// ─── Migration Helper ──────────────────────────────────────────────────────
// Synthesize _activation from legacy useCount/hitCount/lastUsedAtCall fields.

function migrateFromLegacy(item, globalCallCounter, estimatedCallIntervalMs) {
  if (item._activation) return; // already migrated

  const useCount = item.useCount || 0;
  const hitCount = item.hitCount || 0;
  const now = Date.now();
  estimatedCallIntervalMs = estimatedCallIntervalMs || 120000; // ~2 min default

  const accessTimestamps = [];
  if (useCount > 0) {
    // Synthesize timestamps: spread uses evenly backwards from now
    const totalSpan = Math.max(60000, useCount * estimatedCallIntervalMs);
    const interval = totalSpan / useCount;
    for (let i = 0; i < Math.min(useCount, _config.MAX_TIMESTAMPS); i++) {
      accessTimestamps.push(now - interval * (useCount - i));
    }
  }

  const foldedCount = Math.max(0, useCount - _config.MAX_TIMESTAMPS);
  let foldedActivation = 0;
  if (foldedCount > 0) {
    // Approximate: assume folded accesses are evenly spread further back
    const interval = estimatedCallIntervalMs;
    const offsetStart = _config.MAX_TIMESTAMPS * interval;
    for (let i = 0; i < foldedCount; i++) {
      const minutesAgo = Math.max(1, (offsetStart + interval * i) / 60000);
      foldedActivation += Math.pow(minutesAgo, -_config.DECAY_D);
    }
  }

  item._activation = {
    accessTimestamps,
    foldedActivation,
    foldedCount,
    contextTags: hitCount > 0 ? { _hit: hitCount } : {},
    importancePrior: hitCount > 0 ? 0.7 : 0.4,
    cachedScore: null,
    cachedAt: 0,
  };
}

// ─── Log Rotation ──────────────────────────────────────────────────────────

function rotateLogIfNeeded(logPath) {
  try {
    if (!fs.existsSync(logPath)) return;
    const stat = fs.statSync(logPath);
    if (stat.size > _config.LOG_ROTATE_BYTES) {
      const backup = logPath + '.1';
      try { fs.unlinkSync(backup); } catch { /* no backup yet */ }
      fs.renameSync(logPath, backup);
    }
  } catch { /* best-effort rotation */ }
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  // Core
  computeActivation,
  recordAccess,
  recordHitSignal,
  rankByActivation,

  // Lifecycle
  shouldRetire,
  shouldSurface,

  // Data structure
  createActivation,
  migrateFromLegacy,

  // Config
  loadConfig,
  getConfig,

  // Utilities
  rotateLogIfNeeded,
};
