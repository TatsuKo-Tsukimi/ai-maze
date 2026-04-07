'use strict';

// ─── Maze Agent v3: Direct LLM Call + Fact-DB ───────────────────────────────
// Uses ctx.LLM.chat() directly. Game server controls system prompt (maze identity).
// Integrates fact-db for trial/card/temptation content.

const fs = require('fs');
const path = require('path');
const log = require('./utils/logger');
const llmGate = require('./utils/llm-gate');
const factDb = require('./fact-db');
const themeCluster = require('./theme-cluster');
const ammoQueue = require('./ammo-queue');

// Active game sessions: gameId → { history, systemPrompt, started }
const _sessions = new Map();

// Shared LLM client reference (set via init)
let _LLM = null;
let _SOUL_PATH = '';
let _MODEL_ID = '';
let _locale = null;
const VILLAIN_NOTES_PATH = path.join(__dirname, '..', 'data', 'villain-notes.jsonl');

function _t(key, params) {
  let s = (_locale && _locale[key]) || require('./locales/zh')[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
  }
  return s;
}

function init(ctx) {
  _LLM = ctx.LLM;
  _SOUL_PATH = ctx.SOUL_PATH || '';
  _MODEL_ID = ctx.MODEL_ID || ctx.ACTIVE_MODEL || '';
  _locale = require('./locales/' + (ctx.LOCALE || 'zh'));
}

// ─── Event Policies ─────────────────────────────────────────────────────────
// Each event type declares its behavioral constraints for the current round.
// "Limit behavior, don't change the subject."
const EVENT_POLICIES = {
  card:                { allowTools: false, requireJson: true, prefill: true, maxTokens: 200 },
  trial_answer:        { allowTools: false, requireJson: true, prefill: true, maxTokens: 150 },
  temptation_reaction: { allowTools: false, requireJson: true, prefill: true, maxTokens: 200 },
  intro:               { allowTools: false, requireJson: true, prefill: true, maxTokens: 300 },
  epilogue:            { allowTools: false, requireJson: true, prefill: true, maxTokens: 300 },
  truth_reveal:        { allowTools: false, requireJson: true, prefill: true, maxTokens: 200 },
  game_end:            { allowTools: false, requireJson: true, prefill: true, maxTokens: 200 },
  trial_request:       { allowTools: true,  requireJson: false, prefill: false, maxTokens: 800 },
  temptation_prepare:  { allowTools: true,  requireJson: false, prefill: false, maxTokens: 400 },
  // init (startSession) uses its own path, not sendEvent
};
const DEFAULT_POLICY = { allowTools: true, requireJson: false, prefill: false, maxTokens: 800 };

/**
 * Append a villain note for a game to the JSONL notebook.
 * @param {string} gameId - Game session id.
 * @param {string} note - Note content to store.
 * @returns {{ok:boolean, gameId:string, note:string, timestamp:string}}
 */
function writeVillainNote(gameId, note) {
  const entry = {
    gameId,
    note: String(note || '').trim(),
    timestamp: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(VILLAIN_NOTES_PATH), { recursive: true });
  fs.appendFileSync(VILLAIN_NOTES_PATH, JSON.stringify(entry) + '\n', 'utf8');
  return { ok: true, gameId: entry.gameId, note: entry.note, timestamp: entry.timestamp };
}

/**
 * Read stored villain notes for a game.
 * @param {string} gameId - Game session id.
 * @param {number} limit - Maximum number of notes to return.
 * @returns {Array<{gameId:string, note:string, timestamp:string}>}
 */
function readVillainNotes(gameId, limit = 10) {
  try {
    const raw = fs.readFileSync(VILLAIN_NOTES_PATH, 'utf8');
    const rows = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(entry => entry && entry.gameId === gameId);
    return rows.slice(-Math.max(1, limit));
  } catch {
    return [];
  }
}

/**
 * Create a tool executor for villain tool use in one game session.
 * @param {string} gameId - Game session id.
 * @returns {(toolName:string, input:object) => Promise<object|string>}
 */
function createToolExecutor(gameId) {
  return async function toolExecutor(toolName, input = {}) {
    switch (toolName) {
      case 'search_facts': {
        const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 10);
        return { results: factDb.search(input.query || '', limit, input.theme || null) };
      }
      case 'read_chunk': {
        const chunk = factDb.getChunkById(String(input.id || ''));
        if (!chunk) return { error: 'Chunk not found' };
        const file = factDb.getFileById(chunk.fileId);
        return {
          id: chunk.id,
          summary: chunk.summary || '',
          content: chunk.content || '',
          fileName: file?.fileName || '',
          tags: Array.isArray(chunk.tags) ? chunk.tags : [],
        };
      }
      case 'list_files': {
        const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 30);
        let files = factDb.listFiles(limit * 5);
        if (input.theme) {
          const allowed = new Set(themeCluster.getFilesByTheme(String(input.theme || '')));
          files = files.filter(file => allowed.has(file.id));
        }
        return { files: files.slice(0, limit) };
      }
      case 'list_themes': {
        return {
          themes: themeCluster.getThemes().map(theme => {
            const fileIds = Array.isArray(theme.fileIds) ? theme.fileIds : [];
            // Count chunk usage across all files in this theme
            let totalChunks = 0;
            let usedChunks = 0;
            for (const fid of fileIds) {
              const file = factDb.getFileById(fid);
              if (!file || !Array.isArray(file.chunks)) continue;
              for (const cid of file.chunks) {
                const chunk = factDb.getChunkById(cid);
                if (!chunk || chunk.junk) continue;
                totalChunks++;
                if ((chunk.useCount || 0) > 0) usedChunks++;
              }
            }
            const ratio = totalChunks > 0 ? usedChunks / totalChunks : 0;
            const freshness = ratio < 0.15 ? 'fresh' : ratio < 0.5 ? 'explored' : 'exhausted';
            return {
              name: theme.name,
              description: theme.description || '',
              fileCount: fileIds.length,
              freshness,
              usage: `${usedChunks}/${totalChunks} chunks used`,
            };
          }),
        };
      }
      case 'write_note':
        return writeVillainNote(gameId, input.note || '');
      case 'read_notes':
        return { notes: readVillainNotes(gameId, Math.min(Math.max(Number(input.limit) || 10, 1), 50)) };
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  };
}

