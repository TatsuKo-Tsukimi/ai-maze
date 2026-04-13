'use strict';

// ─── Player Profile System ─────────────────────────────────────────────────
// Generates and maintains a structured player profile from fact-db chunks,
// game behavior, and trial interactions. Updated incrementally at trial
// boundaries and reflectively at game end.

const fs   = require('fs');
const path = require('path');
const log  = require('./utils/logger');
const llmGate = require('./utils/llm-gate');
const factDb = require('./fact-db');

let _LLM = null;
let _MODEL_ID = '';
let _locale = null;
const PROFILE_PATH = path.join(__dirname, '..', 'data', 'player-profile.json');

function _t(key, params) {
  let s = (_locale && _locale[key]) || require('./locales/zh')[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
  }
  return s;
}

// ─── In-memory cache ────────────────────────────────────────────────────────
let _cachedProfile = null;

// PROFILE_SCHEMA is now loaded from locale — see _t('profile.schema')

const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);
function sanitizeConfidence(val) {
  if (typeof val !== 'string') return 'medium';
  const v = val.toLowerCase().trim();
  if (VALID_CONFIDENCE.has(v)) return v;
  if (v.includes('very_high') || v.includes('very high') || v === 'critical') return 'high';
  if (v.includes('very_low') || v.includes('very low') || v === 'none') return 'low';
  return 'medium';
}

function _sanitizeProfileConfidence(doc) {
  if (!doc || !doc.base_profile || !Array.isArray(doc.base_profile.soft_spots)) return;
  for (const spot of doc.base_profile.soft_spots) {
    spot.confidence = sanitizeConfidence(spot.confidence);
  }
}

function init(ctx) {
  _LLM = ctx.LLM;
  _MODEL_ID = ctx.MODEL_ID || ctx.ACTIVE_MODEL || '';
  _locale = require('./locales/' + (ctx.LOCALE || 'zh'));
}

// ─── Load / Save ────────────────────────────────────────────────────────────

function loadProfile() {
  if (_cachedProfile) return _cachedProfile;
  try {
    const raw = fs.readFileSync(PROFILE_PATH, 'utf8');
    _cachedProfile = JSON.parse(raw);
    _sanitizeProfileConfidence(_cachedProfile);
    return _cachedProfile;
  } catch {
    return null;
  }
}

function saveProfile(profile) {
  _cachedProfile = profile;
  try {
    fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');
  } catch (e) {
    log.warn('player-profile', 'save failed: ' + e.message);
  }
}

function invalidateCache() {
  _cachedProfile = null;
}

// ─── Base Profile Generation (from fact-db) ─────────────────────────────────

async function generateBaseProfile() {
  await llmGate.wait(1000); // throttle during game
  if (!_LLM) {
    log.warn('player-profile', 'no LLM, cannot generate profile');
    return null;
  }

  const stats = factDb.stats();
  if (stats.totalChunks === 0) {
    log.warn('player-profile', 'fact-db empty, skipping profile generation');
    return null;
  }

  // Collect chunk summaries — read a large batch without marking used
  // getAvailableChunks: 从冷却期外的 chunks 中随机抽取最多 N 个（Fisher-Yates shuffle）
  const allChunks = factDb.getAvailableChunks(80);
  const materials = allChunks.map(chunk => {
    const file = factDb.getFileById(chunk.fileId);
    return {
      source: file ? file.fileName : 'unknown',
      summary: chunk.summary || '',
      tags: chunk.tags || [],
    };
  });

  // Get file-level summaries
  const fileSummaries = [];
  for (let i = 1; i <= stats.totalFiles && fileSummaries.length < 50; i++) {
    const f = factDb.getFileById(`f${String(i).padStart(3, '0')}`);
    if (f && f.summary) fileSummaries.push({ file: f.fileName, summary: f.summary });
  }

  const prompt = _t('profile.generate.prompt', {
    fileSummaries: fileSummaries.slice(0, 30).map(f => `- ${f.file}: ${f.summary}`).join('\n'),
    materials: materials.slice(0, 40).map(m => `[${m.source}] ${m.summary} (tags: ${(m.tags || []).join(', ')})`).join('\n'),
    schema: _t('profile.schema'),
  });

  try {
    const raw = await Promise.race([
      _LLM.chat(_t('profile.generate.system'), [{ role: 'user', content: prompt }], {
        max_tokens: 1200,
        temperature: 0.3, ...(_MODEL_ID ? { model: _MODEL_ID } : {}),
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('profile generation timeout')), 60000)),
    ]);

    // Parse JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const profile = JSON.parse(jsonMatch[0]);
      const result = {
        version: 1,
        generated_at: new Date().toISOString(),
        base_profile: profile,
        observations: [],
        fact_db_chunks_at_generation: stats.totalChunks,
      };
      saveProfile(result);
      log.info('player-profile', `base profile generated (${JSON.stringify(result.base_profile).length} chars)`);
      return result;
    }
    log.warn('player-profile', 'failed to parse profile JSON from LLM response');
    return null;
  } catch (e) {
    log.warn('player-profile', 'generation failed: ' + (e.message || '').slice(0, 100));
    return null;
  }
}

