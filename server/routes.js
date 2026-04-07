'use strict';

// ─── HTTP Route Handlers ──────────────────────────────────────────────────────
// Factory: createRoutes(ctx) returns the (req, res) handler.
// ctx contains shared state: LLM, API_KEY, SOUL_PATH, PERSONALITY_CONTEXT, etc.

const fs   = require('fs');
const path = require('path');
const { loadPersonality } = require('./memory');
const { getCached, setCached, judgePipeline, computeHpCost } = require('./judge');
const sessionMemory = require('./session-memory');
const log = require('./utils/logger');
const { readBody, fallbackJudge, fallbackCard } = require('./llm-helpers');
const { isTrialUsed, recordUsedTrial, cleanupUsedTrials, getNextFixedTrial } = require('./trial-dedup');
const { getLureMaterials, getCachedEntry, scrubSensitiveLines } = require('./vision-cache');
const factDb = require('./fact-db');
const archivist = require('./archivist');
const lureAllocator = require('./lure-allocator');
const { getScanRoots } = require('./file-scanner');
const mazeAgent = require('./maze-agent');
const ammoQueue = require('./ammo-queue');
const topicState = require('./topic-state');
const themeCluster = require('./theme-cluster');
const playerProfile = require('./player-profile');
const { getIntegrationHealth } = require('./integration-health');
const { createLLMClient, readAuthProfiles, readGatewayConfig } = require('./provider');

const _usedMaterials = new Map(); // gameId → string[] (最近 3 条短摘要)
const _endedGames = new Set();   // gameIds that have received game_end but may still have in-flight async
const _lastTrialAnswer = new Map(); // gameId → { input, result } for exact-repeat short-circuit
const _trialConfrontations = new Map(); // gameId → [confrontation_type, ...] — server-authoritative confrontation labels

const ROLE_TO_CARD_TYPE = { pressure:'blocker', temptation:'lure', relief:'calm', trial:'drain', truth:'calm', payoff:'calm' };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
};

/**
 * @param {object} ctx - Shared mutable state
 * @param {object} ctx.LLM
 * @param {string} ctx.API_KEY
 * @param {string} ctx.SOUL_PATH
 * @param {string} ctx.PERSONALITY_CONTEXT
 * @param {string} ctx.PROVIDER
 * @param {string} ctx.ACTIVE_MODEL
 * @param {string} ctx.OPENAI_KEY
 * @param {string} ctx.ANTHROPIC_KEY
 * @param {string} ctx.GAME_DIR
 * @param {function} ctx.sessionLog
 */