// ─── System prompt builder ──────────────────────────────────────────────────

function buildMazeSystemPrompt(soulPath) {
  let memory = '';

  if (soulPath) {
    // Core identity files only — daily memory files are now in fact-db
    // and fed through the archivist pipeline as game material
    const files = ['SOUL.md', 'MEMORY.md', 'IDENTITY.md', 'USER.md'];
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(soulPath, f), 'utf8').trim();
        if (content) memory += `\n--- ${f} ---\n${content}\n`;
      } catch {}
    }
  }

  return _t('villain.system_prompt', { memory: memory || _t('villain.no_memory') });
}

/**
 * Parse tool calls from LLM response text.
 * Format: <tool_call>{"name":"xxx","input":{...}}</tool_call>
 * @param {string} text - Raw LLM response
 * @returns {Array<{name:string, input:object}>}
 */
function parseToolCalls(text) {
  if (!text || typeof text !== 'string') return [];

  const calls = [];
  const regex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match;

  while ((match = regex.exec(text)) !== null) {
    let payload = String(match[1] || '').trim();
    if (!payload) continue;

    const fenced = payload.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) payload = fenced[1].trim();

    try {
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) {
        calls.push({
          name: parsed.name.trim(),
          input: parsed.input && typeof parsed.input === 'object' && !Array.isArray(parsed.input) ? parsed.input : {},
        });
      }
      continue;
    } catch {}

    const loose = payload.match(/"name"\s*:\s*"([^"]+)"(?:\s*,\s*"input"\s*:\s*(\{[\s\S]*\}))?/);
    if (!loose) continue;

    let input = {};
    if (loose[2]) {
      try { input = JSON.parse(loose[2]); } catch {}
    }

    calls.push({ name: loose[1].trim(), input });
  }

  return calls;
}

/**
 * Strip tool_call tags from text, leaving only the natural language parts.
 * @param {string} text
 * @returns {string}
 */
function stripToolCalls(text) {
  if (!text) return '';
  return String(text).replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '').trim();
}

// ─── Circuit Breaker (cross-session failure tracking) ───────────────────────
// Tracks consecutive failures per event type. If a type fails N times in a row,
// it trips the breaker and skips LLM calls (goes straight to fallback).
// Half-open: after cooldown, allows one probe request to test recovery.

const _circuitBreaker = {
  // eventType → { failures: number, lastFailure: timestamp, tripped: boolean }
  _state: new Map(),
  TRIP_THRESHOLD: 4,      // consecutive failures to trip
  COOLDOWN_MS: 5 * 60000, // 5 minutes before half-open probe

  record(eventType, success) {
    let state = this._state.get(eventType);
    if (!state) {
      state = { failures: 0, lastFailure: 0, tripped: false };
      this._state.set(eventType, state);
    }
    if (success) {
      state.failures = 0;
      state.tripped = false;
    } else {
      state.failures++;
      state.lastFailure = Date.now();
      if (state.failures >= this.TRIP_THRESHOLD) {
        state.tripped = true;
        log.warn('circuit-breaker', `tripped for "${eventType}" after ${state.failures} consecutive failures`);
      }
    }
  },

  shouldSkip(eventType) {
    const state = this._state.get(eventType);
    if (!state || !state.tripped) return false;
    // Half-open: allow one probe after cooldown
    if (Date.now() - state.lastFailure > this.COOLDOWN_MS) {
      log.info('circuit-breaker', `half-open probe for "${eventType}"`);
      return false; // let it try
    }
    return true; // still tripped, skip
  },

  stats() {
    const result = {};
    for (const [type, state] of this._state) {
      result[type] = { failures: state.failures, tripped: state.tripped };
    }
    return result;
  },
};

// ─── Three-layer context compression ────────────────────────────────────────
//
// Inspired by Claude Code's five-layer compression architecture, adapted for
// game villain sessions where emotional continuity matters more than raw data.
//
// Layer 1: Microcompact — strip verbose JSON from old messages (sync, every call)
// Layer 2: Auto compact — LLM summarizes early history (async, at threshold)
// Layer 3: Hard trim — absolute safety net (sync, never exceed 60 messages)

