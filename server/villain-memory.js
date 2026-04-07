'use strict';

// ─── Villain Episodic Memory ────────────────────────────────────────────────
// Write-through episodic memory for the villain agent.
// Records trial/temptation events incrementally (survives mid-game refresh)
// and generates cross-game reflections for injection into new sessions.

const fs   = require('fs');
const path = require('path');
const log  = require('./utils/logger');

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

const MEMORY_PATH = path.join(__dirname, '..', 'data', 'villain-episodic.json');
const MAX_GAMES   = 10;  // keep last N games of episodes
const MAX_SUMMARY_GAMES = 5; // inject summaries from last N games

let _memory = null; // cached in-memory

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
  game.episodes.push({
    ...episode,
    timestamp: new Date().toISOString(),
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

function getEpisodicInjection() {
  const mem = _load();
  if (mem.games.length === 0) return null;

  // Get recent games (with episodes or reflections)
  const recent = mem.games
    .filter(g => g.episodes.length > 0 || g.reflection)
    .slice(-MAX_SUMMARY_GAMES);

  if (recent.length === 0) return null;

  let text = _t('vmem.injection.header');

  for (const game of recent) {
    const gameLabel = game.gameId.replace(/^game_\d+_/, '').slice(0, 6);
    const episodes = game.episodes;

    if (episodes.length > 0) {
      // Compact format: list materials used and outcomes
      const trialEps = episodes.filter(e => e.type === 'trial');
      const temptEps = episodes.filter(e => e.type === 'temptation');

      text += `[${_t('vmem.injection.gameLabel')} ${gameLabel}] `;

      if (trialEps.length > 0) {
        const trialSummary = trialEps.map(e => {
          const mat = (e.material || '?').slice(0, 30);
          const result = e.outcome === 'pass' ? _t('vmem.injection.pass') : _t('vmem.injection.fail');
          const hitMark = e.hit ? '\u{1F4A5}' : '';
          const exitLabel = e.exitMethod === 'god_hand' ? _t('vmem.injection.godHand') : e.exitMethod === 'retreat' ? _t('vmem.injection.retreat') : '';
          // Confrontation type label (MVP signal)
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
    }

    if (game.reflection) {
      text += `${_t('vmem.injection.reflection')}${game.reflection}`;
    }

    text += '\n';
  }

  text += _t('vmem.injection.footer');

  return text;
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
};