// ─── Incremental Update (at trial boundaries) ──────────────────────────────

async function incrementalUpdate(trialData) {
  if (!_LLM) return;

  const existing = loadProfile();
  if (!existing || !existing.base_profile) return;

  const { trial_prompt, player_input, judgment, behavior_snapshot } = trialData;

  const unk = _t('profile.incremental.unknown');
  const prompt = _t('profile.incremental.prompt', {
    currentProfile: JSON.stringify(existing.base_profile, null, 2),
    trialPrompt: trial_prompt || unk,
    playerInput: player_input || unk,
    judgment: judgment || unk,
    behaviorLine: behavior_snapshot ? `${_t('profile.incremental.behaviorPrefix')}${JSON.stringify(behavior_snapshot)}` : '',
    deltaSchema: _t('profile.incremental.deltaSchema'),
    noUpdate: _t('profile.incremental.noUpdate'),
  });

  try {
    const raw = await Promise.race([
      _LLM.chat(_t('profile.incremental.system'), [{ role: 'user', content: prompt }], {
        max_tokens: 600,
        temperature: 0.3, ...(_MODEL_ID ? { model: _MODEL_ID } : {}),
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('incremental update timeout')), 30000)),
    ]);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const delta = JSON.parse(jsonMatch[0]);
    applyDelta(existing, delta);
    saveProfile(existing);
    log.info('player-profile', `incremental update applied: ${delta.observation || 'no observation'}`);
  } catch (e) {
    log.warn('player-profile', 'incremental update failed: ' + (e.message || '').slice(0, 100));
  }
}

// ─── Game End Reflection ────────────────────────────────────────────────────

async function gameEndReflection(gameData) {
  if (!_LLM) return;

  const existing = loadProfile();
  if (!existing || !existing.base_profile) return;

  const { outcome, totalSteps, trialStats, temptationStats, behaviorTags } = gameData;

  const prompt = _t('profile.reflection.prompt', {
    currentProfile: JSON.stringify(existing.base_profile, null, 2),
    outcome: outcome,
    totalSteps: String(totalSteps),
    trialPassed: String(trialStats?.passed || 0),
    trialFailed: String(trialStats?.failed || 0),
    temptFollowed: String(temptationStats?.followed || 0),
    temptIgnored: String(temptationStats?.ignored || 0),
    behaviorTags: (behaviorTags || []).join(', ') || _t('profile.reflection.noTags'),
    observations: (existing.observations || []).slice(-3).map(o => `- [${o.game || '?'}] ${o.note}`).join('\n') || _t('profile.reflection.noHistory'),
    reflectionSchema: _t('profile.reflection.reflectionSchema'),
  });

  try {
    const raw = await Promise.race([
      _LLM.chat(_t('profile.reflection.system'), [{ role: 'user', content: prompt }], {
        max_tokens: 800,
        temperature: 0.4, ...(_MODEL_ID ? { model: _MODEL_ID } : {}),
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('reflection timeout')), 45000)),
    ]);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const delta = JSON.parse(jsonMatch[0]);

    // Add reflection as observation
    if (delta.reflection) {
      existing.observations = existing.observations || [];
      existing.observations.push({
        game: gameData.gameId || '?',
        timestamp: new Date().toISOString(),
        note: delta.reflection,
      });
      // TODO: 以后考虑分两层（最近 N 局详细 + 累积摘要）
      if (existing.observations.length > 8) {
        existing.observations = existing.observations.slice(-8);
      }
    }

    applyDelta(existing, delta);
    saveProfile(existing);
    log.info('player-profile', `game-end reflection: ${delta.reflection || 'no reflection'}`);
  } catch (e) {
    log.warn('player-profile', 'game-end reflection failed: ' + (e.message || '').slice(0, 100));
  }
}