/**
 * Layer 1: Microcompact — compress old messages in-place.
 * Keeps last 10 messages intact. For older messages, strips verbose JSON
 * (_protocol, _perception, reference_material, available_material) while
 * preserving the emotional/narrative content villain needs.
 */
function _microcompact(session) {
  const history = session.history;
  if (history.length <= 8) return; // lowered threshold for earlier compaction

  const protectLast = 10;
  const compactBefore = history.length - protectLast;

  for (let i = 0; i < compactBefore; i++) {
    const msg = history[i];
    if (msg._compacted) continue;

    if (typeof msg.content === 'string' && msg.content.includes('_internal_prep')) {
      let prepType = 'unknown';
      try { prepType = JSON.parse(msg.content)?.type || 'unknown'; } catch {}
      msg.content = `[bg-prep request: ${prepType}]`;
      msg._compacted = true;
      const nextMsg = history[i + 1];
      if (nextMsg && !nextMsg._compacted && nextMsg.role === 'assistant') {
        nextMsg.content = `[bg-prep response: ${prepType} prepared]`;
        nextMsg._compacted = true;
      }
      continue;
    }

    let content = msg.content;
    if (typeof content !== 'string') continue;

    if (msg.role === 'user') {
      // Strip _protocol blocks (verbose response format specs)
      content = content.replace(/"_protocol"\s*:\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '"_protocol":"[fmt]"');
      // Strip _perception blocks
      content = content.replace(/"_perception"\s*:\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, '"_perception":"[ctx]"');
      // Strip reference_material / available_material (large chunk arrays)
      content = content.replace(/"(?:reference_material|available_material)"\s*:\s*\[[^\]]*(?:\[[^\]]*\][^\]]*)*\]/g, '"reference_material":"[compacted]"');
      // Strip long chunk content blocks (>200 chars)
      content = content.replace(/"content"\s*:\s*"([^"]{200,})"/g, (_, c) => `"content":"${c.slice(0, 80)}…[cut]"`);
    } else if (msg.role === 'assistant') {
      // Truncate old assistant speech to save tokens
      content = content.replace(/"speech_line"\s*:\s*"([^"]{40,})"/g, (_, s) => `"speech_line":"${s.slice(0, 40)}…"`);
      content = content.replace(/"speech"\s*:\s*"([^"]{40,})"/g, (_, s) => `"speech":"${s.slice(0, 40)}…"`);
      content = content.replace(/"feedback"\s*:\s*"([^"]{40,})"/g, (_, s) => `"feedback":"${s.slice(0, 40)}…"`);
    }

    if (content !== msg.content) {
      msg.content = content;
      msg._compacted = true;
    }
  }
}

/**
 * Layer 2: Auto compact — fork LLM to summarize early history.
 * Replaces messages 2..N-20 with a single summary message.
 * Preserves: first 2 messages (init) + last 20 messages (recent context).
 * Only runs if history > 30 messages. Circuit breaker: max 2 failures per session.
 */
async function _autocompact(gameId) {
  const session = _sessions.get(gameId);
  if (!session || !_LLM) return;
  if ((session._compactFailures || 0) >= 2) return; // circuit breaker

  const history = session.history;
  if (history.length <= 30) return;

  const keepInit = 2;
  const keepRecent = 20;
  const compactEnd = history.length - keepRecent;
  if (compactEnd <= keepInit) return;

  // Extract the messages to summarize
  const toSummarize = history.slice(keepInit, compactEnd);
  const summaryInput = toSummarize.map((m, i) => {
    const content = typeof m.content === 'string' ? m.content.slice(0, 300) : '';
    const label = m.role === 'assistant' ? _t('villain.compact.label_villain') : _t('villain.compact.label_system');
    return `${label} ${content}`;
  }).join('\n');

  try {
    const summaryPrompt = _t('villain.compact.summarizer_prompt');

    // Route through session queue at background priority to avoid
    // bypassing serialization and competing with realtime calls.
    const summary = await enqueueCall(gameId, () => Promise.race([
      _LLM.chat(summaryPrompt, [{ role: 'user', content: summaryInput }], {
        max_tokens: 400,
        temperature: 0.3,
        ...(_MODEL_ID ? { model: _MODEL_ID } : {}),
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('compact timeout')), 30000)),
    ]), 'background');

    if (summary && summary.trim().length > 20) {
      // Replace compacted messages with summary
      const summaryMsg = {
        role: 'user',
        content: `${_t('villain.compact.summary_prefix')}\n\n${summary.trim()}`,
        _compacted: true,
        _compactedAt: Date.now(),
        _compactedCount: toSummarize.length,
      };
      session.history = [
        ...history.slice(0, keepInit),
        summaryMsg,
        ...history.slice(compactEnd),
      ];
      log.info('maze-agent', `auto-compact: ${gameId} compressed ${toSummarize.length} messages → 1 summary (${summary.trim().length} chars), history now ${session.history.length}`);
    }
  } catch (err) {
    session._compactFailures = (session._compactFailures || 0) + 1;
    log.warn('maze-agent', `auto-compact failed (${session._compactFailures}/2): ${(err.message || '').slice(0, 60)}`);
  }
}

