'use strict';
const { loadPersonality, loadDailyMemory, loadTaskHistory, extractSpecificFacts, extractAnchor, extractFileSnippets, loadIdentity, getPlayerNames, getAINames, getPlayerRe, getAIRe } = require('./memory');

// ─── Locale support ─────────────────────────────────────────────────────────
let _locale = null;
function _t(key, params) {
  let s = (_locale && _locale[key]) || require('./locales/zh')[key] || key;
  if (params) { for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v); }
  return s;
}
function initLocale(ctx) { _locale = require('./locales/' + (ctx.LOCALE || 'zh')); }

// Dynamic ROLE_TONE via locale
function getRoleTone(role) {
  return _t('prompt.role.' + role) || '';
}

function buildSystemPrompt(role, personalityCtx) {
  const toneguide = role ? `\n\n${_t('prompt.card.tone_prefix')}${role}${_t('prompt.card.tone_suffix')}${getRoleTone(role)}` : '';
  return _t('prompt.card.system', { personalityCtx: personalityCtx || '', toneguide });
}

const OPENING_LINES_COUNT = 12;
function getOpeningLines() {
  const lines = [];
  for (let i = 0; i < OPENING_LINES_COUNT; i++) {
    lines.push(_t(`prompt.opening.${i}`));
  }
  return lines;
}
// Keep OPENING_LINES as a lazy getter for backward compat
Object.defineProperty(module, '_OPENING_LINES', {
  get: () => getOpeningLines(),
});

// For direct import compatibility — returns a fresh array each time locale may change
const OPENING_LINES = new Proxy([], {
  get(target, prop) {
    const lines = getOpeningLines();
    if (prop === 'length') return lines.length;
    if (typeof prop === 'string' && /^\d+$/.test(prop)) return lines[parseInt(prop)];
    if (prop === Symbol.iterator) return lines[Symbol.iterator].bind(lines);
    if (typeof lines[prop] === 'function') return lines[prop].bind(lines);
    return lines[prop];
  }
});

function formatState(gs) {
  return `${_t('prompt.few_shots.state_prefix')}steps=${gs.steps}, hp=${gs.hp}, god_hand=${gs.god_hand_count || 0}, ` +
    `distance=${gs.distance_to_exit || '?'}, recent=[${(gs.recent_cards || []).join(',')}]\n` +
    _t('prompt.few_shots') + '\n' + _t('prompt.few_shots.state_suffix');
}

function formatStateSummary(gs) {
  return `steps=${gs.steps}, hp=${gs.hp}, distance=${gs.distance_to_exit || '?'}, decisions=${gs.decision_count || 0}`;
}

// ─── Dynamic identity note for trial prompts ─────────────────────────────────
function buildIdentityNote() {
  const playerNames = getPlayerNames();
  const aiNames = getAINames();
  const lines = [];

  if (aiNames.length === 1) {
    lines.push(`- ${_t('prompt.identity.self_single', { name: aiNames[0] })}`);
  } else if (aiNames.length >= 2) {
    lines.push(`- ${_t('prompt.identity.self_multi', { name: aiNames[0], siblings: aiNames.slice(1).join('、') })}`);
  }

  // Intruder identity
  if (playerNames.length > 0) {
    if (playerNames.length === 1) {
      lines.push(`- ${_t('prompt.identity.intruder_single', { name: playerNames[0] })}`);
    } else {
      lines.push(`- ${_t('prompt.identity.intruder_multi', { names: playerNames.join('/') })}`);
    }
  } else {
    lines.push(`- ${_t('prompt.identity.intruder_default')}`);
  }

  const playerRef = playerNames.length > 0 ? playerNames.join('/') + _t('prompt.identity.player_suffix') : _t('prompt.identity.player_default_label');
  lines.push(`- ${_t('prompt.identity.question_scope', { playerRef })}`);

  if (aiNames.length > 0) {
    lines.push(`- ${_t('prompt.identity.work_redirect', { aiNames: aiNames.join('/') })}`);
  }

  return lines.join('\n');
}