function createRoutes(ctx) {

  // ── Backend locale helper ──
  function _t(key, params) {
    const locale = require('./locales/' + (ctx.LOCALE || 'zh'));
    let s = locale[key] || require('./locales/zh')[key] || key;
    if (params) {
      for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
    }
    return s;
  }

  // Wrap sessionLog to drop events for games that have already ended.
  // Reflection / villain-memory writes go through their own paths, not sessionLog.
  const _rawSessionLog = ctx.sessionLog;
  ctx.sessionLog = (gameId, data) => {
    if (gameId && _endedGames.has(gameId) && data.event !== 'game_end') {
      log.debug('session-log', `dropped post-end event "${data.event}" for ${gameId}`);
      return;
    }
    _rawSessionLog(gameId, data);
  };

  function buildProviderConfig(payload = {}) {
    const requestedProvider = String(payload.provider || '').trim() || ctx.PROVIDER;
    const requestedModel = String(payload.model || '').trim() || ctx.ACTIVE_MODEL || 'openclaw/default';
    const requestedApiBase = String(payload.apiBase || '').trim();
    const requestedApiKey = String(payload.apiKey || '').trim();

    if (!requestedProvider) {
      throw new Error(_t('error.provider_empty'));
    }

    if (requestedProvider === 'openclaw-gateway') {
      const gateway = readGatewayConfig();
      if (!gateway) throw new Error(_t('error.no_gateway'));
      return {
        provider: 'openclaw-gateway',
        apiKey: gateway.token,
        apiBase: gateway.apiBase,
        model: requestedModel,
        fastModel: requestedModel,
        source: gateway.source,
      };
    }

    if (requestedProvider === 'anthropic') {
      let key = requestedApiKey;
      if (!key) {
        const profiles = readAuthProfiles();
        for (const [profileKey, val] of Object.entries(profiles)) {
          if (profileKey.startsWith('anthropic:')) {
            key = val?.token || val?.key || val?.apiKey || '';
            if (key) break;
          }
        }
      }
      if (!key) throw new Error(_t('error.anthropic_key_empty'));
      return {
        provider: 'anthropic',
        apiKey: key,
        apiBase: '',
        model: requestedModel,
        fastModel: requestedModel,
        source: requestedApiKey ? _t('source.manual_anthropic') : _t('source.auth_profiles'),
      };
    }

    if (requestedProvider === 'openai') {
      let key = requestedApiKey;
      if (!key) {
        const profiles = readAuthProfiles();
        for (const [profileKey, val] of Object.entries(profiles)) {
          if (profileKey.startsWith('openai:') && val?.type !== 'oauth') {
            key = val?.token || val?.key || val?.apiKey || '';
            if (key) break;
          }
        }
      }
      if (!key) throw new Error(_t('error.openai_key_empty'));
      return {
        provider: 'openai',
        apiKey: key,
        apiBase: requestedApiBase || 'https://api.openai.com/v1',
        model: requestedModel,
        fastModel: requestedModel,
        source: requestedApiKey
          ? (requestedApiBase ? _t('source.manual_openai_base', { base: requestedApiBase }) : _t('source.manual_openai'))
          : _t('source.auth_profiles'),
      };
    }

    // "custom" = OpenAI-compatible with user-provided apiBase
    if (requestedProvider === 'custom') {
      if (!requestedApiKey) throw new Error(_t('error.custom_key_empty'));
      if (!requestedApiBase) throw new Error(_t('error.custom_base_empty'));
      return {
        provider: 'openai',
        apiKey: requestedApiKey,
        apiBase: requestedApiBase,
        model: requestedModel,
        fastModel: requestedModel,
        source: _t('source.custom_api', { base: requestedApiBase }),
      };
    }

    throw new Error(_t('error.unsupported_provider', { provider: requestedProvider }));
  }

  function feedbackTooGeneric(feedback, signals) {
    const text = (feedback || '').trim();
    if (!text) return true;
    if (!signals || signals.length === 0) return false;
    const genericRe = /^(不够。?|敷衍。?|太敷衍了。?|太表面了。?|不对。?|还是不够。?|还是在回避。?|你在回避问题。?|你在回避问题本身。?)$/;
    return genericRe.test(text);
  }

  return function handleRequest(req, res) {
    _handleRequestAsync(req, res).catch(err => {
      log.error('routes', `unhandled error: ${(err.message || '').slice(0, 200)}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal server error' }));
      }
    });
  };

  async function _handleRequestAsync(req, res) {
    const origin = req.headers.origin || '';
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // POST /api/lure/used — front-end notifies when temptation uses a lure material
    if (req.method === 'POST' && req.url === '/api/lure/used') {
      const data = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(data); } catch {}
      if (parsed.path || parsed.name) {
        lureAllocator.markUsed({ path: parsed.path, name: parsed.name }, 'temptation');
        // Also mark in fact-db: find chunk by file path and mark used
        const file = factDb.getFileByPath(parsed.path);
        if (file && file.chunks && file.chunks.length > 0) {
          for (const cid of file.chunks) {
            factDb.markUsed(cid, parsed.gameId || '', 0, 'temptation-frontend');
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // POST /api/hp-event — Unified HP change tracking (client reports all HP changes)
    if (req.method === 'POST' && req.url === '/api/hp-event') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}
      const gameId = data.gameId || null;
      if (gameId) {
        ctx.sessionLog(gameId, {
          event: 'hp_change',
          cause: data.cause || 'unknown',
          delta: data.delta || 0,
          hpBefore: data.hpBefore ?? null,
          hpAfter: data.hpAfter ?? null,
          step: data.step ?? null,
        });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // POST /api/card
    if (req.method === 'POST' && req.url === '/api/card') {
      let gs = {};
      try { gs = JSON.parse(await readBody(req)); } catch {}
      if (gs.step != null && gs.steps == null) gs.steps = gs.step;
      if (gs.hp == null && gs.health != null) gs.hp = gs.health;
      const role   = gs.forced_role || null;
      const gameId = gs.gameId || null;
      const forcedCardType = role && ROLE_TO_CARD_TYPE[role] ? ROLE_TO_CARD_TYPE[role] : null;

      if (gameId && mazeAgent.hasSession(gameId)) {
        const cached = ammoQueue.getAmmo(gameId, 'card');
        if (cached && !ammoQueue.isStale(cached, gs.steps || 0)) {
          log.info('card', 'served from ammo queue');
          const cardType = forcedCardType || 'calm';
          ctx.sessionLog(gameId, { event: 'card', step: gs.steps, card_type: cardType, speech: cached.speech_line, source: 'ammo-queue' });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ card_type: cardType, speech_line: cached.speech_line, mood: cached.mood, _agent: 'ammo-queue' }));
          mazeAgent.scheduleBackgroundPrep(gameId, gs.steps || 0);
          return;
        }
      }

      // ── v2: maze-agent gateway call ──
      if (gameId && mazeAgent.hasSession(gameId)) {
        try {
          const cardType = forcedCardType || 'calm';
          const perception = {
            gameId,
            step: gs.steps || 0, hp: gs.hp ?? 3, max_hp: 3,
            exit_distance: gs.distance_to_exit_raw ?? null,
            backtrack_ratio: gs.backtrack_ratio ?? null,
            game_number: gs.game_number ?? 1,
            recent_cards: gs.recent_cards || [],
            behavior: gs.behavior || null,
          };
          const eventMsg = mazeAgent.buildEventMessage('card', {
            step: gs.steps || 0, hp: gs.hp ?? 3, card_type: cardType,
          }, perception);
          const raw = await mazeAgent.sendEvent(gameId, eventMsg);
          const parsed = mazeAgent.parseAgentResponse(raw);
          if (parsed && parsed.speech_line) {
            ctx.sessionLog(gameId, { event: 'card', step: gs.steps, hp: gs.hp, card_type: cardType, speech: parsed.speech_line, villain: true, agent: 'maze-v2' });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ card_type: cardType, speech_line: parsed.speech_line, mood: parsed.mood || null, _agent: 'maze-v2' }));
            mazeAgent.scheduleBackgroundPrep(gameId, gs.steps || 0);
            return;
          }
        } catch (e) {
          log.warn('maze-agent', 'v2 card failed, falling through: ' + (e.message || '').slice(0, 100));
        }
      }

      // ── Static fallback (v2 failed or no session) ──
      log.warn('routes', 'card fallback (no v2 session): gameId=' + (gs.gameId || 'none'));
      const fb = fallbackCard(gs);
      if (forcedCardType) fb.card_type = forcedCardType;
      ctx.sessionLog(gameId, { event: 'card', step: gs.steps, depth: gs.depth, hp: gs.hp, card_type: fb.card_type, speech: fb.speech_line, villain: false, fallback: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fb));
      return;
    }

    // POST /api/fill/trial
    if (req.method === 'POST' && req.url === '/api/fill/trial') {
      let gs = {};
      try { gs = JSON.parse(await readBody(req)); } catch {}

      if (gs.gameId && mazeAgent.hasSession(gs.gameId)) {
        const cached = ammoQueue.getAmmo(gs.gameId, 'trial');
        if (cached && !ammoQueue.isStale(cached, gs.steps || 0) && !isTrialUsed(gs.gameId, cached.prompt)) {
          log.info('trial', `served from ammo queue (prepared at step ${cached.preparedAtStep})`);
          const cachedCT = cached.confrontation_type || 'unknown';
          // Store confrontation_type in server-authoritative Map (same as live trial path)
          if (!_trialConfrontations.has(gs.gameId)) _trialConfrontations.set(gs.gameId, []);
          _trialConfrontations.get(gs.gameId).push(cachedCT);
          const trialResult = {
            prompt: cached.prompt,
            evidence: cached.evidence || '',
            evaluation_guide: cached.evaluation_guide || '',
            hint: '',
            confrontation_type: cachedCT,
            _source: 'ammo-queue',
          };
          recordUsedTrial(gs.gameId, trialResult.prompt, null);
          ctx.sessionLog(gs.gameId, { event: 'trial_generated', prompt: trialResult.prompt, source: 'ammo-queue', confrontation_type: cachedCT });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(trialResult));
          mazeAgent.scheduleBackgroundPrep(gs.gameId, gs.steps || 0);
          return;
        }
      }

      // ── v2: maze-agent trial generation ──
      if (gs.gameId && mazeAgent.hasSession(gs.gameId)) {
        try {
          const perception = {
            gameId: gs.gameId,
            step: gs.steps || 0, hp: gs.hp ?? 3,
            trial_number: gs.trial_number || 1,
            past_trial_topics: gs.past_trial_topics || [],
            topic_signal: topicState.buildSignalBlock(gs.gameId) || null,
            game_number: gs.game_number ?? 1,
            behavior: gs.behavior || null,
            used_materials: (_usedMaterials.get(gs.gameId) || []).length > 0
              ? (_usedMaterials.get(gs.gameId) || []).map((m, i) => `${i+1}. ${m}`).join('\n')
              : null,
          };
          const eventMsg = mazeAgent.buildEventMessage('trial_request', {
            step: gs.steps || 0, hp: gs.hp ?? 3,
            difficulty: gs.difficulty || 'medium',
          }, perception);
          const raw = await mazeAgent.sendEvent(gs.gameId, eventMsg);
          const parsed = mazeAgent.parseAgentResponse(raw);
          if (!parsed || !parsed.prompt) {
            log.warn('trial', `v2 trial returned unusable response: raw=${(raw || '').slice(0, 100)}, parsed=${JSON.stringify(parsed).slice(0, 100)}`);
          }
          if (parsed && parsed.prompt && !isTrialUsed(gs.gameId, parsed.prompt)) {
            // Sanitize confrontation_type (server-authoritative)
            const VALID_CONFRONTATIONS = new Set(['good', 'bad']);
            const confrontationType = VALID_CONFRONTATIONS.has(parsed.confrontation_type) ? parsed.confrontation_type : 'unknown';
            // Store in per-game Map (server is the truth source)
            if (!_trialConfrontations.has(gs.gameId)) _trialConfrontations.set(gs.gameId, []);
            _trialConfrontations.get(gs.gameId).push(confrontationType);

            const trialResult = {
              prompt: parsed.prompt,
              evidence: parsed.evidence || '',
              evaluation_guide: parsed.evaluation_guide || _t('trial.eval_default'),
              hint: '',
              confrontation_type: confrontationType,
              _source: 'maze-v2',
            };
            recordUsedTrial(gs.gameId, trialResult.prompt, null);
            // ── 素材使用反馈：按 agent 返回的 chunk IDs 标记 actual use ──
            if (Array.isArray(parsed.used_chunk_ids)) {
              for (const cid of parsed.used_chunk_ids) {
                if (typeof cid === 'string') {
                  factDb.markUsed(cid, gs.gameId, gs.steps || 0, 'trial-actual');
                }
              }
            }
            // ── 维护 usedMaterials 短摘要（最近 3 条）──
            if (!_usedMaterials.has(gs.gameId)) _usedMaterials.set(gs.gameId, []);
            const matList = _usedMaterials.get(gs.gameId);
            const matSummary = (parsed.evidence || parsed.prompt || '').slice(0, 40);
            if (matSummary) matList.push(matSummary);
            if (matList.length > 3) matList.shift();
            log.info('trial', `v2 trial: "${trialResult.prompt.slice(0, 50)}"`);
            ctx.sessionLog(gs.gameId, { event: 'trial_generated', prompt: trialResult.prompt, source: 'maze-v2', difficulty: gs.difficulty || 'medium' });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(trialResult));
            mazeAgent.scheduleBackgroundPrep(gs.gameId, gs.steps || 0);
            return;
          }
        } catch (e) {
          log.warn('maze-agent', 'v2 trial failed, falling through: ' + (e.message || '').slice(0, 100));
        }
      }
      // ── Static fallback (v2 failed or no session) ──
      log.warn('routes', 'trial fallback (v2 failed or no session): gameId=' + (gs.gameId || 'none'));
      const fixed = getNextFixedTrial(gs.gameId || null, gs.difficulty || 'medium');
      recordUsedTrial(gs.gameId || null, fixed.prompt, null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fixed));
      return;
    }

    // POST /api/judge/answer
    if (req.method === 'POST' && req.url === '/api/judge/answer') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}
      // Normalize field names
      if (data.answer != null && data.player_input == null) data.player_input = data.answer;
      if (data.prompt != null && data.trial_prompt == null) data.trial_prompt = data.prompt;
      if (data.step != null && data.steps == null) data.steps = data.step;
      const _judgeGameId = data.gameId || null;
      ctx.sessionLog(_judgeGameId, { event: 'player_answer', prompt: data.trial_prompt || '', answer: data.player_input || '', hp: data.hp, steps: data.steps });

      // ── Exact-repeat short-circuit: same answer as last submission → return cached result instantly ──
      const _repeatKey = (_judgeGameId || '_') + ':' + (data.trial_prompt || '');
      const _trimmedInput = (data.player_input || '').trim().replace(/[\s。，．.,、!！?？;；:：…]+$/g, '');
      if (_lastTrialAnswer.has(_repeatKey) && _lastTrialAnswer.get(_repeatKey).input === _trimmedInput) {
        const prev = _lastTrialAnswer.get(_repeatKey).result;
        log.info('judge', 'exact-repeat short-circuit');
        ctx.sessionLog(_judgeGameId, { event: 'judgment', ...prev, player_input: data.player_input, _repeat: true });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(prev));
        return;
      }

      // ── v2: maze-agent judgment ──
      if (_judgeGameId && mazeAgent.hasSession(_judgeGameId)) {
        try {
          const perception = {
            fail_count: data.fail_count || 0,
            gameId: _judgeGameId,
            step: data.steps || 0, hp: data.hp ?? 3,
            behavior: data.behavior || null,
            topic_signal: topicState.buildSignalBlock(_judgeGameId) || null,
          };
          const eventMsg = mazeAgent.buildEventMessage('trial_answer', {
            trial_prompt: data.trial_prompt || '',
            player_input: data.player_input || '',
          }, perception);
          const raw = await mazeAgent.sendEvent(_judgeGameId, eventMsg);
          const parsed = mazeAgent.parseAgentResponse(raw);
          if (!parsed || !parsed.judgment) {
            log.warn('judge', `v2 judge returned unusable response: raw=${(raw || '').slice(0, 100)}`);
          }
          if (parsed && parsed.judgment) {
            const hit = parsed.hit === true || parsed.hit === 'true';
            const result = {
              judgment: parsed.judgment,
              feedback: parsed.feedback || (parsed.judgment === 'pass' ? _t('judge.fallback.pass') : _t('judge.fallback.fail')),
              hp_cost: parsed.hp_cost ?? (parsed.judgment === 'fail' ? ((data.fail_count || 0) >= 2 ? 0 : 1) : 0),
              mood: parsed.mood || null,
              hit,
              _agent: 'maze-v2',
            };
            setCached(data.trial_prompt, data.player_input, result);
            _lastTrialAnswer.set(_repeatKey, { input: _trimmedInput, result });
            topicState.recordTopic(_judgeGameId, {
              prompt: data.trial_prompt, playerInput: data.player_input,
              judgment: result.judgment, hit, step: data.steps || 0,
              memoryUpdate: parsed.memory_update || null,
            });
            ctx.sessionLog(_judgeGameId, { event: 'judgment', ...result, player_input: data.player_input });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            if (_judgeGameId && mazeAgent.hasSession(_judgeGameId)) {
              mazeAgent.scheduleBackgroundPrep(_judgeGameId, data.steps || 0);
            }
            // Trigger async profile update (non-blocking)
            try {
              playerProfile.incrementalUpdate({
                trial_prompt: data.trial_prompt,
                player_input: data.player_input,
                judgment: result.judgment,
                behavior_snapshot: data.behavior || null,
              }).catch(e => log.warn('player-profile', 'async update failed: ' + (e.message || '').slice(0, 60)));
            } catch {}
            // Trial note + episodic memory are now written by /api/trial/complete
            // (single summary at trial conclusion, not per-judgment)
            // Fact-db hit/miss feedback still happens per-judgment for real-time chunk scoring
            try {
              const usedChunkIds = mazeAgent.getLastTrialChunkIds(_judgeGameId);
              for (const cid of usedChunkIds) {
                factDb.recordHit(cid, hit);
              }
            } catch {}
            return;
          }
        } catch (e) {
          log.warn('maze-agent', 'v2 judge failed, falling through: ' + (e.message || '').slice(0, 100));
        }
      }

      // ── Unified judgment pipeline (non-v2 path) ──
      const _pipeResult = judgePipeline({
        trialPrompt: data.trial_prompt,
        playerInput: data.player_input,
        evaluationGuide: data.evaluation_guide,
        failCount: data.fail_count || 0,
        trialNumber: data.trial_number || 1,
      });
      if (_pipeResult.handled) {
        if (_pipeResult.mercy) {
          ctx.sessionLog(_judgeGameId, { event: 'trial_mercy_pass', fail_count: data.fail_count || 0, input_length: (data.player_input || '').trim().length });
        }
        _lastTrialAnswer.set(_repeatKey, { input: _trimmedInput, result: _pipeResult.result });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(_pipeResult.result));
        return;
      }

      // ── Static fallback (all non-LLM paths exhausted) ──
      {
        log.warn('routes', 'static fallback: /api/judge/answer (gameId=' + (_judgeGameId || 'none') + ')');
        log.warn('judge', 'all paths missed, using static fallback');
        const result = fallbackJudge(data.player_input, data.trial_prompt, data.evaluation_guide);
        result.hp_cost = computeHpCost(result.judgment, data.trial_number || 1, data.fail_count || 0);
        _lastTrialAnswer.set(_repeatKey, { input: _trimmedInput, result });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      }
      return;
    }

    // POST /api/trial/complete — Trial summary at conclusion (replaces per-judgment notes)
    if (req.method === 'POST' && req.url === '/api/trial/complete') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}
      const gameId = data.gameId || null;
      const attempts = Array.isArray(data.attempts) ? data.attempts : [];
      const uniqueAnswers = data.uniqueAnswers || 0;
      const exitMethod = data.exitMethod || 'unknown'; // 'pass' | 'god_hand' | 'retreat'
      const totalTimeMs = data.totalTimeMs || 0;
      const prompt = data.prompt || '';
      const step = data.step || 0;

      // ── Confrontation type (server-authoritative, client value is fallback only) ──
      const serverConfrontations = _trialConfrontations.get(gameId) || [];
      const confrontationType = serverConfrontations.pop() || data.confrontation_type || 'unknown';

      // ── Quality assessment ──
      const totalAttempts = attempts.length;
      const hitCount = attempts.filter(a => a.hit).length;
      const passCount = attempts.filter(a => a.passed).length;
      const firstAnswer = attempts[0]?.input || '';
      const firstHit = attempts[0]?.hit || false;
      // Detect repeated answers (player spamming same text)
      const repeatRate = totalAttempts > 1 ? (1 - uniqueAnswers / totalAttempts).toFixed(2) : '0';

      // Quality: good (real engagement), bad (question broken), disputed (player disagrees with judgment), no_engagement
      let quality = 'no_engagement';
      if (totalAttempts >= 2 && !firstHit && /不知道|什么意思|听不懂|看不懂|idk|what/i.test(firstAnswer)) {
        quality = 'bad';
      } else if (totalAttempts >= 3 && uniqueAnswers <= 1 && hitCount > 0) {
        quality = 'disputed';
      } else if (totalAttempts >= 3 && uniqueAnswers <= 1) {
        quality = 'bad';
      } else if (hitCount > 0) {
        quality = 'good';
      }

      // ── Build summary note for villain session ──
      const exitLabels = { pass: _t('trial.exit.pass'), god_hand: _t('trial.exit.god_hand'), retreat: _t('trial.exit.retreat') };
      const answerSummary = attempts.length > 0
        ? attempts.map((a, i) => `  ${i+1}. 「${(a.input || '').slice(0, 30)}」${a.passed ? '✓' : '✗'}${a.hit ? '💥' : ''}`).join('\n')
        : _t('trial.summary.no_answers');

      const qualityLabels = { good: _t('trial.quality.good'), bad: _t('trial.quality.bad'), disputed: _t('trial.quality.disputed'), no_engagement: _t('trial.quality.no_engagement') };
      const summaryNote = _t('trial.summary_template', {
        step: String(step),
        prompt: prompt.slice(0, 60),
        confrontationType,
        qualityLabel: qualityLabels[quality] || quality,
        exitLabel: exitLabels[exitMethod] || exitMethod,
        totalAttempts: String(totalAttempts),
        uniqueAnswers: String(uniqueAnswers),
        answerSummary,
      });

      // ── Write to villain session (background) ──
      if (gameId && mazeAgent.hasSession(gameId)) {
        const noteWithMemoryPrompt = summaryNote + '\n\n' + _t('trial.summary.memory_prompt');
        mazeAgent.sendEventBackground(gameId, noteWithMemoryPrompt).then(raw => {
          if (!raw) return;
          try {
            const parsed = mazeAgent.parseAgentResponse(raw);
            if (parsed && parsed.memory_update) {
              const topicState = require('./topic-state');
              topicState.mergeWorkingMemory(gameId, parsed.memory_update);
            }
          } catch {}
        }).catch(() => {});
      }

      // ── Write single episode to episodic memory ──
      try {
        const villainMemory = require('./villain-memory');
        villainMemory.recordEpisode(gameId, {
          type: 'trial',
          step,
          material: prompt,
          playerResponse: attempts.map(a => a.input).filter((v, i, arr) => arr.indexOf(v) === i).join(' / '),
          outcome: passCount > 0 ? 'pass' : 'fail',
          hit: hitCount > 0,
          exitMethod,
          quality,
          confrontation_type: confrontationType,
          attemptCount: totalAttempts,
          uniqueAnswers,
        });
      } catch {}

      // ── Session log ──
      ctx.sessionLog(gameId, {
        event: 'trial_complete',
        prompt: prompt.slice(0, 80),
        exitMethod,
        quality,
        confrontation_type: confrontationType,
        attempts: totalAttempts,
        uniqueAnswers,
        hitCount,
        totalTimeMs,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, quality }));
      return;
    }

    // POST /api/villain/start
    if (req.method === 'POST' && req.url === '/api/villain/start') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}
      const gameId = data.gameId || `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const playerId = data.playerId || 'default';
      const crossGameCtx = sessionMemory.buildCrossGameContext(playerId);
      // Clean up stale ended-game markers (keep set bounded)
      if (_endedGames.size > 10) _endedGames.clear();
      lureAllocator.startGame(gameId);

      // ── v2.1: start maze-agent direct LLM session ──
      try {
        mazeAgent.init(ctx); // ensure LLM client is set (ctx.LLM may not exist at import time)
        require('./prompts').initLocale(ctx);
        require('./memory').initLocale(ctx);
        require('./villain-memory').initLocale(ctx);
        require('./judge').initLocale(ctx);
        require('./llm-helpers').initLocale(ctx);
        require('./vision-cache').initLocale(ctx);
        sessionMemory.initLocale(ctx);
        playerProfile.init(ctx);
        await mazeAgent.startSession(gameId);
        log.info('maze-agent', `v2 session started for ${gameId}`);
      } catch (e) {
        const errMsg = (e.message || '').slice(0, 200);
        log.error('maze-agent', `session start failed: ${errMsg}`);
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          error: _t('error.llm_connection_failed', { message: errMsg }),
          gameId,
        }));
        return;
      }

      ctx.sessionLog(gameId, { event: 'game_start', gameId, playerId, hasCrossGameMemory: !!crossGameCtx });
      log.info('game', `session started: ${gameId} (cross-game memory: ${crossGameCtx ? 'yes' : 'none'})`);

      // Archivist runs at server startup (see server.js), not per-game

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, gameId, hasCrossGameMemory: !!crossGameCtx }));

      // Cold-start preload: populate ammo-queue while player is still in boot sequence
      try { mazeAgent.scheduleBackgroundPrep(gameId, 0); } catch {}

      return;
    }

    // POST /api/villain/end
    if (req.method === 'POST' && req.url === '/api/villain/end') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}
      const { gameId, playerId, outcome, totalSteps, finalHp, maxHp,
              cardStats, villainSuccessCards, trialStats, godHandCount, temptationStats, decisions } = data;
      const turns = totalSteps || 0;
      try {
        sessionMemory.writeGameSummary(playerId || 'default', {
          gameId, outcome, totalSteps, finalHp, maxHp,
          cardStats, villainSuccessCards, trialStats, godHandCount, temptationStats, decisions,
        });
      } catch (memErr) { log.warn('session-memory', 'failed to write summary:', memErr.message); }
      // ── Villain episodic reflection BEFORE session teardown ──
      let _reflectionDone = Promise.resolve();
      if (gameId && mazeAgent.hasSession(gameId)) {
        const villainMemory = require('./villain-memory');
        const reflectPrompt = _t('villain.reflect_prompt', { outcome: outcome || '?', turns: String(turns || 0) });
        _reflectionDone = mazeAgent.sendEvent(gameId, reflectPrompt)
          .then(raw => { if (raw) villainMemory.recordReflection(gameId, raw.slice(0, 200)); })
          .catch(e => log.warn('villain-memory', 'reflection failed: ' + (e.message || '').slice(0, 60)));
      }

      if (gameId) {
        _endedGames.add(gameId);
        mazeAgent.markEnded(gameId);
        lureAllocator.endGame(gameId);
      }
      ammoQueue.cleanup(gameId);
      cleanupUsedTrials(gameId); topicState.cleanup(gameId);
      _usedMaterials.delete(gameId);
      _lastTrialAnswer.delete(gameId);
      _trialConfrontations.delete(gameId);
      ctx.sessionLog(gameId, { event: 'game_end', turns, outcome: outcome || 'unknown' });
      log.info('game', `session ended: ${gameId} (${turns} turns, outcome=${outcome || '?'})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));

      // Tear down session only after reflection completes (or fails)
      _reflectionDone.finally(() => { if (gameId) mazeAgent.endSession(gameId); });

      // Trigger async game-end profile reflection (non-blocking)
      try {
        playerProfile.gameEndReflection({
          gameId, outcome, totalSteps, trialStats, temptationStats,
          behaviorTags: data.behaviorTags || [],
        }).catch(e => log.warn('player-profile', 'game-end reflection failed: ' + (e.message || '').slice(0, 60)));
      } catch {}
      return;
    }

    // POST /api/villain/react
    if (req.method === 'POST' && req.url === '/api/villain/react') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}
      const { gameId, context, temptation_content, lure_description, result_detail, hp, steps } = data;

      // ── Record temptation in topicState immediately (sync, no queue) ──
      // This ensures trial_request can see temptation context via topic_signal
      // even though the villain session history update is deferred (background).
      topicState.recordTopic(gameId, {
        prompt: `[temptation] ${temptation_content || ''}`,
        playerInput: context || 'follow',
        judgment: context === 'temptation_ignore' ? 'ignore' : 'follow',
        hit: context !== 'temptation_ignore',
        step: steps || 0,
      });

      // ── Villain episodic memory: record temptation (sync, no queue) ──
      try {
        const villainMemory = require('./villain-memory');
        villainMemory.recordEpisode(gameId, {
          type: 'temptation', step: steps || 0,
          material: temptation_content || '', outcome: context || 'follow',
        });
      } catch {}

      // ── v2: maze-agent temptation reaction (background — won't block judge queue) ──
      if (gameId && mazeAgent.hasSession(gameId)) {
        const perception = {
          gameId,
          step: steps || 0, hp: hp ?? 3,
          lure_type: data.lure_type || 'UNKNOWN',
        };
        const eventMsg = mazeAgent.buildEventMessage('temptation_reaction', {
          choice: context || 'follow',
          content: temptation_content || '',
        }, perception);
        // Fire background — response updates AI speech asynchronously
        mazeAgent.sendEventBackground(gameId, eventMsg)
          .then(raw => {
            const parsed = mazeAgent.parseAgentResponse(raw);
            if (parsed && parsed.speech) {
              ctx.sessionLog(gameId, { event: 'temptation_reaction', context, temptation: temptation_content, choice: context, villain_speech: parsed.speech, hp, steps, agent: 'maze-v2' });
            }
          })
          .catch(e => log.warn('maze-agent', 'v2 react failed: ' + (e.message || '').slice(0, 100)));
        // Return immediately with no speech — client keeps existing text
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ speech: null, _agent: 'maze-v2', _deferred: true }));
        mazeAgent.scheduleBackgroundPrep(gameId, steps || 0);
        return;
      }

      const fallbacks = {
        temptation_follow_success: _t('temptation.fallback.follow_success'),
        temptation_follow_trap:    _t('temptation.fallback.follow_trap'),
        temptation_ignore:         _t('temptation.fallback.ignore'),
      };

      // ── Static fallback ──
      log.warn('routes', 'static fallback: /api/villain/react (gameId=' + (gameId || 'none') + ')');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ speech: fallbacks[context] || '……' }));
      return;
    }

    // GET /api/villain/status
    if (req.method === 'GET' && req.url.startsWith('/api/villain/status')) {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const gameId = params.get('gameId');
      const hasV2 = gameId ? mazeAgent.hasSession(gameId) : false;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(hasV2 ? { active: true, agent: 'maze-v2', sessionKey: mazeAgent.getSessionKey(gameId) } : { error: 'session not found' }));
      return;
    }

    // GET /api/integration/health
    if (req.method === 'GET' && req.url === '/api/integration/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getIntegrationHealth()));
      return;
    }

    // GET /api/health/memory
    if (req.method === 'GET' && req.url === '/api/health/memory') {
      const dbStats = factDb.stats();
      const memoryLevel = global._memoryLevel || 'full';
      const soulLoaded = !!ctx.PERSONALITY_CONTEXT;
      const factDbReady = dbStats.totalFiles > 0 && dbStats.totalChunks > 0;
      const playerProfileReady = playerProfile.hasProfile();
      const issues = [];

      // Per-file check for core identity files
      const coreFiles = {};
      const CORE_FILE_NAMES = ['SOUL.md', 'MEMORY.md', 'IDENTITY.md', 'USER.md'];
      if (ctx.SOUL_PATH) {
        for (const fname of CORE_FILE_NAMES) {
          try {
            const content = fs.readFileSync(path.join(ctx.SOUL_PATH, fname), 'utf8');
            coreFiles[fname] = { loaded: true, size: content.length };
          } catch {
            coreFiles[fname] = { loaded: false, size: 0 };
          }
        }
      } else {
        for (const fname of CORE_FILE_NAMES) {
          coreFiles[fname] = { loaded: false, size: 0 };
        }
      }

      if (!ctx.SOUL_PATH) issues.push(_t('health.no_workspace'));
      if (!soulLoaded) {
        issues.push(memoryLevel === 'none' ? _t('health.memory_disabled') : _t('health.soul_not_loaded'));
      }
      if (!factDbReady) issues.push(_t('health.factdb_not_loaded'));
      if (!playerProfileReady) issues.push(_t('health.profile_not_ready'));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: soulLoaded && factDbReady && playerProfileReady,
        memoryLevel,
        soulPath: ctx.SOUL_PATH || '',
        soulLoaded,
        factDbReady,
        factDbStats: {
          files: dbStats.totalFiles,
          chunks: dbStats.totalChunks,
          availableChunks: dbStats.availableChunks,
        },
        playerProfileReady,
        coreFiles,
        issues,
      }));
      return;
    }

    // GET /api/lure/excluded — cross-game recently used lure keys
    if (req.method === 'GET' && req.url === '/api/lure/excluded') {
      const keys = Array.from(lureAllocator._getRecentlyUsedKeys ? lureAllocator._getRecentlyUsedKeys() : []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys }));
      return;
    }

    // POST /api/config/lang — set server locale
    if (req.method === 'POST' && req.url === '/api/config/lang') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}
      const lang = (data.lang || 'zh').trim();
      if (['zh', 'en'].includes(lang)) {
        ctx.LOCALE = lang;
        log.info('config', `locale set to: ${lang}`);
        // Re-initialize locale in all modules that cache it
        require('./prompts').initLocale(ctx);
        require('./memory').initLocale(ctx);
        require('./villain-memory').initLocale(ctx);
        require('./judge').initLocale(ctx);
        require('./llm-helpers').initLocale(ctx);
        require('./vision-cache').initLocale(ctx);
        require('./session-memory').initLocale(ctx);
        mazeAgent.init(ctx);
        archivist.init(ctx);
        playerProfile.init(ctx);
        themeCluster.init(ctx);
        require('./topic-state').initLocale(ctx);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, lang: ctx.LOCALE }));
      return;
    }

    // GET /api/ammo/status?gameId=xxx
    if (req.method === 'GET' && req.url.startsWith('/api/ammo/status')) {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const gameId = params.get('gameId');
      const ammoQueue = require('./ammo-queue');
      const s = gameId ? ammoQueue.status(gameId) : { trials: 0, cards: 0 };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(s));
      return;
    }

    // GET /api/ping
    if (req.url === '/api/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        model: ctx.ACTIVE_MODEL || 'openclaw/default',
        provider: ctx.PROVIDER,
        source: ctx.SOURCE || '',
        hasKey: !!ctx.API_KEY,
        soulLoaded: !!ctx.PERSONALITY_CONTEXT,
        soulPathConfigured: !!ctx.SOUL_PATH,
        degraded: ctx.degraded || null,
        scanConsentReceived: !!ctx.scanConsentReceived,
      }));
      return;
    }

    // GET /api/config/provider
    if (req.method === 'GET' && req.url === '/api/config/provider') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        provider: ctx.PROVIDER,
        model: ctx.ACTIVE_MODEL || 'openclaw/default',
        archivistModel: ctx.ARCHIVIST_MODEL_ID || '',
        source: ctx.SOURCE || '',
        hasKey: !!ctx.API_KEY,
        soulLoaded: !!ctx.PERSONALITY_CONTEXT,
        warnings: Array.isArray(ctx.WARNINGS) ? ctx.WARNINGS : [],
      }));
      return;
    }

    // POST /api/config/provider
    if (req.method === 'POST' && req.url === '/api/config/provider') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}

      try {
        const nextConfig = buildProviderConfig(data);
        const nextClient = createLLMClient(nextConfig);

        ctx.LLM = nextClient;
        ctx.PROVIDER = nextConfig.provider;
        ctx.ACTIVE_MODEL = nextConfig.model || 'openclaw/default';
        ctx.API_KEY = nextConfig.apiKey || '';
        ctx.ANTHROPIC_KEY = nextConfig.provider === 'anthropic' ? ctx.API_KEY : '';
        ctx.OPENAI_KEY = (nextConfig.provider === 'openai' || nextConfig.provider === 'openclaw-gateway') ? ctx.API_KEY : '';
        ctx.MODEL_ID = nextConfig.model || 'openclaw/default';
        ctx.ARCHIVIST_MODEL_ID = (data.archivistModel || '').trim() || ctx.ARCHIVIST_MODEL_ID || '';
        ctx.SOURCE = nextConfig.source || '';

        mazeAgent.init(ctx);
        archivist.init(ctx);
        require('./prompts').initLocale(ctx);
        require('./memory').initLocale(ctx);
        require('./villain-memory').initLocale(ctx);
        require('./judge').initLocale(ctx);
        require('./llm-helpers').initLocale(ctx);
        require('./vision-cache').initLocale(ctx);
        sessionMemory.initLocale(ctx);
        playerProfile.init(ctx);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, provider: ctx.PROVIDER, model: ctx.ACTIVE_MODEL }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message || _t('error.provider_switch_failed') }));
      }
      return;
    }

    // POST /api/config/test
    if (req.method === 'POST' && req.url === '/api/config/test') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}

      try {
        const hasOverride = !!(data && (data.provider || data.apiKey || data.model || data.apiBase));
        const client = hasOverride ? createLLMClient(buildProviderConfig(data)) : ctx.LLM;
        const model = hasOverride
          ? (String(data.model || '').trim() || ctx.ACTIVE_MODEL || 'openclaw/default')
          : (ctx.ACTIVE_MODEL || 'openclaw/default');

        if (!client || typeof client.chat !== 'function') {
          throw new Error(_t('error.no_llm_client'));
        }

        const startedAt = Date.now();
        await client.chat('Reply OK', [{ role: 'user', content: 'ping' }], { max_tokens: 5, temperature: 0 });
        const latency = Date.now() - startedAt;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, latency, model }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message || _t('error.llm_test_failed') }));
      }
      return;
    }

    // GET /api/lure
    if (req.url === '/api/lure' || req.url.startsWith('/api/lure?')) {
      const { extractLureMaterial, extractDesktopLures, extractDownloadLures } = require('./memory');
      const materials = extractLureMaterial(ctx.SOUL_PATH, 8);
      const desktopItems = extractDesktopLures(4);
      const downloadItems = extractDownloadLures(4);
      const merged = [...materials, ...desktopItems, ...downloadItems];
      for (let i = merged.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [merged[i], merged[j]] = [merged[j], merged[i]];
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: merged }));
      return;
    }

    // GET /api/lure/image
    if (req.url.startsWith('/api/lure/image?')) {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const imgPath = params.get('path');
      if (!imgPath || !fs.existsSync(imgPath)) { res.writeHead(404); res.end('Not found'); return; }
      const resolved = path.resolve(imgPath);
      // Allowlist: SOUL_PATH + GAME_ASSETS_PATH + all scan roots (includes WSL /mnt paths)
      const scanDirs = getScanRoots().map(r => path.resolve(r.path));
      const allowed = [ctx.SOUL_PATH, process.env.GAME_ASSETS_PATH, ...scanDirs].filter(Boolean);
      if (!allowed.some(a => resolved.startsWith(path.resolve(a)))) { res.writeHead(403); res.end('Forbidden'); return; }
      const SAFE_EXTS = new Set(['.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg','.pdf','.txt','.md','.docx','.xlsx']);
      const ext = path.extname(imgPath).toLowerCase();
      if (!SAFE_EXTS.has(ext)) { res.writeHead(403); res.end('Forbidden'); return; }
      const mimeMap = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp' };
      res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' });
      fs.createReadStream(imgPath).pipe(res);
      return;
    }

    // GET /api/memory/scan
    if (req.url === '/api/memory/scan') {
      const result = { found: false, path: '', files: {} };
      if (ctx.SOUL_PATH) {
        result.found = true;
        result.path = ctx.SOUL_PATH;
        const check = (f) => { try { fs.accessSync(path.join(ctx.SOUL_PATH, f)); return true; } catch { return false; } };
        result.files.soul     = check('SOUL.md');
        result.files.memory   = check('MEMORY.md');
        result.files.user     = check('USER.md');
        result.files.identity = check('IDENTITY.md');
        try {
          const memDir = path.join(ctx.SOUL_PATH, 'memory');
          const dailyFiles = fs.readdirSync(memDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
          result.files.dailyNotes = dailyFiles.length;
        } catch { result.files.dailyNotes = 0; }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // POST /api/scan/consent — user consents to local file scanning
    if (req.method === 'POST' && req.url === '/api/scan/consent') {
      if (typeof ctx.startScanning === 'function') {
        ctx.startScanning();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, scanning: ctx.scanConsentReceived }));
      return;
    }

    // POST /api/config/soul-path — configure the Agent workspace path at runtime
    if (req.method === 'POST' && req.url === '/api/config/soul-path') {
      const os = require('os');
      const { initPlayerNames } = require('./memory');
      const { setIdentitySoulPath } = require('./prompts');
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}
      let requestedPath = (data.path || '').trim();

      if (!requestedPath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: _t('error.path_empty') }));
        return;
      }

      // Expand ~ to homedir
      if (requestedPath.startsWith('~')) {
        requestedPath = path.join(os.homedir(), requestedPath.slice(1));
      }
      const resolved = path.resolve(requestedPath);

      // Validate directory exists
      try {
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) throw new Error('not a directory');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: _t('error.dir_not_found', { path: resolved }) }));
        return;
      }

      // Check for memory files
      const MEMORY_FILES = ['SOUL.md', 'MEMORY.md', 'USER.md', 'IDENTITY.md'];
      const found = {};
      for (const f of MEMORY_FILES) {
        try { fs.accessSync(path.join(resolved, f)); found[f] = true; }
        catch { found[f] = false; }
      }
      const hasAny = Object.values(found).some(Boolean);

      if (!hasAny) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: _t('error.no_memory_files'), files: found }));
        return;
      }

      // Apply the new soul path
      ctx.SOUL_PATH = resolved;
      initPlayerNames(ctx.SOUL_PATH);
      ctx.PERSONALITY_CONTEXT = loadPersonality(ctx.SOUL_PATH);
      setIdentitySoulPath(ctx.SOUL_PATH);
      mazeAgent.init(ctx);
      require('./prompts').initLocale(ctx);
      require('./memory').initLocale(ctx);
      require('./villain-memory').initLocale(ctx);
      require('./judge').initLocale(ctx);
      require('./llm-helpers').initLocale(ctx);
      require('./vision-cache').initLocale(ctx);
      sessionMemory.initLocale(ctx);
      playerProfile.init(ctx);

      // Clear degraded flag
      if (ctx.degraded === 'no-soul') ctx.degraded = null;

      // Trigger rescan with new SOUL_PATH
      if (ctx.scanConsentReceived && typeof ctx.startScanning === 'function') {
        ctx.scanConsentReceived = false; // Reset guard so startScanning() runs
        ctx.startScanning();
      }

      log.info('soul-path', `配置工作区: ${resolved} (${Object.entries(found).filter(([,v]) => v).map(([k]) => k).join(', ')})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: resolved, files: found }));
      return;
    }

    // POST /api/memory/config
    if (req.method === 'POST' && req.url === '/api/memory/config') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}
      const level = data.level || 'none';
      if (level === 'none') {
        ctx.PERSONALITY_CONTEXT = '';
      } else if (level === 'soul_only') {
        if (ctx.SOUL_PATH) {
          try { ctx.PERSONALITY_CONTEXT = fs.readFileSync(path.join(ctx.SOUL_PATH, 'SOUL.md'), 'utf8'); }
          catch { ctx.PERSONALITY_CONTEXT = ''; }
        }
      } else {
        ctx.PERSONALITY_CONTEXT = ctx.SOUL_PATH ? loadPersonality(ctx.SOUL_PATH) : '';
      }
      global._memoryLevel = level;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, level, loaded: ctx.PERSONALITY_CONTEXT.length }));
      return;
    }

    // GET /api/soul
    if (req.url === '/api/soul') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        soulPath: ctx.SOUL_PATH || null,
        loaded:   !!ctx.PERSONALITY_CONTEXT,
        preview:  ctx.PERSONALITY_CONTEXT ? ctx.PERSONALITY_CONTEXT.slice(0, 300) + '…' : null,
      }));
      return;
    }

    // GET /api/lure/enhanced — Return fact-db chunks as lure materials
    if (req.url === '/api/lure/enhanced' || req.url.startsWith('/api/lure/enhanced?')) {
      const dbStats = factDb.stats();
      log.info('lure', `enhanced request: ${dbStats.totalChunks} total, ${dbStats.availableChunks} available`);
      const chunks = factDb.getAvailableChunks(20);
      const materials = chunks.map(chunk => {
        const file = factDb.getFileById(chunk.fileId);
        const summary = chunk.summary || file?.summary || '';
        const rawContent = String(chunk.content || '');
        const trimmedContent = rawContent.trim();
        const contentPreview = trimmedContent
          ? trimmedContent.slice(0, 300) + (trimmedContent.length > 300 ? '……' : '')
          : '';
        return {
          path: file ? file.path : '',
          name: file ? file.fileName : '',
          content: rawContent,
          contentPreview,
          summary,
          description: summary,
          lureHook: summary.slice(0, 60),
          textPreview: contentPreview,
          tags: chunk.tags,
          isText: true,
          _source: 'fact-db',
        };
      });

      // Fallback to vision-cache if fact-db is empty
      if (materials.length === 0) {
        const rawMaterials = getLureMaterials(50);
        const fallback = rawMaterials.map(item => ({
          ...item,
          description: item.description ? scrubSensitiveLines(item.description) : item.description,
          lureHook: item.lureHook ? scrubSensitiveLines(item.lureHook) : item.lureHook,
          textPreview: item.textPreview ? scrubSensitiveLines(item.textPreview) : item.textPreview,
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items: fallback, count: fallback.length }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: materials, count: materials.length }));
      return;
    }

    // POST /api/villain/intro — Agent writes the opening lines
    if (req.method === 'POST' && req.url === '/api/villain/intro') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}
      const gameId = data.gameId || null;
      if (gameId && mazeAgent.hasSession(gameId)) {
        try {
          const perception = { gameId, step: 0, hp: 3 };
          const eventMsg = mazeAgent.buildEventMessage('intro', {
            game_number: data.game_number || 1,
            wins: data.wins || 0,
            deaths: data.deaths || 0,
            has_memory: data.has_memory || false,
          }, perception);
          const raw = await mazeAgent.sendEvent(gameId, eventMsg);
          const parsed = mazeAgent.parseAgentResponse(raw);
          if (parsed && parsed.lines && Array.isArray(parsed.lines) && parsed.lines.length >= 2) {
            const introLines = parsed.lines.slice(0, 4);
            ctx.sessionLog(gameId, { event: 'intro', lines: introLines, mood: parsed.mood || null, source: 'llm' });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ lines: introLines, mood: parsed.mood || null }));
            return;
          }
        } catch (e) {
          log.warn('maze-agent', 'intro generation failed: ' + (e.message || '').slice(0, 100));
        }
      }
      // Fallback: null lines = client uses hardcoded
      ctx.sessionLog(gameId, { event: 'intro', lines: null, source: 'fallback' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ lines: null, mood: null }));
      return;
    }

    // POST /api/villain/epilogue — Agent writes the final monologue
    if (req.method === 'POST' && req.url === '/api/villain/epilogue') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}
      const gameId = data.gameId || null;
      if (gameId && mazeAgent.hasSession(gameId)) {
        try {
          const perception = { gameId, step: data.steps || 0, hp: data.hp ?? 0 };
          const eventMsg = mazeAgent.buildEventMessage('epilogue', {
            turns: data.steps || 0,
            outcome: data.outcome || 'unknown',
            hp: data.hp ?? 0,
            godHand: data.godHand || 0,
            trialPassed: data.trialPassed || 0,
            trialFailed: data.trialFailed || 0,
            backtracks: data.backtracks || 0,
          }, perception);
          const raw = await mazeAgent.sendEvent(gameId, eventMsg);
          const parsed = mazeAgent.parseAgentResponse(raw);
          if (parsed && parsed.epilogue) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ epilogue: parsed.epilogue, mood: parsed.mood || null }));
            return;
          }
        } catch (e) {
          log.warn('maze-agent', 'epilogue failed: ' + (e.message || '').slice(0, 100));
        }
      }
      // Fallback
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ epilogue: null, mood: null }));
      return;
    }

    // POST /api/truth/reveal — Agent writes the revelation text
    if (req.method === 'POST' && req.url === '/api/truth/reveal') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}
      const gameId = data.gameId || null;
      const flag = data.flag || '';
      const flagMeanings = {
        mazeRemembersBacktrack: _t('truth.meaning.mazeRemembersBacktrack'),
        agentIsAdversarial:     _t('truth.meaning.agentIsAdversarial'),
        exitIsConditional:      _t('truth.meaning.exitIsConditional'),
        agentJudgesAnswers:     _t('truth.meaning.agentJudgesAnswers'),
        mazeIsYourMemory:       _t('truth.meaning.mazeIsYourMemory'),
        villainKnowsYou:        _t('truth.meaning.villainKnowsYou'),
        trialIsPersonal:        _t('truth.meaning.trialIsPersonal'),
        temptationIsLearned:    _t('truth.meaning.temptationIsLearned'),
      };
      if (gameId && mazeAgent.hasSession(gameId)) {
        try {
          const perception = { gameId, step: data.steps || 0, hp: data.hp ?? 3, behavior: data.behavior || null };
          const eventMsg = mazeAgent.buildEventMessage('truth_reveal', {
            flag, flag_meaning: flagMeanings[flag] || flag,
          }, perception);
          const raw = await mazeAgent.sendEvent(gameId, eventMsg);
          const parsed = mazeAgent.parseAgentResponse(raw);
          if (parsed && parsed.revelation) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ revelation: parsed.revelation, mood: parsed.mood || null }));
            return;
          }
        } catch (e) {
          log.warn('maze-agent', 'truth reveal failed: ' + (e.message || '').slice(0, 100));
        }
      }
      // Fallback to hardcoded
      const fallbacks = {
        mazeRemembersBacktrack: _t('truth.fallback.mazeRemembersBacktrack'),
        agentIsAdversarial:     _t('truth.fallback.agentIsAdversarial'),
        exitIsConditional:      _t('truth.fallback.exitIsConditional'),
        agentJudgesAnswers:     _t('truth.fallback.agentJudgesAnswers'),
        mazeIsYourMemory:       _t('truth.fallback.mazeIsYourMemory'),
        villainKnowsYou:        _t('truth.fallback.villainKnowsYou'),
        trialIsPersonal:        _t('truth.fallback.trialIsPersonal'),
        temptationIsLearned:    _t('truth.fallback.temptationIsLearned'),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ revelation: fallbacks[flag] || '……', mood: null }));
      return;
    }

    // POST /api/lure/narrative — Return short maze commentary for the selected lure
    if (req.method === 'POST' && req.url === '/api/lure/narrative') {
      let data = {};
      try { data = JSON.parse(await readBody(req)); } catch {}

      const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
      const pickFirst = (...vals) => vals.map(clean).find(Boolean) || '';
      const short = (s, n = 120) => {
        const t = clean(s);
        return t.length > n ? t.slice(0, n) + '…' : t;
      };
      const buildFallbackNarrative = () => {
        const name = pickFirst(data.name, data.path ? data.path.split(/[\\/]/).pop() : '');
        const hook = pickFirst(data.lureHook, data.description);
        const preview = short((data.textPreview || '').split('\n').filter(Boolean).slice(0, 2).join(' '), 90);
        if (data.isText) {
          if (hook && preview) return _t('lure.narrative.fallback.text_hook_preview', { hook, preview });
          if (hook) return _t('lure.narrative.fallback.text_hook', { hook });
          if (name) return _t('lure.narrative.fallback.text_name', { name });
          return _t('lure.narrative.fallback.text_default');
        }
        if (hook && name) return _t('lure.narrative.fallback.image_hook_name', { hook, name });
        if (hook) return _t('lure.narrative.fallback.image_hook', { hook });
        if (name) return _t('lure.narrative.fallback.image_name', { name });
        return _t('lure.narrative.fallback.default');
      };
      const extractNarrativeFromRaw = (raw) => {
        const src = String(raw || '').trim();
        if (!src) return '';

        // 1) direct JSON
        try {
          const obj = JSON.parse(src);
          if (obj && typeof obj.narrative === 'string' && obj.narrative.trim()) return clean(obj.narrative);
        } catch {}

        // 2) scan all JSON-like blocks, prefer the LAST one with narrative
        const blocks = src.match(/\{[\s\S]*?\}/g) || [];
        for (let i = blocks.length - 1; i >= 0; i--) {
          const block = blocks[i]
            .replace(/```json\s*/gi, '')
            .replace(/```\s*/g, '')
            .replace(/,\s*([}\]])/g, '$1');
          try {
            const obj = JSON.parse(block);
            if (obj && typeof obj.narrative === 'string' && obj.narrative.trim()) return clean(obj.narrative);
          } catch {}
        }

        // 3) explicit narrative field regex (works even when blocks are glued together)
        const matches = [...src.matchAll(/"narrative"\s*:\s*"((?:\\.|[^"\\])*)"/g)];
        if (matches.length > 0) {
          const last = matches[matches.length - 1][1];
          try {
            const decoded = JSON.parse('"' + last.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
            if (decoded && decoded.trim()) return clean(decoded);
          } catch {
            const rough = last.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            if (rough.trim()) return clean(rough);
          }
        }

        return '';
      };

      let narrative = '';
      try {
        const systemPrompt = _t('lure.narrative.system_prompt');
        const userContent = JSON.stringify({
          item_name: clean(data.name || ''),
          item_type: clean(data.type || ''),
          hook: short(data.lureHook || '', 80),
          description: short(data.description || '', 160),
          preview: short(data.textPreview || '', 220),
          hp: data.hp ?? 3,
          step: data.steps || 0,
        });
        const raw = await ctx.LLM.chat(systemPrompt, [{ role: 'user', content: userContent }], {
          max_tokens: 120,
          temperature: 0.8,
          fast: true,
        });
        narrative = extractNarrativeFromRaw(raw);
      } catch (e) {
        log.warn('maze-agent', 'v2 lure narrative failed, fallback reserved: ' + (e.message || '').slice(0, 100));
      }

      if (!narrative) narrative = buildFallbackNarrative();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ narrative }));
      return;
    }

    // Static files
    const urlPath  = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const filePath = path.resolve(ctx.GAME_DIR, '.' + urlPath);
    if (!filePath.startsWith(ctx.GAME_DIR)) { res.writeHead(403); res.end(); return; }

    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(filePath);
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
      // Prevent browser caching of JS/CSS/HTML during development
      if (['.js', '.css', '.html'].includes(ext)) {
        headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        headers['Pragma'] = 'no-cache';
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  };
}

module.exports = { createRoutes };