// ─── Session call queue (prevents concurrent calls to the same session) ────

const _sessionQueues = new Map(); // gameId → { realtime: [], background: [], running: boolean }

function _getQueueState(gameId) {
  let state = _sessionQueues.get(gameId);
  if (!state) {
    state = { realtime: [], background: [], running: false };
    _sessionQueues.set(gameId, state);
  }
  return state;
}

async function _drainQueue(gameId, state) {
  if (state.running) return;
  state.running = true;

  while (state.realtime.length > 0 || state.background.length > 0) {
    const entry = state.realtime.length > 0 ? state.realtime.shift() : state.background.shift();
    if (!entry) continue;

    try {
      const result = await entry.fn();
      entry.resolve(result);
    } catch (err) {
      entry.reject(err);
    } finally {
      if (entry.priority === 'realtime') {
        const session = _sessions.get(gameId);
        if (session) session._realtimeInFlight = Math.max(0, (session._realtimeInFlight || 1) - 1);
      }
    }
  }

  state.running = false;
  if (state.realtime.length === 0 && state.background.length === 0) {
    _sessionQueues.delete(gameId);
  }
}

function enqueueCall(gameId, fn, priority = 'realtime') {
  const session = _sessions.get(gameId);
  if (priority === 'realtime' && session) {
    session._realtimeInFlight = (session._realtimeInFlight || 0) + 1;
  }

  return new Promise((resolve, reject) => {
    const state = _getQueueState(gameId);
    const target = priority === 'background' ? state.background : state.realtime;
    target.push({ fn, resolve, reject, priority });
    _drainQueue(gameId, state).catch(err => log.warn('maze-agent', `queue drain failed: ${(err.message || '').slice(0, 80)}`));
  });
}

// ─── Core LLM call (game history) ───────────────────────────────────────────

async function callAgent(gameId, message, timeoutMs = 30000, priority = 'realtime', policy = null) {
  // Serialize all calls to the same session to prevent history interleaving
  return enqueueCall(gameId, () => _callAgentImpl(gameId, message, timeoutMs, policy), priority);
}

/**
 * Compact a user event message for history storage.
 * Strips _protocol and _perception, keeps event core + player actions.
 * Called AFTER the LLM has seen the full message and responded.
 */
function _compactEventMessage(content) {
  if (typeof content !== 'string') return content;
  try {
    const obj = JSON.parse(content);
    if (!obj || !obj.event) return content; // not a game event, keep as-is

    // Build compact version: keep event core, strip instructions
    const compact = { event: obj.event };

    // Preserve meaningful game state
    if (obj.step != null) compact.step = obj.step;
    if (obj.hp != null) compact.hp = obj.hp;
    if (obj.card_type) compact.card_type = obj.card_type;
    if (obj.difficulty) compact.difficulty = obj.difficulty;

    // Preserve player actions and choices
    if (obj.player_input) compact.player_input = obj.player_input;
    if (obj.trial_prompt) compact.trial_prompt = obj.trial_prompt;
    if (obj.choice) compact.choice = obj.choice;
    if (obj.content) compact.content = typeof obj.content === 'string' && obj.content.length > 100
      ? obj.content.slice(0, 100) + '…' : obj.content;

    // Preserve fact_hint reference (file name only, not full content)
    if (obj._perception?.fact_hint?.source_file) {
      compact.fact_source = obj._perception.fact_hint.source_file;
    }

    return JSON.stringify(compact);
  } catch {
    return content; // not JSON, keep as-is
  }
}