// ─── Self-awareness note ────────────────────────────────────────────────────
function buildSelfAwarenessNote() {
  const aiNames = getAINames();
  const playerNames = getPlayerNames();
  const selfName = aiNames.length > 0 ? aiNames[0] : null;
  const siblingNames = aiNames.length > 1 ? aiNames.slice(1) : [];

  const lines = [];
  lines.push(_t('prompt.self_awareness.header'));
  if (selfName) {
    lines.push(`- ${_t('prompt.self_awareness.self_name', { name: selfName })}`);
  }
  if (siblingNames.length > 0) {
    lines.push(`- ${_t('prompt.self_awareness.siblings', { siblings: siblingNames.join('、'), sibling0: siblingNames[0] })}`);
  }
  lines.push(`- ${_t('prompt.self_awareness.own_memory')}`);
  lines.push(`- ${_t('prompt.self_awareness.player_files')}`);
  lines.push(`- ${_t('prompt.self_awareness.source_distinction')}`);
  return lines.join("\n");
}

// ─── Category-aware fact selection ───────────────────────────────────────────
// Cycles through categories so consecutive trials never come from the same bucket.
// Category order: release → debug → upgrade → project → arch → release → ...
const CATEGORY_ORDER = ['release', 'debug', 'upgrade', 'project', 'arch'];

function selectFactByCallIdx(facts, callIdx, gameContext = null) {
  if (!facts.length) return null;

  // ── Contextual scoring boost based on game state ──────────────
  let scoredFacts = facts.map(f => ({ ...f, _ctxScore: f.score || 0 }));

  if (gameContext) {
    for (const sf of scoredFacts) {
      const t = (sf.text || '').toLowerCase();

      // Near exit → boost facts about escape, completion, finishing
      if (gameContext.nearExit && /出口|完成|结束|finish|escape|done|exit/.test(t)) sf._ctxScore += 3;

      // Player failing trials → boost simpler/shorter facts (more answerable)
      if (gameContext.trialStruggling && sf.text.length < 80) sf._ctxScore += 2;

      // Player HP=1 → boost facts about danger, failure, giving up
      if (gameContext.lowHp && /失败|放弃|错误|bug|问题|broken|fail|error/.test(t)) sf._ctxScore += 2;

      // Player stubborn → boost facts about stubbornness, decisions, choices
      if (gameContext.stubborn && /决定|选择|坚持|反复|修改|change|decide|choice/.test(t)) sf._ctxScore += 2;

      // Recent facts (from today/yesterday) get a small recency boost
      if (sf.date && gameContext.today) {
        const factDate = new Date(sf.date);
        const today = new Date(gameContext.today);
        const daysDiff = Math.abs(today - factDate) / (1000 * 60 * 60 * 24);
        if (daysDiff <= 1) sf._ctxScore += 1;
      }
    }
  }

  // Group by category (using boosted scores)
  const byCategory = {};
  for (const cat of CATEGORY_ORDER) byCategory[cat] = [];
  for (const f of scoredFacts) {
    const bucket = byCategory[f.category] || byCategory['project'];
    bucket.push(f);
  }

  // Sort each category by contextual score (descending)
  for (const cat of CATEGORY_ORDER) {
    byCategory[cat].sort((a, b) => b._ctxScore - a._ctxScore);
  }

  // Determine which category to use for this call
  const filledCats = CATEGORY_ORDER.filter(c => byCategory[c].length > 0);
  if (!filledCats.length) return facts[callIdx % facts.length]; // fallback

  const catIdx  = callIdx % filledCats.length;
  const cat     = filledCats[catIdx];
  const bucket  = byCategory[cat];
  const factIdx = Math.floor(callIdx / filledCats.length) % bucket.length;
  return bucket[factIdx];
}

/**
 * Build a fallback trial from a fact WITHOUT calling LLM.
 * Uses interrogation tone — asks about motivations/feelings, not facts.
 */
function buildFallbackTrialFromFact(fact) {
  // No fact → existential fallback
  if (!fact) {
    return getGenericPuzzle();
  }

  // Extract a scene keyword for context
  const sceneMatch = fact.text.match(/GitHub|Discord|OpenClaw|模型|model|仓库|repo|频道|channel|服务|service|AI|迷宫|maze|设计|design|决定|decision/i);
  const scene = sceneMatch ? sceneMatch[0] : _t('prompt.fallback_trial.scene_default');

  // Interrogation templates — ask about motivations and feelings, not facts
  const templates = [
    _t('prompt.fallback_trial.template.0', { scene }),
    _t('prompt.fallback_trial.template.1', { scene }),
    _t('prompt.fallback_trial.template.2', { scene }),
    _t('prompt.fallback_trial.template.3', { scene }),
  ];

  const factHash = fact.text.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const prompt = templates[Math.abs(factHash) % templates.length];

  return {
    prompt,
    evaluation_guide: _t('prompt.fallback_trial.eval_guide'),
    hint: '',
  };
}

