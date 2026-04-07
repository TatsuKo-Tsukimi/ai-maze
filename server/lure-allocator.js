"use strict";

const fs = require("fs");
const path = require("path");

// ─── Lure Allocator ──────────────────────────────────────────────────────────
// Unified lure material allocation for both temptation and trial systems.
// Ensures no material is used twice in the same game, and recently used
// materials are excluded across games.

const CROSS_GAME_WINDOW = 5; // materials used in last N games are excluded
const STATE_FILE = "lure-allocation-state.json";

let _state = {
  version: 1,
  gameHistory: [], // [{ gameId, usedKeys: [{ key, purpose }] }]
};
let _currentGame = null; // { gameId, usedKeys: Set<string> }
let _stateDir = null;

function _keyFromPath(filePath) {
  // Normalize path to a stable key
  return (filePath || "").replace(/\\/g, "/").split("/").slice(-3).join("/").toLowerCase();
}

function _keyFromItem(item) {
  return _keyFromPath(item.path || item.name || "");
}

// ─── Persistence ─────────────────────────────────────────────────────────────

function init(dataDir) {
  _stateDir = dataDir;
  _loadState();
}

function _getStatePath() {
  if (!_stateDir) return null;
  return path.join(_stateDir, STATE_FILE);
}

function _loadState() {
  const p = _getStatePath();
  if (!p) return;
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && Array.isArray(parsed.gameHistory)) {
        _state = parsed;
        // Trim to window size
        if (_state.gameHistory.length > CROSS_GAME_WINDOW) {
          _state.gameHistory = _state.gameHistory.slice(-CROSS_GAME_WINDOW);
        }
        console.log(`[lure-alloc] loaded state: ${_state.gameHistory.length} games in history`);
      }
    }
  } catch (err) {
    console.warn("[lure-alloc] failed to load state:", err.message);
  }
}

function _saveState() {
  const p = _getStatePath();
  if (!p) return;
  try {
    // Ensure directory exists
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(_state, null, 2), "utf8");
  } catch (err) {
    console.warn("[lure-alloc] failed to save state:", err.message);
  }
}

// ─── Game lifecycle ──────────────────────────────────────────────────────────

function startGame(gameId) {
  _currentGame = { gameId, usedKeys: new Set() };
  console.log(`[lure-alloc] game started: ${gameId}`);
}

function endGame(gameId) {
  if (!_currentGame || _currentGame.gameId !== gameId) return;
  // Record to history
  _state.gameHistory.push({
    gameId,
    usedKeys: Array.from(_currentGame.usedKeys).map(k => ({ key: k })),
  });
  // Trim history
  if (_state.gameHistory.length > CROSS_GAME_WINDOW) {
    _state.gameHistory = _state.gameHistory.slice(-CROSS_GAME_WINDOW);
  }
  _saveState();
  console.log(`[lure-alloc] game ended: ${gameId}, ${_currentGame.usedKeys.size} materials used, history: ${_state.gameHistory.length} games`);
  _currentGame = null;
}

// ─── Allocation ──────────────────────────────────────────────────────────────

function _getRecentlyUsedKeys() {
  const keys = new Set();
  for (const game of _state.gameHistory) {
    for (const entry of (game.usedKeys || [])) {
      keys.add(entry.key);
    }
  }
  return keys;
}

function isAvailable(item) {
  const key = _keyFromItem(item);
  // Check current game
  if (_currentGame && _currentGame.usedKeys.has(key)) return false;
  // Check cross-game history
  return !_getRecentlyUsedKeys().has(key);
}

function markUsed(item, purpose) {
  const key = _keyFromItem(item);
  if (_currentGame) {
    _currentGame.usedKeys.add(key);
  }
  console.log(`[lure-alloc] marked: ${key} (${purpose})`);
}

function allocate(items, purpose, count = 1) {
  // Filter to available items
  const available = items.filter(item => isAvailable(item));
  if (available.length === 0) {
    console.log(`[lure-alloc] no available items for ${purpose}, all ${items.length} excluded`);
    // Fallback: clear cross-game history and retry with current-game-only filter
    if (_state.gameHistory.length > 0) {
      console.log("[lure-alloc] clearing cross-game history for fallback");
      _state.gameHistory = [];
      _saveState();
      return allocate(items, purpose, count);
    }
    return [];
  }
  // Pick random subset
  const shuffled = available.sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, count);
  for (const item of picked) {
    markUsed(item, purpose);
  }
  console.log(`[lure-alloc] allocated ${picked.length}/${available.length} for ${purpose}`);
  return picked;
}

function getStats() {
  return {
    currentGameUsed: _currentGame ? _currentGame.usedKeys.size : 0,
    historyGames: _state.gameHistory.length,
    totalExcluded: _getRecentlyUsedKeys().size + (_currentGame ? _currentGame.usedKeys.size : 0),
  };
}

module.exports = {
  init,
  startGame,
  endGame,
  isAvailable,
  markUsed,
  allocate,
  getStats,
  _keyFromItem, // exported for testing
  _getRecentlyUsedKeys,
};