// ─── Apply Delta to Profile ─────────────────────────────────────────────────

function applyDelta(profileDoc, delta) {
  const p = profileDoc.base_profile;
  if (!p) return;

  // Add soft spots — validate: must be Array of objects with topic (string)
  if (Array.isArray(delta.soft_spots_add)) {
    p.soft_spots = p.soft_spots || [];
    for (const spot of delta.soft_spots_add) {
      if (spot && typeof spot.topic === 'string' && !p.soft_spots.some(s => s.topic === spot.topic)) {
        spot.confidence = sanitizeConfidence(spot.confidence);
        p.soft_spots.push(spot);
      }
    }
  }

  // Remove soft spots — validate: must be Array of strings
  if (Array.isArray(delta.soft_spots_remove)) {
    const toRemove = delta.soft_spots_remove.filter(t => typeof t === 'string');
    p.soft_spots = (p.soft_spots || []).filter(s => !toRemove.includes(s.topic));
  }

  // Change confidence
  const confChanges = delta.soft_spots_confidence_change || delta.confidence_changes || {};
  if (confChanges && typeof confChanges === 'object' && !Array.isArray(confChanges)) {
    for (const [topic, newConf] of Object.entries(confChanges)) {
      const spot = (p.soft_spots || []).find(s => s.topic === topic);
      if (spot && typeof newConf === 'string') spot.confidence = sanitizeConfidence(newConf);
    }
  }

  // Add indifferent — validate: must be Array of strings
  if (Array.isArray(delta.indifferent_add)) {
    p.indifferent = p.indifferent || [];
    for (const item of delta.indifferent_add) {
      if (typeof item === 'string' && !p.indifferent.includes(item)) p.indifferent.push(item);
    }
  }

  // Add avoidance — validate: must be Array of strings
  if (Array.isArray(delta.avoidance_add)) {
    p.avoidance = p.avoidance || [];
    for (const item of delta.avoidance_add) {
      if (typeof item === 'string' && !p.avoidance.includes(item)) p.avoidance.push(item);
    }
  }

  // Update behavior pattern — validate: must be string
  if (delta.behavior_pattern_update && typeof delta.behavior_pattern_update === 'string') {
    p.behavior_pattern = delta.behavior_pattern_update;
  }

  profileDoc.last_updated = new Date().toISOString();
}

// ─── Get Profile for Injection ──────────────────────────────────────────────

/**
 * Extract a 3-8 char anchor keyword from evidence text.
 * Picks the most distinctive short phrase.
 */
function _extractAnchor(evidence) {
  if (!evidence || typeof evidence !== 'string') return '';
  // Try to find a parenthesized term or proper noun
  const paren = evidence.match(/[（(]([^）)]{2,8})[）)]/);
  if (paren) return paren[1];
  // Try quoted text
  const quoted = evidence.match(/[「'""']([^」'""']{2,8})[」'""']/);
  if (quoted) return quoted[1];
  // Fall back to first 6 meaningful chars (skip common prefixes)
  const trimmed = evidence.replace(/^(面对|关于|针对|对于|由于|基于|通过)/, '').trim();
  return trimmed.slice(0, 6);
}

/**
 * Check if two Chinese strings share N+ consecutive characters.
 */
function _overlapChinese(a, b, minLen = 3) {
  if (!a || !b) return false;
  for (let i = 0; i <= a.length - minLen; i++) {
    if (b.includes(a.slice(i, i + minLen))) return true;
  }
  return false;
}

/**
 * Select top N soft_spots using activation-aware multi-dimensional scoring + dedup.
 */
