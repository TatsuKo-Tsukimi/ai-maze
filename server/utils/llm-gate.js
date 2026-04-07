'use strict';
// ─── LLM Gate: Three-tier throttle for background LLM consumers ─────────────
//
// Three speed tiers:
//   Full speed (500ms)  — no game active, archivist startup window
//   Throttled  (5000ms) — game session active, yield quota to real-time calls
//   Backoff    (30000ms)— any subsystem hit 429, global cooldown
//
// Usage:
//   llmGate.setGameActive(true/false)  — maze-agent calls on session start/end
//   llmGate.report429()                — any subsystem calls on 429 error
//   await llmGate.wait(baseMs)         — background consumers call before each LLM request

const log = require('./logger');

let _gameActive = false;
let _429until = 0; // timestamp: global 429 backoff deadline

function setGameActive(active) {
  const prev = _gameActive;
  _gameActive = !!active;
  if (prev !== _gameActive) {
    log.info('llm-gate', _gameActive ? '游戏开始 → 后台降速 (5s)' : '游戏结束 → 后台恢复全速');
  }
}

function isGameActive() {
  return _gameActive;
}

function report429() {
  _429until = Date.now() + 30000;
  log.warn('llm-gate', '429 触发 → 全局退避 30s');
}

function getDelay(baseMs) {
  const now = Date.now();
  if (now < _429until) return Math.max(baseMs, _429until - now);
  if (_gameActive) return Math.max(baseMs, 5000);
  return baseMs;
}

async function wait(baseMs) {
  const ms = getDelay(baseMs);
  await new Promise(r => setTimeout(r, ms));
}

module.exports = { setGameActive, isGameActive, report429, getDelay, wait };
