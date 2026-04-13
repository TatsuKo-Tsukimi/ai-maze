'use strict';

// ─── Villain Episodic Memory ────────────────────────────────────────────────
// Write-through episodic memory for the villain agent.
// Records trial/temptation events incrementally (survives mid-game refresh)
// and generates cross-game reflections for injection into new sessions.

const fs   = require('fs');
const path = require('path');
const log  = require('./utils/logger');
const activation = require('./activation');

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

const MEMORY_PATH       = path.join(__dirname, '..', 'data', 'villain-episodic.json');
const EPISODIC_LOG      = path.join(__dirname, '..', 'data', 'episodic-access.log');
const MAX_GAMES         = 10;  // keep last N games of episodes
const MAX_SUMMARY_GAMES = 5;   // consider episodes from last N games
const MAX_INJECT_EPISODES = 12; // max episodes to inject (activation-ranked)
const MAX_CONSOLIDATED  = 30;  // consolidated memory cap

let _memory = null; // cached in-memory
let _contextFeatures = null; // set per session

// ─── Load / Save ────────────────────────────────────────────────────────────

function _load() {
  if (_memory) return _memory;
  try {
    const raw = fs.readFileSync(MEMORY_PATH, 'utf8');
    _memory = JSON.parse(raw);
    if (!_memory.version || !Array.isArray(_memory.games)) throw new Error('invalid');
  } catch {
    _memory = { version: 1, games: [] };
  }
  return _memory;
}

function _save() {
  if (!_memory) return;
  // Trim to MAX_GAMES
  if (_memory.games.length > MAX_GAMES) {
    _memory.games = _memory.games.slice(-MAX_GAMES);
  }
  try {
    const dir = path.dirname(MEMORY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(_memory, null, 2), 'utf8');
  } catch (e) {
    log.warn('villain-memory', 'save failed: ' + e.message);
  }
}

// ─── Game lifecycle ─────────────────────────────────────────────────────────

function _getOrCreateGame(gameId) {
  const mem = _load();
  let game = mem.games.find(g => g.gameId === gameId);
  if (!game) {
    game = {
      gameId,
      startedAt: new Date().toISOString(),
      episodes: [],    // individual events: trial, temptation, etc.
      reflection: null, // end-of-game reflection (by villain)
    };
    mem.games.push(game);
  }
  return game;
}

// ─── Write-through: record an episode immediately ───────────────────────────

function recordEpisode(gameId, episode) {
  // episode: { type: 'trial'|'temptation'|'truth', step, material, playerResponse, outcome, ... }
  const game = _getOrCreateGame(gameId);

  // Cold-start prior based on episode type + outcome
  let prior = 0.5;
  if (episode.type === 'trial') {
    prior = episode.hit ? 0.8 : (episode.outcome === 'pass' ? 0.3 : 0.4);
  } else if (episode.type === 'temptation') {
    prior = episode.outcome === 'follow' ? 0.6 : 0.4;
  }

  game.episodes.push({
    ...episode,
    timestamp: new Date().toISOString(),
    _activation: activation.createActivation(prior),
  });
  _save();
  log.info('villain-memory', `episode recorded: ${gameId} step=${episode.step} type=${episode.type} material="${(episode.material || '').slice(0, 40)}"`);
}

// ─── End-of-game reflection ─────────────────────────────────────────────────

function recordReflection(gameId, reflectionText) {
  const game = _getOrCreateGame(gameId);
  game.reflection = reflectionText;
  game.endedAt = new Date().toISOString();
  _save();
  log.info('villain-memory', `reflection recorded: ${gameId} (${(reflectionText || '').length} chars)`);
}

// ─── Generate injection text for new session ────────────────────────────────

function setContextFeatures(features) {
  _contextFeatures = features || null;
}