async function _callAgentImpl(gameId, message, timeoutMs = 30000, policy = null) {
  const session = _sessions.get(gameId);
  if (!session || !_LLM) return null;

  // Store index so we can compact this message after LLM responds
  const userMsgIndex = session.history.length;
  session.history.push({ role: 'user', content: message });

  const MAX_RETRIES = 2;
  const MAX_TOOL_ROUNDS = (policy && !policy.allowTools) ? 0 : 3;
  const usePrefill = policy?.prefill === true;
  const prefillStr = usePrefill ? '{' : null;
  const maxTokens = policy?.maxTokens || 800;
  const toolExecutor = createToolExecutor(gameId);
  let lastErr = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const llmMessages = session.history.map(m => ({ role: m.role, content: m.content }));
        const raw = await Promise.race([
          _LLM.chat(session.systemPrompt, llmMessages, {
            max_tokens: maxTokens,
            temperature: 0.8,
            prefill: prefillStr,
            ...(_MODEL_ID ? { model: _MODEL_ID } : {}),
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('maze LLM timeout')), timeoutMs)),
        ]);

        // Reconstruct full response if prefill was used
        // Provider may not include the prefill prefix in returned text
        const fullRaw = (prefillStr && raw && !raw.trimStart().startsWith('{')) ? prefillStr + raw : raw;

        const toolCalls = parseToolCalls(fullRaw);
        session.history.push({ role: 'assistant', content: fullRaw });

        if (toolCalls.length === 0) {
          const clean = stripToolCalls(fullRaw);

          // ── Compact the user event message now that LLM has responded ──
          if (session.history[userMsgIndex]) {
            session.history[userMsgIndex].content = _compactEventMessage(session.history[userMsgIndex].content);
          }

          // ── Three-layer context compression ──
          _microcompact(session);
          if (session.history.length > 30 && !session._compactPending) {
            session._compactPending = true;
            _autocompact(gameId).catch(() => {}).finally(() => { session._compactPending = false; });
          }
          if (session.history.length > 60) {
            session.history = [...session.history.slice(0, 2), ...session.history.slice(-40)];
            log.warn('maze-agent', `hard trim: ${gameId} history capped at ${session.history.length}`);
          }

          return clean;
        }

        const results = [];
        for (const tc of toolCalls) {
          log.info('maze-agent', `tool call: ${tc.name}(${JSON.stringify(tc.input).slice(0, 100)})`);
          try {
            let result = await toolExecutor(tc.name, tc.input || {});
            let resultStr = typeof result === 'string' ? result : JSON.stringify(result);
            if (resultStr.length > 2000) resultStr = resultStr.slice(0, 2000) + '…[truncated]';
            results.push({ name: tc.name, result: resultStr });
          } catch (err) {
            results.push({ name: tc.name, result: `Error: ${err.message || String(err)}` });
          }
        }

        const toolResultMsg = results
          .map(r => `<tool_result name="${String(r.name).replace(/"/g, '&quot;')}">${r.result}</tool_result>`)
          .join('\n');
        session.history.push({ role: 'user', content: toolResultMsg });
      }

      const lastAssistant = [...session.history].reverse().find(m => m.role === 'assistant');
      const clean = stripToolCalls(lastAssistant?.content || '');

      // ── Compact the user event message after tool loop completes ──
      if (session.history[userMsgIndex]) {
        session.history[userMsgIndex].content = _compactEventMessage(session.history[userMsgIndex].content);
      }

      _microcompact(session);
      if (session.history.length > 30 && !session._compactPending) {
        session._compactPending = true;
        _autocompact(gameId).catch(() => {}).finally(() => { session._compactPending = false; });
      }
      if (session.history.length > 60) {
        session.history = [...session.history.slice(0, 2), ...session.history.slice(-40)];
        log.warn('maze-agent', `hard trim: ${gameId} history capped at ${session.history.length}`);
      }

      return clean;
    } catch (err) {
      lastErr = err;
      const errMsg = err.message || '';
      const is429 = errMsg.includes('429') || errMsg.includes('rate_limit');
      const isTimeout = errMsg.includes('timeout');

      if (is429 && attempt < MAX_RETRIES) {
        llmGate.report429();
        const retryMatch = errMsg.match(/retry.after[:\s]*(\d+)/i);
        const waitSec = Math.min(retryMatch ? parseInt(retryMatch[1]) : 3, 8);
        log.warn('maze-agent', `429 rate limit, waiting ${waitSec}s before retry ${attempt + 1}/${MAX_RETRIES}`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }

      if (isTimeout && attempt < MAX_RETRIES) {
        log.warn('maze-agent', `timeout, trimming history and retrying (${attempt + 1}/${MAX_RETRIES})`);
        if (session.history.length > 12) {
          session.history = [...session.history.slice(0, 2), ...session.history.slice(-10)];
        }
        continue;
      }

      break;
    }
  }

  log.error('maze-agent', `LLM call failed after ${MAX_RETRIES} retries: ${lastErr?.message?.slice(0, 200)}`);
  session.history.pop();
  throw lastErr || new Error('LLM call failed after retries');
}

/**
 * Prepare one background trial and store it in the ammo queue.
 * @param {string} gameId
 * @param {number} currentStep
 * @returns {Promise<void>}
 */
async function _prepTrial(gameId, currentStep) {
  const session = _sessions.get(gameId);
  if (!session || !_LLM) return;

  const message = JSON.stringify({
    event: '_internal_prep',
    type: 'trial',
    current_step: currentStep,
    _protocol: {
      response_format: {
        prompt: _t('villain.protocol.prompt_format'),
        evidence: _t('villain.protocol.evidence_format'),
        evaluation_guide: 'optional string',
        used_chunk_ids: 'optional string[]',
        confrontation_type: _t('villain.protocol.confrontation_type'),
      },
      constraints: _t('villain.constraint.bg_prep_trial'),
    },
  });

  const raw = await callAgent(gameId, message, 45000, 'background');
  if (!raw) return;

  const parsed = parseAgentResponse(raw);
  if (parsed && parsed.prompt) {
    const { isTrialUsed } = require('./trial-dedup');
    if (isTrialUsed(gameId, parsed.prompt)) {
      log.info('bg-prep', `trial already used, discarding: "${parsed.prompt.slice(0, 50)}"`);
      return;
    }
    const VALID_CT = new Set(['good', 'bad']);
    ammoQueue.addAmmo(gameId, 'trial', {
      prompt: parsed.prompt,
      evidence: parsed.evidence || '',
      evaluation_guide: parsed.evaluation_guide || '',
      used_chunk_ids: parsed.used_chunk_ids || [],
      confrontation_type: VALID_CT.has(parsed.confrontation_type) ? parsed.confrontation_type : 'unknown',
      preparedAtStep: currentStep,
      _source: 'bg-prep',
    });
    log.info('bg-prep', `trial prepared for ${gameId} at step ${currentStep}: "${parsed.prompt.slice(0, 50)}"`);
  }
}