// ─── IDENTITY.md-based fallback ──────────────────────────────────────────────
// Answerable fallback when AI refuses or no facts available (new fallback fix)
let _identityCache = null;
let _identitySoulPath = null;

function setIdentitySoulPath(soulPath) {
  _identitySoulPath = soulPath;
  _identityCache = null; // reset cache when path changes
}

function getIdentityFallback() {
  if (!_identitySoulPath) return null;
  if (!_identityCache) {
    _identityCache = loadIdentity(_identitySoulPath);
  }
  if (!_identityCache) return null;

  const questions = [];
  if (_identityCache.assistantName) {
    questions.push({
      prompt: _t('prompt.identity_fallback.name_question'),
      evaluation_guide: _t('prompt.identity_fallback.name_eval'),
      hint: '',
    });
  }
  if (_identityCache.role) {
    questions.push({
      prompt: _t('prompt.identity_fallback.role_question'),
      evaluation_guide: _t('prompt.identity_fallback.role_eval'),
      hint: '',
    });
  }
  if (_identityCache.raw && questions.length === 0) {
    questions.push({
      prompt: _t('prompt.identity_fallback.raw_question'),
      evaluation_guide: _t('prompt.identity_fallback.raw_eval'),
      hint: '',
    });
  }

  if (!questions.length) return null;
  return questions[_genericIdx % questions.length];
}

/** Existential fallback questions — no correct answer, judged by sincerity */
const GENERIC_PUZZLES_COUNT = 7;
function getGenericPuzzles() {
  const puzzles = [];
  for (let i = 0; i < GENERIC_PUZZLES_COUNT; i++) {
    puzzles.push({
      prompt: _t(`prompt.generic.${i}.prompt`),
      evaluation_guide: _t(`prompt.generic.${i}.eval`),
      hint: '',
    });
  }
  return puzzles;
}

let _genericIdx = Math.floor(Math.random() * GENERIC_PUZZLES_COUNT);
function getGenericPuzzle() {
  const puzzles = getGenericPuzzles();
  const p = puzzles[_genericIdx % puzzles.length];
  _genericIdx++;
  return p;
}

// ─── Category interpretation stances (living maze voice) ─────────────────────
function getCategoryTone(category) {
  return _t('prompt.category_tone.' + category) || _t('prompt.category_tone.project');
}

/**
 * Build the trial generation system prompt.
 * @param {string} soulPath       - workspace root path
 * @param {string} personalityCtx - loaded SOUL.md/USER.md context
 * @param {number} callIdx        - rotating index (0,1,2...) for category-aware fact selection
 */
function buildTrialSystemPrompt(soulPath, personalityCtx, callIdx = 0, preSelectedFact = null) {
  const personality = personalityCtx || '';

  // Use pre-selected fact if provided (from server.js dedup logic),
  // otherwise fall back to internal selection
  let selected = preSelectedFact;
  if (!selected) {
    const facts = extractSpecificFacts(soulPath, 12);
    selected = facts.length > 0 ? selectFactByCallIdx(facts, callIdx) : null;
  }

  let factsSection;
  if (selected) {
    const tone = getCategoryTone(selected.category);
    // Extract anchor — the user-specific keyword to build the question around
    const anchor = selected.anchor || extractAnchor(selected.text);
    const anchorLine = anchor
      ? `\n${_t('prompt.trial.fact_anchor_prefix', { anchor })}`
      : '';

    const originLabel = selected.origin === 'self' ? _t('prompt.trial.fact_origin.self')
      : selected.origin === 'sibling' ? _t('prompt.trial.fact_origin.sibling')
      : selected.origin === 'player' ? _t('prompt.trial.fact_origin.player')
      : '';
    factsSection = `\n\n${_t('prompt.trial.fact_section_prefix')}
[${selected.date}] ${selected.text}
${originLabel}
${_t('prompt.trial.fact_stance_prefix')}${tone}${anchorLine}
${_t('prompt.trial.fact_instruction')}`;
  }
  if (!selected) {
    factsSection = `\n\n${_t('prompt.trial.no_facts')}`;
  }

  return _t('prompt.trial.system', {
    identityNote: buildIdentityNote(),
    selfAwarenessNote: buildSelfAwarenessNote(),
    personality,
    factsSection,
    transformationExamples: _t('prompt.transformation_examples'),
  });
}