function getEpisodicInjection(contextFeatures) {
  const mem = _load();
  if (mem.games.length === 0) return null;

  const features = contextFeatures || _contextFeatures;

  // Collect ALL episodes from recent games + consolidated memories
  const recent = mem.games
    .filter(g => g.episodes.length > 0 || g.reflection)
    .slice(-MAX_SUMMARY_GAMES);

  if (recent.length === 0 && !(mem.consolidated && mem.consolidated.length > 0)) return null;

  // Gather all candidate episodes (with gameLabel attached for display)
  const candidates = [];
  for (const game of recent) {
    const gameLabel = game.gameId.replace(/^game_\d+_/, '').slice(0, 6);
    for (const ep of game.episodes) {
      // Migrate old episodes without _activation
      if (!ep._activation) ep._activation = activation.createActivation(0.4);
      candidates.push({ ...ep, _gameLabel: gameLabel, _source: 'episodic' });
    }
  }
  // Include consolidated memories
  if (Array.isArray(mem.consolidated)) {
    for (const ep of mem.consolidated) {
      if (!ep._activation) ep._activation = activation.createActivation(0.6);
      candidates.push({ ...ep, _source: 'consolidated' });
    }
  }

  if (candidates.length === 0) return null;

  // Activation-ranked selection
  const ranked = activation.rankByActivation(candidates, features, MAX_INJECT_EPISODES);

  // Mark selected episodes as referenced (positive feedback loop)
  const nowMs = Date.now();
  for (const ep of ranked) {
    activation.recordAccess(ep, features, nowMs);
    _logEpisodicAccess(ep, features);
  }

  // Write back updated activation state to the actual memory objects
  _syncActivationBack(ranked, recent, mem);
  _save();

  // Format injection text (same format as before, but activation-ranked)
  let text = _t('vmem.injection.header');

  // Group by gameLabel for readability
  const byGame = new Map();
  for (const ep of ranked) {
    const label = ep._gameLabel || (ep._source === 'consolidated' ? '\u2605' : '?');
    if (!byGame.has(label)) byGame.set(label, []);
    byGame.get(label).push(ep);
  }

  for (const [gameLabel, episodes] of byGame) {
    const trialEps = episodes.filter(e => e.type === 'trial');
    const temptEps = episodes.filter(e => e.type === 'temptation');

    text += `[${_t('vmem.injection.gameLabel')} ${gameLabel}] `;

    if (trialEps.length > 0) {
      const trialSummary = trialEps.map(e => {
        const mat = (e.material || '?').slice(0, 30);
        const result = e.outcome === 'pass' ? _t('vmem.injection.pass') : _t('vmem.injection.fail');
        const hitMark = e.hit ? '\u{1F4A5}' : '';
        const exitLabel = e.exitMethod === 'god_hand' ? _t('vmem.injection.godHand') : e.exitMethod === 'retreat' ? _t('vmem.injection.retreat') : '';
        const cType = e.confrontation_type && e.confrontation_type !== 'unknown' ? `[${e.confrontation_type}]` : '';
        const qLabel = e.quality && e.quality !== 'good' ? `[${e.quality}]` : '';
        const extra = [cType, qLabel, exitLabel].filter(Boolean).join(' ');
        return `\u300C${mat}\u300D${result}${hitMark}${extra ? ' ' + extra : ''}`;
      }).join('\u3001');
      text += `${_t('vmem.injection.trial')}: ${trialSummary}\u3002`;
    }

    if (temptEps.length > 0) {
      const temptSummary = temptEps.map(e => {
        const mat = (e.material || '?').slice(0, 30);
        const result = e.outcome === 'follow' ? _t('vmem.injection.follow') : _t('vmem.injection.ignore');
        return `\u300C${mat}\u300D${result}`;
      }).join('\u3001');
      text += `${_t('vmem.injection.temptation')}: ${temptSummary}\u3002`;
    }

    text += '\n';
  }

  // Add reflections from recent games (if any ranked episode came from that game)
  for (const game of recent) {
    if (game.reflection) {
      const gameLabel = game.gameId.replace(/^game_\d+_/, '').slice(0, 6);
      if (byGame.has(gameLabel)) {
        text += `${_t('vmem.injection.reflection')}${game.reflection}\n`;
      }
    }
  }

  text += _t('vmem.injection.footer');
  return text;
}

// ─── Sync activation data back from ranked copies to actual memory objects ──

function _syncActivationBack(ranked, recentGames, mem) {
  for (const ep of ranked) {
    if (ep._source === 'consolidated' && Array.isArray(mem.consolidated)) {
      const target = mem.consolidated.find(c =>
        c.timestamp === ep.timestamp && c.type === ep.type && c.step === ep.step
      );
      if (target) target._activation = ep._activation;
    } else {
      for (const game of recentGames) {
        const target = game.episodes.find(e =>
          e.timestamp === ep.timestamp && e.type === ep.type && e.step === ep.step
        );
        if (target) {
          target._activation = ep._activation;
          break;
        }
      }
    }
  }
}

// ─── Episodic Access Log ───────────────────────────────────────────────────