/**
 * Prepare one background card and store it in the ammo queue.
 * @param {string} gameId
 * @param {number} currentStep
 * @returns {Promise<void>}
 */
async function _prepCard(gameId, currentStep) {
  const session = _sessions.get(gameId);
  if (!session || !_LLM) return;

  const message = JSON.stringify({
    event: '_internal_prep',
    type: 'card',
    current_step: currentStep,
    _protocol: {
      response_format: {
        speech_line: _t('villain.protocol.speech_format'),
        mood: 'optional string',
      },
      constraints: _t('villain.constraint.bg_prep_card'),
    },
  });

  const raw = await callAgent(gameId, message, 20000, 'background');
  if (!raw) return;

  const parsed = parseAgentResponse(raw);
  if (parsed && parsed.speech_line) {
    ammoQueue.addAmmo(gameId, 'card', {
      speech_line: parsed.speech_line,
      mood: parsed.mood || null,
      preparedAtStep: currentStep,
      _source: 'bg-prep',
    });
    log.info('bg-prep', `card prepared for ${gameId} at step ${currentStep}`);
  }
}

/**
 * Schedule background ammo preparation after a realtime event completes.
 * Non-blocking — errors are logged but never propagate.
 * @param {string} gameId
 * @param {number} currentStep
 */
function scheduleBackgroundPrep(gameId, currentStep) {
  const session = _sessions.get(gameId);
  if (!session || !_LLM) return;

  const qStatus = ammoQueue.status(gameId);
  session._pendingTrialPrep = session._pendingTrialPrep || 0;
  session._pendingCardPrep = session._pendingCardPrep || 0;

  // Replenish when stock (queued + pending) drops to ≤2 — gives buffer for LLM prep latency
  const trialStock = qStatus.trials + session._pendingTrialPrep;
  if (trialStock <= 2 && trialStock < ammoQueue.MAX_TRIALS) {
    session._pendingTrialPrep++;
    _prepTrial(gameId, currentStep)
      .catch(e => log.warn('bg-prep', `trial prep failed: ${(e.message || '').slice(0, 80)}`))
      .finally(() => { session._pendingTrialPrep = Math.max(0, (session._pendingTrialPrep || 1) - 1); });
  }

  const cardStock = qStatus.cards + session._pendingCardPrep;
  if (cardStock <= 2 && cardStock < ammoQueue.MAX_CARDS) {
    session._pendingCardPrep++;
    _prepCard(gameId, currentStep)
      .catch(e => log.warn('bg-prep', `card prep failed: ${(e.message || '').slice(0, 80)}`))
      .finally(() => { session._pendingCardPrep = Math.max(0, (session._pendingCardPrep || 1) - 1); });
  }
}

// ─── Event message builder ──────────────────────────────────────────────────