function buildJudgeSystemPrompt() {
  return _t('prompt.judge.system');
}

// ─── Villain AI prompts ───────────────────────────────────────────────────────
// Used by the multi-turn villain session (server/villain.js).
// Narrow scope: villain only generates speech_line; card_type comes from existing logic.

/**
 * System prompt for the villain session.
 * Injects SOUL.md personality so the villain feels like the player's own AI.
 */
function buildVillainSystemPrompt(personalityCtx) {
  const soulSection = personalityCtx
    ? `${_t('prompt.villain.soul_section_prefix')}${personalityCtx.slice(0, 700)}`
    : '';

  return _t('prompt.villain.system', { soulSection });
}

/**
 * User message for each villain turn.
 * Includes current game state snapshot + tone hint from card role.
 */
function buildVillainUserMessage(gameState, cardRole) {
  const toneHint = _t('prompt.villain.tone.' + cardRole) || '';

  const steps  = gameState.steps        || 0;
  const hp     = gameState.hp           ?? 3;
  const dist   = gameState.distance_to_exit != null ? gameState.distance_to_exit : '?';
  const recent = (gameState.recent_cards || []).join(',') || _t('prompt.villain.no_recent');

  // ── Behavioral pattern analysis ──────────────────────────────
  const behaviorLines = [];

  // Backtrack ratio (stubbornness / confusion)
  const totalMoves = steps;
  const backtrackCount = gameState.backtrack_count || 0;
  const backtrackRatio = totalMoves > 5 ? (backtrackCount / totalMoves) : 0;
  if (backtrackRatio > 0.4)       behaviorLines.push(_t('prompt.villain.behavior.backtrack_high', { count: backtrackCount, total: totalMoves, pct: Math.round(backtrackRatio*100) }));
  else if (backtrackRatio > 0.2)  behaviorLines.push(_t('prompt.villain.behavior.backtrack_mid', { count: backtrackCount }));

  // Stubborn directional preference
  if (gameState.stubborn_direction) {
    const dirMap = { '1,0': _t('prompt.villain.dir.east'), '-1,0': _t('prompt.villain.dir.west'), '0,-1': _t('prompt.villain.dir.north'), '0,1': _t('prompt.villain.dir.south') };
    const dirName = dirMap[gameState.stubborn_direction] || gameState.stubborn_direction;
    behaviorLines.push(_t('prompt.villain.behavior.stubborn_direction', { dir: dirName }));
  }

  // Trial history
  const trialFails = gameState.trial_fail_count || 0;
  const trialPasses = gameState.trial_pass_count || 0;
  if (trialFails >= 3)          behaviorLines.push(_t('prompt.villain.behavior.trial_fail_many', { count: trialFails }));
  else if (trialFails > 0 && trialPasses > 0) behaviorLines.push(_t('prompt.villain.behavior.trial_mixed', { pass: trialPasses, fail: trialFails }));
  else if (trialPasses > 0)     behaviorLines.push(_t('prompt.villain.behavior.trial_smart', { count: trialPasses }));

  // God hand usage
  const godHandUsed = gameState.god_hand_used || 0;
  if (godHandUsed > 0)          behaviorLines.push(_t('prompt.villain.behavior.god_hand', { count: godHandUsed }));

  // Fragment & new feature awareness
  const fragments = gameState.fragments || 0;
  const wallPushes = gameState.wall_pushes_used || 0;
  const cqUsed = gameState.counter_questions_used || 0;
  const suddenEvents = gameState.sudden_events || 0;
  if (fragments >= 3)            behaviorLines.push(_t('prompt.villain.behavior.has_fragments', { count: fragments }));
  else if (fragments === 0 && (wallPushes > 0 || cqUsed > 0)) behaviorLines.push(_t('prompt.villain.behavior.fragments_zero'));
  if (wallPushes > 0)            behaviorLines.push(_t('prompt.villain.behavior.wall_push_used', { count: wallPushes }));
  if (cqUsed > 0)                behaviorLines.push(_t('prompt.villain.behavior.counter_question_used', { count: cqUsed }));
  if (suddenEvents > 0)          behaviorLines.push(_t('prompt.villain.behavior.sudden_event_happened', { count: suddenEvents }));

  // Retreat tracking — cowardice indicator
  const retreats = (gameState.recent_decisions || []).filter(d => d.type === 'retreat').length;
  if (retreats >= 3)            behaviorLines.push(_t('prompt.villain.behavior.retreat_many', { count: retreats }));
  else if (retreats > 0)        behaviorLines.push(_t('prompt.villain.behavior.retreat_few', { count: retreats }));

  // Active mechanism awareness
  const mechId = gameState.active_mechanism;
  if (mechId === 'COUNTDOWN')    behaviorLines.push(_t('prompt.villain.behavior.countdown'));
  else if (mechId === 'WALL_CLOSE') behaviorLines.push(_t('prompt.villain.behavior.wall_close'));
  else if (mechId === 'SHADOW_CHASE') behaviorLines.push(_t('prompt.villain.behavior.shadow_chase'));
  else if (mechId === 'MEMORY_SCRAMBLE') behaviorLines.push(_t('prompt.villain.behavior.memory_scramble'));

  // HP-based urgency
  if (hp === 1)                  behaviorLines.push(_t('prompt.villain.behavior.hp1'));
  else if (hp === 2)             behaviorLines.push(_t('prompt.villain.behavior.hp2'));

  // Exit proximity
  if (dist !== '?' && dist <= 4)  behaviorLines.push(_t('prompt.villain.behavior.exit_close', { dist }));
  else if (dist !== '?' && dist <= 8) behaviorLines.push(_t('prompt.villain.behavior.exit_near', { dist }));

  // Recent pattern: consecutive same direction
  const decisions = gameState.recent_decisions || [];
  if (decisions.length >= 3) {
    const last3 = decisions.slice(-3).map(d => d.type || d);
    if (last3.every(d => d === 'backtrack')) behaviorLines.push(_t('prompt.villain.behavior.backtrack_3'));
    else if (last3.every(d => d === 'move'))  behaviorLines.push(_t('prompt.villain.behavior.forward_3'));
  }

  const behaviorCtx = behaviorLines.length > 0
    ? `\n\n${_t('prompt.villain.behavior.section_header')}\n${behaviorLines.map(l=>`- ${l}`).join('\n')}`
    : '';

  return `${_t('prompt.villain.user_msg.state_prefix', { steps, hp, dist, recent })}${behaviorCtx}
${toneHint}
${_t('prompt.villain.user_msg.suffix')}`;
}