function _logEpisodicAccess(ep, features) {
  try {
    const entry = JSON.stringify({
      t: new Date().toISOString(),
      type: ep.type,
      step: ep.step,
      material: (ep.material || '').slice(0, 40),
      source: ep._source,
      contextTags: features ? (features.behaviorTags || []) : [],
    });
    activation.rotateLogIfNeeded(EPISODIC_LOG);
    fs.appendFileSync(EPISODIC_LOG, entry + '\n');
  } catch { /* best-effort */ }
}

// ─── Cross-Game Memory Consolidation ───────────────────────────────────────

function consolidateMemories(contextFeatures) {
  const mem = _load();
  const features = contextFeatures || _contextFeatures;
  const cfg = activation.getConfig();

  if (!mem.consolidated) mem.consolidated = [];

  // Scan all episodes across all games
  const nowMs = Date.now();
  for (const game of mem.games) {
    for (const ep of game.episodes) {
      if (!ep._activation) continue;

      const score = activation.computeActivation(ep, features, nowMs);
      if (score < cfg.CONSOLIDATION_THRESHOLD) continue;

      // Check if already consolidated (by timestamp + type + step)
      const exists = mem.consolidated.find(c =>
        c.timestamp === ep.timestamp && c.type === ep.type && c.step === ep.step
      );
      if (exists) continue;

      // Promote: copy episode to consolidated tier with activation boost
      const consolidated = {
        type: ep.type,
        step: ep.step,
        material: ep.material,
        outcome: ep.outcome,
        hit: ep.hit,
        confrontation_type: ep.confrontation_type,
        quality: ep.quality,
        exitMethod: ep.exitMethod,
        playerResponse: ep.playerResponse,
        timestamp: ep.timestamp,
        gameId: game.gameId,
        _gameLabel: game.gameId.replace(/^game_\d+_/, '').slice(0, 6),
        _activation: { ...ep._activation },
      };
      // Consolidation boost
      consolidated._activation.foldedActivation += 1.0;
      mem.consolidated.push(consolidated);
    }
  }

  // Cap consolidated memories, evict lowest-activation
  if (mem.consolidated.length > MAX_CONSOLIDATED) {
    const scored = mem.consolidated.map(c => ({
      item: c,
      score: activation.computeActivation(c, features, nowMs),
    }));
    scored.sort((a, b) => b.score - a.score);
    mem.consolidated = scored.slice(0, MAX_CONSOLIDATED).map(s => s.item);
  }

  _save();
  const count = mem.consolidated.length;
  if (count > 0) log.info('villain-memory', `consolidated memories: ${count}`);
}

// ─── Build note message for in-session injection ────────────────────────────

function buildTrialNote(step, material, playerInput, judgment, hit) {
  const passStr = judgment === 'pass' ? _t('vmem.note.trial.pass') : _t('vmem.note.trial.fail');
  const hitStr = hit ? _t('vmem.note.trial.hit') : _t('vmem.note.trial.miss');
  return _t('vmem.note.trial', {
    step: String(step),
    material: (material || '').slice(0, 50),
    input: (playerInput || '').slice(0, 40),
    result: passStr,
    hit: hitStr,
  });
}

function buildTemptationNote(step, material, choice) {
  const result = choice === 'follow' ? _t('vmem.note.temptation.follow') : _t('vmem.note.temptation.ignore');
  return _t('vmem.note.temptation', {
    step: String(step),
    material: (material || '').slice(0, 50),
    result: result,
  });
}

/**
 * Summarize confrontation_type distribution from recent games.
 * Used by trial_request to inject a light tendency hint.
 */
function getRecentConfrontationSummary() {
  const mem = _load();
  const recent = mem.games.slice(-3);
  let total = 0, bad = 0;
  for (const game of recent) {
    for (const e of (game.episodes || [])) {
      if (e.type === 'trial' && e.confrontation_type && e.confrontation_type !== 'unknown') {
        total++;
        if (e.confrontation_type === 'bad') bad++;
      }
    }
  }
  return { total, bad, badRate: total > 0 ? bad / total : 0 };
}

function invalidateCache() {
  _memory = null;
}

module.exports = {
  initLocale,
  recordEpisode,
  recordReflection,
  getEpisodicInjection,
  getRecentConfrontationSummary,
  buildTrialNote,
  buildTemptationNote,
  invalidateCache,
  setContextFeatures,
  consolidateMemories,
};