function buildEventMessage(eventType, eventData, perception) {
  const msg = { event: eventType };
  const _protocol = {};
  const _perception = { ...perception };

  switch (eventType) {
    case 'card': {
      Object.assign(msg, {
        step: eventData.step || 0,
        hp: eventData.hp ?? 3,
        card_type: eventData.card_type || 'calm',
      });
      _protocol.response_format = { speech_line: _t('villain.protocol.speech_format'), mood: 'optional: curious|mocking|satisfied|angry|anxious|default' };
      // Opening lines: force variety for early steps
      if ((eventData.step || 0) <= 2) {
        _protocol.constraints = _t('villain.constraint.card_opening');
      }
      // Optionally attach a fact hint for card flavor
      const cardChunks = factDb.getAvailableChunks(1);
      if (cardChunks.length > 0) {
        const cardFile = factDb.getFileById(cardChunks[0].fileId);
        _perception.fact_hint = {
          content: cardChunks[0].content,
          summary: cardChunks[0].summary,
          source_file: cardFile?.fileName || '',
          source_context: cardFile?.summary || '',
        };
        // Mark used with context from perception
        factDb.markUsed(cardChunks[0].id, perception.gameId || '', perception.step || 0, 'card');
      }
      break;
    }

    case 'trial_request': {
      Object.assign(msg, {
        step: eventData.step || 0,
        hp: eventData.hp ?? 3,
        difficulty: eventData.difficulty || 'medium',
      });
      _protocol.response_format = {
        prompt: _t('villain.protocol.prompt_format'),
        evidence: _t('villain.protocol.trial_evidence_desc'),
        evaluation_guide: _t('villain.protocol.trial_eval_guide_desc'),
        used_chunk_ids: _t('villain.protocol.trial_used_chunks_desc'),
        confrontation_type: _t('villain.protocol.trial_confrontation_desc'),
      };
      _protocol.constraints = _t('villain.constraint.trial_request');
      // Confrontation quality self-assessment prompt
      _protocol.constraints += '\n\n' + _t('villain.constraint.trial_player_language');
      _protocol.constraints += '\n\n' + _t('villain.constraint.trial_confrontation_selfeval');

      // 注入已用素材摘要，帮助 villain 避免重复
      if (perception.used_materials) {
        _protocol.constraints += '\n\n' + _t('villain.constraint.trial_used_materials_prefix') + '\n' + perception.used_materials;
      }
      // Confrontation quality tendency from recent games
      try {
        const villainMemory = require('./villain-memory');
        const cs = villainMemory.getRecentConfrontationSummary();
        if (cs.total > 0 && cs.badRate > 0.3) {
          _protocol.constraints += '\n\n' + _t('villain.constraint.trial_recent_tendency');
        }
      } catch {}
      break;
    }

    case 'trial_answer':
      Object.assign(msg, {
        trial_prompt: eventData.trial_prompt || '',
        player_input: eventData.player_input || '',
      });
      _protocol.response_format = {
        judgment: 'pass|fail',
        feedback: _t('villain.protocol.feedback_format'),
        hit: 'boolean — 这个回答是否暴露了玩家的弱点或情感反应（和 pass/fail 无关：认真剖析自己=hit，敷衍应付=非hit）',
        mood: 'optional: curious|mocking|satisfied|angry|anxious|default',
      };
      _protocol.judgment_boundary = _t('villain.constraint.trial_answer_boundary');
      break;

    case 'temptation_reaction':
      Object.assign(msg, {
        choice: eventData.choice || 'follow',
        content: eventData.content || '',
      });
      _protocol.response_format = { speech: _t('villain.protocol.speech_format'), mood: 'optional: curious|mocking|satisfied|angry|anxious|default' };
      break;

    case 'temptation_prepare': {
      const tempChunks = factDb.getAvailableChunks(1);
      if (tempChunks.length > 0) {
        const chunk = tempChunks[0];
        const file = factDb.getFileById(chunk.fileId);
        Object.assign(msg, {
          chunk_content: chunk.content,
          file_path: file ? file.path : '',
        });
        factDb.markUsed(chunk.id, perception.gameId || '', perception.step || 0, 'temptation');
      }
      _protocol.response_format = { speech: _t('villain.protocol.speech_format'), mood: 'optional: curious|mocking|satisfied|angry|anxious|default' };
      break;
    }

    case 'truth_reveal':
      Object.assign(msg, {
        flag: eventData.flag || '',
        flag_meaning: eventData.flag_meaning || '',
      });
      _protocol.response_format = {
        revelation: _t('villain.protocol.truth_revelation_desc'),
        mood: 'optional: curious|mocking|satisfied|angry|anxious|default',
      };
      _protocol.constraints = _t('villain.constraint.truth_reveal');
      break;

    case 'intro': {
      Object.assign(msg, {
        game_number: eventData.game_number || 1,
        wins: eventData.wins || 0,
        deaths: eventData.deaths || 0,
        has_memory: eventData.has_memory || false,
      });
      _protocol.response_format = {
        lines: _t('villain.protocol.intro_lines_desc'),
        mood: 'optional: curious|mocking|satisfied|angry|anxious|default',
      };
      _protocol.constraints = _t('villain.constraint.intro');
      break;
    }

    case 'game_end':
      Object.assign(msg, {
        turns: eventData.turns || 0,
        outcome: eventData.outcome || 'unknown',
      });
      _protocol.response_format = { speech: _t('villain.protocol.speech_format') };
      break;

    case 'epilogue':
      Object.assign(msg, {
        turns: eventData.turns || 0,
        outcome: eventData.outcome || 'unknown',
        hp: eventData.hp || 0,
        godHand: eventData.godHand || 0,
        trialPassed: eventData.trialPassed || 0,
        trialFailed: eventData.trialFailed || 0,
        backtracks: eventData.backtracks || 0,
      });
      _protocol.response_format = {
        epilogue: _t('villain.protocol.epilogue_desc'),
        mood: 'optional: curious|mocking|satisfied|angry|anxious|default',
      };
      _protocol.constraints = _t('villain.constraint.epilogue');
      break;

    default:
      Object.assign(msg, eventData);
      break;
  }

  // ── Inject event-level behavioral constraints from policy ──
  const policy = EVENT_POLICIES[eventType];
  if (policy && !policy.allowTools) {
    const toolConstraint = _t('villain.constraint.no_tools');
    _protocol.constraints = _protocol.constraints
      ? _protocol.constraints + '\n\n' + toolConstraint
      : toolConstraint;
  }

  // ── Trim perception: remove constants & event-level duplicates ──
  delete _perception.gameId;
  delete _perception.game_number;
  delete _perception.max_hp;
  if (_perception.step === msg.step) delete _perception.step;
  if (_perception.hp === msg.hp) delete _perception.hp;

  msg._protocol = _protocol;
  msg._perception = _perception;

  return JSON.stringify(msg);
}

// ─── Session lifecycle ───────────────────────────────────────────────────────