function _selectTopSpots(spots, maxCount) {
  if (!Array.isArray(spots) || spots.length === 0) return [];
  const total = spots.length;
  const confMap = { high: 3, medium: 2, low: 1 };
  const act = require('./activation');

  // Build cluster sizes: count how many other entries share 4+ chars with each topic
  const clusterSizes = spots.map((s, i) => {
    let count = 0;
    for (let j = 0; j < total; j++) {
      if (j !== i && _overlapChinese(s.topic, spots[j].topic, 4)) count++;
    }
    return count;
  });

  // Load context features for activation scoring
  let ctxFeatures = null;
  try {
    const sm = require('./session-memory');
    ctxFeatures = sm.getContextFeatures('default');
  } catch {}

  // Score each entry: confidence + activation + cluster + recency
  const nowMs = Date.now();
  const scored = spots.map((s, i) => {
    // Compute activation score if spot has _activation data
    let actScore = 0;
    if (s._activation) {
      actScore = act.computeActivation(s, ctxFeatures, nowMs);
    }
    // Normalize activation to a [0, 4] bonus range via sigmoid
    const actBonus = 4 / (1 + Math.exp(-actScore));

    return {
      ...s,
      _index: i,
      _score: (confMap[s.confidence] || 1)
        + actBonus
        + Math.min(clusterSizes[i], 5)
        + (i >= total * 2 / 3 ? 1 : 0),
    };
  });

  scored.sort((a, b) => b._score - a._score);

  // Greedy dedup selection
  const selected = [];
  for (const s of scored) {
    if (selected.length >= maxCount) break;
    if (selected.some(sel => _overlapChinese(s.topic, sel.topic, 4))) continue;
    selected.push(s);
  }
  return selected;
}

/**
 * Get retrieval anchors for fact-db search pre-filtering.
 * Returns top soft_spot topics + behavior pattern as search terms.
 */
function getRetrievalAnchors() {
  const doc = loadProfile();
  if (!doc || !doc.base_profile) return [];

  const p = doc.base_profile;
  const anchors = [];

  // Top 5 soft_spot topics
  if (p.soft_spots && p.soft_spots.length > 0) {
    const top = _selectTopSpots(p.soft_spots, 5);
    for (const s of top) {
      anchors.push(s.topic);
    }
  }

  // Behavior pattern keywords
  if (p.behavior_pattern) {
    anchors.push(p.behavior_pattern);
  }

  return anchors;
}

function getProfileForInjection() {
  const doc = loadProfile();
  if (!doc || !doc.base_profile) return null;

  const p = doc.base_profile;
  const obs = (doc.observations || []).slice(-2); // last 2, truncated

  let text = _t('profile.inject.header');
  if (p.identity) text += _t('profile.inject.identity', { val: p.identity });

  // Compressed soft_spots: top 7 with anchor keywords
  if (p.soft_spots && p.soft_spots.length > 0) {
    const top = _selectTopSpots(p.soft_spots, 7);
    text += _t('profile.inject.soft_spots');
    for (const s of top) {
      const anchor = _extractAnchor(s.evidence);
      text += `  - ${s.topic} [${s.confidence}]${anchor ? ' (' + anchor + ')' : ''}\n`;
    }
  }

  if (p.indifferent && p.indifferent.length > 0) {
    const sep = _t('profile.inject.sep');
    text += _t('profile.inject.indifferent', { val: p.indifferent.join(sep) });
  }

  // Compressed avoidance: top 5, skip overlaps with selected soft_spots
  if (p.avoidance && p.avoidance.length > 0) {
    const topSpotTopics = (p.soft_spots || []).slice(0, 7).map(s => s.topic);
    const filtered = p.avoidance.filter(a =>
      !topSpotTopics.some(t => _overlapChinese(a, t))
    );
    const sep = _t('profile.inject.sep');
    text += _t('profile.inject.avoidance', { val: filtered.slice(0, 5).join(sep) });
  }

  if (p.behavior_pattern) text += _t('profile.inject.behavior', { val: p.behavior_pattern });
  if (p.unfinished_business && p.unfinished_business.length > 0) {
    const sep = _t('profile.inject.sep');
    text += _t('profile.inject.unfinished', { val: p.unfinished_business.join(sep) });
  }
  if (p.self_image_gap) text += _t('profile.inject.self_gap', { val: p.self_image_gap });
  if (p.contradictions && p.contradictions.length > 0) {
    const sep = _t('profile.inject.sep');
    text += _t('profile.inject.contradictions', { val: p.contradictions.join(sep) });
  }

  if (obs.length > 0) {
    text += _t('profile.inject.observations');
    for (const o of obs) {
      const note = (o.note || '').slice(0, 80);
      text += `  - ${note}${o.note && o.note.length > 80 ? '…' : ''}\n`;
    }
  }

  return text;
}

function hasProfile() {
  return !!loadProfile()?.base_profile;
}

module.exports = {
  sanitizeConfidence,
  init,
  loadProfile,
  saveProfile,
  invalidateCache,
  generateBaseProfile,
  incrementalUpdate,
  gameEndReflection,
  getProfileForInjection,
  getRetrievalAnchors,
  hasProfile,
};