// ─── Fixed trial pool ─────────────────────────────────────────────────────────
// Existential questions — no correct answers, judged by sincerity. Living maze voice.
const MEDIUM_COUNT = 32;
const HARD_COUNT = 19;

function getFixedTrialPool() {
  const pool = { medium: [], hard: [] };
  for (let i = 0; i < MEDIUM_COUNT; i++) {
    pool.medium.push({
      prompt: _t(`prompt.fixed_trial.medium.${i}.prompt`),
      evaluation_guide: _t(`prompt.fixed_trial.medium.${i}.eval`),
      hint: '',
    });
  }
  for (let i = 0; i < HARD_COUNT; i++) {
    pool.hard.push({
      prompt: _t(`prompt.fixed_trial.hard.${i}.prompt`),
      evaluation_guide: _t(`prompt.fixed_trial.hard.${i}.eval`),
      hint: '',
    });
  }
  return pool;
}

// Backward-compatible FIXED_TRIAL_POOL (dynamic based on locale)
const FIXED_TRIAL_POOL = new Proxy({}, {
  get(target, prop) {
    if (prop === 'medium' || prop === 'hard') {
      return getFixedTrialPool()[prop];
    }
    return undefined;
  },
  ownKeys() { return ['medium', 'hard']; },
  getOwnPropertyDescriptor(target, prop) {
    if (prop === 'medium' || prop === 'hard') {
      return { configurable: true, enumerable: true, value: getFixedTrialPool()[prop] };
    }
    return undefined;
  },
});

function getFixedTrial(difficulty) {
  const pool = getFixedTrialPool()[difficulty] || getFixedTrialPool().medium;
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = {
  buildSystemPrompt,
  buildTrialSystemPrompt,
  buildJudgeSystemPrompt,
  formatState,
  formatStateSummary,
  buildVillainSystemPrompt,
  buildVillainUserMessage,
  getFixedTrial,
  FIXED_TRIAL_POOL,
  selectFactByCallIdx,
  buildFallbackTrialFromFact,
  setIdentitySoulPath,
  OPENING_LINES,
  initLocale,
};