async function startSession(gameId) {
  if (!_LLM) {
    log.error('maze-agent', 'LLM not initialized — call init(ctx) first');
    return null;
  }

  const systemPrompt = buildMazeSystemPrompt(_SOUL_PATH);

  _sessions.set(gameId, {
    history: [],
    systemPrompt,
    started: Date.now(),
    _realtimeInFlight: 0,
    _pendingTrialPrep: 0,
    _pendingCardPrep: 0,
  });
  llmGate.setGameActive(true);

  log.info('maze-agent', `session created: ${gameId} (system prompt ${systemPrompt.length} chars${_MODEL_ID ? ', model: ' + _MODEL_ID : ''})`);

  // Inject player profile + episodic memory if available
  const playerProfile = require('./player-profile');
  const villainMemory = require('./villain-memory');
  const profileText = playerProfile.getProfileForInjection();
  const episodicText = villainMemory.getEpisodicInjection();

  let initMsg = '';
  if (profileText) {
    initMsg += `${_t('villain.init.profile_intro')}\n\n${profileText}\n\n`;
  }
  if (episodicText) {
    initMsg += `${episodicText}\n\n`;
  }
  const themes = themeCluster.getThemes();
  if (themes.length > 0) {
    const overview = themes
      .map((theme, index) => `${index + 1}. ${theme.name}（${Array.isArray(theme.fileIds) ? theme.fileIds.length : 0}个文件）— ${theme.description || '无描述'}`)
      .join('\n');
    initMsg += `${_t('villain.init.themes_prefix')}\n${overview}\n\n`;
  }
  initMsg += _t('villain.init.game_start');
  let response;
  try {
    response = await callAgent(gameId, initMsg, 30000);
  } catch (e) {
    _sessions.delete(gameId);
    throw new Error(_t('villain.init.connection_failed') + (e.message || '').slice(0, 200));
  }

  if (!response) {
    _sessions.delete(gameId);
    throw new Error(_t('villain.init.session_failed') + gameId);
  }

  log.info('maze-agent', `session ready: ${gameId}`);
  return response;
}

async function sendEvent(gameId, event) {
  if (!_sessions.has(gameId)) {
    log.warn('maze-agent', `no session for ${gameId}`);
    return null;
  }
  const message = typeof event === 'string' ? event : JSON.stringify(event);

  // Extract event type for circuit breaker tracking + policy lookup
  let eventType = 'unknown';
  try {
    const parsed = typeof event === 'string' ? JSON.parse(event) : event;
    eventType = parsed?.event || 'unknown';
  } catch {}

  // Resolve policy for this event type
  const policy = EVENT_POLICIES[eventType] || DEFAULT_POLICY;

  // Circuit breaker: skip if this event type is tripped
  if (eventType !== 'unknown' && _circuitBreaker.shouldSkip(eventType)) {
    log.info('circuit-breaker', `skipping "${eventType}" for ${gameId} (breaker tripped)`);
    return null;
  }

  const result = await callAgent(gameId, message, 30000, 'realtime', policy);

  // Record success/failure for circuit breaker
  if (eventType !== 'unknown') {
    _circuitBreaker.record(eventType, result !== null);
  }

  return result;
}

/**
 * Like sendEvent but at background priority — won't block realtime judge/card calls.
 * Used for trial notes and other non-urgent session injections.
 */
async function sendEventBackground(gameId, event) {
  if (!_sessions.has(gameId)) return null;
  const message = typeof event === 'string' ? event : JSON.stringify(event);
  return callAgent(gameId, message, 20000, 'background');
}

async function endSession(gameId) {
  if (!_sessions.has(gameId)) return;
  _sessions.delete(gameId);
  _sessionQueues.delete(gameId);
  if (_sessions.size === 0) llmGate.setGameActive(false);
  log.info('maze-agent', `session ended: ${gameId}`);
}

function hasSession(gameId) {
  return _sessions.has(gameId);
}

function getLastTrialChunkIds(gameId) {
  const session = _sessions.get(gameId);
  return session?._lastTrialChunkIds || [];
}

function getSessionKey(gameId) {
  return hasSession(gameId) ? `maze-${gameId}` : null;
}

// ─── JSON parsing helper ─────────────────────────────────────────────────────

function parseAgentResponse(raw) {
  if (!raw) return null;

  function unwrap(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    // glm-5-turbo sometimes wraps the actual response inside "response_format"
    if (obj.response_format && typeof obj.response_format === 'object') {
      return obj.response_format;
    }
    return obj;
  }

  try { return unwrap(JSON.parse(raw)); } catch {}

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      let cleaned = jsonMatch[0]
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .replace(/,\s*([}\]])/g, '$1');
      return unwrap(JSON.parse(cleaned));
    } catch {}
  }

  // Strip markdown/JSON artifacts before using as fallback speech
  const cleaned = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .replace(/^\s*\{\s*"speech[_line"]*\s*:\s*"/i, '')
    .replace(/"\s*\}\s*$/, '')
    .trim();
  return { speech_line: (cleaned || '……').slice(0, 25) };
}

module.exports = {
  init,
  startSession,
  sendEvent,
  sendEventBackground,
  endSession,
  hasSession,
  getLastTrialChunkIds,
  getSessionKey,
  parseAgentResponse,
  buildEventMessage,
  writeVillainNote,
  readVillainNotes,
  createToolExecutor,
  parseToolCalls,
  stripToolCalls,
  scheduleBackgroundPrep,
  circuitBreakerStats: () => _circuitBreaker.stats(),
};
