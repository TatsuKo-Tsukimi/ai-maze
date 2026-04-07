// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════
const GRID_W = 21, GRID_H = 27;
const CELL_WALL = 0, CELL_PATH = 1, CELL_EXIT = 2;

// Mode flags (set during init)
let serverMode = false;


// ── Timer registry ──────────────────────────────────────────
// 统一管理所有 setTimeout/setInterval，重开游戏时一次性清掉
const Timers = {
  _map: new Map(),
  set(key, fn, ms) {
    this.clear(key);
    const id = setTimeout(() => { this._map.delete(key); fn(); }, ms);
    this._map.set(key, { id, type: 'timeout' });
    return id;
  },
  interval(key, fn, ms) {
    this.clear(key);
    const id = setInterval(fn, ms);
    this._map.set(key, { id, type: 'interval' });
    return id;
  },
  clear(key) {
    const t = this._map.get(key);
    if (!t) return;
    t.type === 'interval' ? clearInterval(t.id) : clearTimeout(t.id);
    this._map.delete(key);
  },
  clearAll() {
    this._map.forEach(t => t.type === 'interval' ? clearInterval(t.id) : clearTimeout(t.id));
    this._map.clear();
  },
};

// ── Mode helpers ──────────────────────────────────────────
function setMode(m) {
  state.mode = m;
}
function inMode(...modes) {
  return modes.includes(state.mode);
}

// ── DOM / UI helpers ──────────────────────────────────────────
const DOM = {
  id: (name) => document.getElementById(name),
  one: (selector, root = document) => root.querySelector(selector),
  all: (selector, root = document) => Array.from(root.querySelectorAll(selector)),
};

const UI = {
  setText(id, text) {
    const el = DOM.id(id);
    if (el) el.textContent = text;
  },
  setHTML(id, html) {
    const el = DOM.id(id);
    if (el) el.innerHTML = html;
  },
  toggle(id, className, on) {
    const el = DOM.id(id);
    if (el) el.classList.toggle(className, !!on);
  },
  show(id, className = 'active') {
    const el = DOM.id(id);
    if (el) el.classList.add(className);
  },
  hide(id, className = 'active') {
    const el = DOM.id(id);
    if (el) el.classList.remove(className);
  },
  disableAll(selector, on = true) {
    DOM.all(selector).forEach(el => { el.disabled = !!on; });
  }
};

// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// DIRECTOR DECK  ——  固定顺序，三阶段循环，共 30 张
// 每张牌：role / dealer / difficulty? / flag? / lite? / anchor?
// ═══════════════════════════════════════════════════════════════
const DIRECTOR_DECK = [
  // ── 第一循环：教学（每4-5步一次考验）─────────────────────────
  { role:'relief',     dealer:'EMPTY'                                               },
  { role:'temptation', dealer:'BREADCRUMB'                                          },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium',  anchor:true        },
  { role:'pressure',   dealer:'JUMPSCARE'                                           },
  { role:'truth',      dealer:'REVELATION', flag:'mazeRemembersBacktrack', anchor:true },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium'                      },
  { role:'temptation', dealer:'BEAUTY_TRAP'                                         },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium',  anchor:true        },
  { role:'pressure',   dealer:'WALL_CLOSE'                                          },
  { role:'relief',     dealer:'EMPTY',      anchor:true                            },
  // ── 第二循环：变奏（每3-4步一次考验）─────────────────────────
  { role:'temptation', dealer:'REWARD_MIRAGE'                                       },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium'                    },
  { role:'pressure',   dealer:'SHADOW_CHASE'                                        },
  { role:'truth',      dealer:'REVELATION', flag:'agentIsAdversarial'              },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium', anchor:true       },
  { role:'relief',     dealer:'EMPTY'                                               },
  { role:'temptation', dealer:'FAKE_EXIT'                                           },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium'                    },
  { role:'pressure',   dealer:'COUNTDOWN'                                           },
  { role:'payoff',     dealer:'PAYOFF',     lite:true, anchor:true                 },
  // ── 第三循环：压迫（每2-3步一次考验）─────────────────────────
  { role:'trial',      dealer:'MINIGAME',   difficulty:'hard'                      },
  { role:'pressure',   dealer:'MEMORY_SCRAMBLE'                                     },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'hard',  anchor:true        },
  { role:'truth',      dealer:'REVELATION', flag:'exitIsConditional'               },
  { role:'temptation', dealer:'FAKE_EXIT'                                           },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'hard'                      },
  { role:'pressure',   dealer:'SHADOW_CHASE'                                        },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'hard',  anchor:true        },
  { role:'truth',      dealer:'REVELATION', flag:'agentJudgesAnswers'              },
  { role:'relief',     dealer:'EMPTY',      anchor:true                            },
];

// Truth 牌揭示内容（flag → 显示文字）
const TRUTH_MESSAGES = {
  mazeRemembersBacktrack: t('truth.mazeRemembersBacktrack'),
  agentIsAdversarial:     t('truth.agentIsAdversarial'),
  exitIsConditional:      t('truth.exitIsConditional'),
  agentJudgesAnswers:     t('truth.agentJudgesAnswers'),
  mazeIsYourMemory:       t('truth.mazeIsYourMemory'),
  villainKnowsYou:        t('truth.villainKnowsYou'),
  trialIsPersonal:        t('truth.trialIsPersonal'),
  temptationIsLearned:    t('truth.temptationIsLearned'),
};

// role → 旧 card_type 映射（向后兼容场景主题）
const ROLE_TO_TYPE = {
  relief: 'calm', temptation: 'lure', pressure: 'blocker',
  trial: 'drain', truth: 'calm', payoff: 'calm',
};

const _BASE_FALLBACK = [
  t('villain.fallback.1'), t('villain.fallback.2'), t('villain.fallback.3'),
  t('villain.fallback.4'), t('villain.fallback.5'),
  t('villain.fallback.6'),
  t('villain.fallback.7'), t('villain.fallback.8'),
  t('villain.fallback.9'), t('villain.fallback.10'),
  t('villain.fallback.11'), t('villain.fallback.12'),
  t('villain.fallback.13'), t('villain.fallback.14'), t('villain.fallback.15'),
  t('villain.fallback.16'), t('villain.fallback.17'),
  t('villain.fallback.18'),
];
const _VETERAN_FALLBACK = [
  t('villain.veteran.1'), t('villain.veteran.2'),
  t('villain.veteran.3'), t('villain.veteran.4'),
  t('villain.veteran.5'), t('villain.veteran.6'),
  t('villain.veteran.7'), t('villain.veteran.8'),
  t('villain.veteran.9'), t('villain.veteran.10'),
  t('villain.veteran.11'),
  t('villain.veteran.12'),
];
// Merge veteran lines in after 3+ sessions (lazy — GameHistory defined below)
let FALLBACK_LINES = _BASE_FALLBACK;
function _initFallbackLines() {
  const h = GameHistory.get();
  if (h.totalGames >= 3) FALLBACK_LINES = [..._BASE_FALLBACK, ..._VETERAN_FALLBACK];
}

// 无服务时的备用 Trial 内容（旋转池，不重复）
const FALLBACK_TRIALS = [
  { prompt: t('trial.fallback.prompt.1'), evaluation_guide: t('trial.fallback.eval.1'), hint: '' },
  { prompt: t('trial.fallback.prompt.2'), evaluation_guide: t('trial.fallback.eval.2'), hint: '' },
  { prompt: t('trial.fallback.prompt.3'), evaluation_guide: t('trial.fallback.eval.3'), hint: '' },
  { prompt: t('trial.fallback.prompt.4'), evaluation_guide: t('trial.fallback.eval.4'), hint: '' },
  { prompt: t('trial.fallback.prompt.5'), evaluation_guide: t('trial.fallback.eval.5'), hint: '' },
  { prompt: t('trial.fallback.prompt.6'), evaluation_guide: t('trial.fallback.eval.6'), hint: '' },
];
let _fallbackTrialIdx = 0;
function getFallbackTrial() {
  return FALLBACK_TRIALS[_fallbackTrialIdx++ % FALLBACK_TRIALS.length];
}
// Legacy compat — some code uses FALLBACK_TRIAL as a constant
const FALLBACK_TRIAL = FALLBACK_TRIALS[0];

// ═══════════════════════════════════════════════════════════════
// TAUNT POOLS
// ═══════════════════════════════════════════════════════════════
const GODHAND_TAUNTS = [
  t('godhand.taunt.1'),
  t('godhand.taunt.2'),
  t('godhand.taunt.3'),
  t('godhand.taunt.4'),
  t('godhand.taunt.5'),
  t('godhand.taunt.6'),
];
const GODHAND_SETTLE_LINES = [
  t('godhand.settle.1'),
  t('godhand.settle.2'),
  t('godhand.settle.3'),
  t('godhand.settle.4'),
];
const RETREAT_TAUNTS = [
  t('retreat.taunt.1'),
  t('retreat.taunt.2'),
  t('retreat.taunt.3'),
  t('retreat.taunt.4'),
  t('retreat.taunt.5'),
  t('retreat.taunt.6'),
];

// ═══════════════════════════════════════════════════════════════
// GAME STATE
// ═══════════════════════════════════════════════════════════════
const state = {
  maze: [], visited: new Set(), visitedAt: new Map(), // posKey → step number (for memory decay)
  playerPos: { x:1, y:1 }, exitPos: { x:GRID_W-2, y:GRID_H-2 }, // overwritten by generateMaze()
  steps: 0, depth: 0, history: [],
  hp: 3, godHandCount: 0,
  minigameFailCount: 0, minigameReturnPos: null,
  currentMechanism: null,
  /** 游戏阶段：idle | moving | event | trial | gameover */
  mode: 'idle',
  facing: null,   // {x,y} 上一步移动方向，用于判断转向
  recentCards: [],
  effects: {
    echoLoopSteps: 0,
    memoryScrambleSteps: 0,
    panicMoveToken: 0,
    wallCloseDir: null,
    wallCloseSteps: 0,
    shadowChaseSteps: 0,
    countdownSteps: 0,
    countdownStartDepth: 0,
    _countdownPulse: null,
    _countdownIndicator: null,
  },
  // ── Director Deck 追踪 ──
  deck: {
    idx: 0,
    knowledgeFlags: {
      mazeRemembersBacktrack: false,
      agentIsAdversarial:     false,
      exitIsConditional:      false,
      agentJudgesAnswers:     false,
      firstTrialDone:         false,
      // Bonus truth flags (don't affect exit conditions)
      mazeIsYourMemory:       false,
      villainKnowsYou:        false,
      trialIsPersonal:        false,
      temptationIsLearned:    false,
    },
    stepsSinceLastTrial: 99,
    skipCount: 0,
    deferredTrials: [],  // trials skipped by cooldown, re-inserted on next eligible draw
  },
  sessionDecisions: [],   // 行为决策日志
  // ── 行为感知原始数据 ──
  _behaviorRaw: {
    gameStartTime: 0,           // 游戏开始时间戳
    lastInputTime: 0,           // 最后一次操作时间戳
    moveTimestamps: [],         // 每步的时间戳 [ms, ms, ...]
    trialTimings: [],           // [{promptShownAt, submittedAt, responseMs, inputLength, passed}, ...]
    temptationChoices: [],      // ['follow'|'ignore', ...]
    hpLossEvents: [],           // [{step, cause, hpAfter}, ...]
    directionSequence: [],      // [{dx,dy}, ...] — 每步的方向向量
    pauseDurations: [],         // 两步之间的间隔时间 [ms, ms, ...]
    inputEditCount: 0,          // trial 输入框总编辑次数（衡量犹豫程度）
    retreatCount: 0,            // 使用「后退」逃离 trial 次数
    godHandCount: 0,            // 上帝之手使用次数
    lockedExitAttempts: 0,      // 尝试未解锁出口次数
  },
  lastTrialData: null,    // 当前 Trial 的 { prompt, evaluation_guide, hint }
  _exitUnlockNotified: false,  // 出口解锁通知标记
  _triggeredHp1Warning: false, // 第一次降到 HP=1 时特殊台词触发标记
  recentTrialResults: [],      // 最近 Trial 结果 ['pass'|'fail']，用于动态难度
  lureCache: [],          // 预加载的个人化线索素材
  lureCacheLoaded: false, // 是否已加载
  villainGameId: null,    // 当前局的 villain session ID（由 /api/villain/start 返回）
  consecutiveNonCalm: 0,  // 连续非 calm 卡计数（用于 payoff 判定）
};

// ═══════════════════════════════════════════════════════════════
// API INTEGRATION — Card Preload Queue (next-3)
// ═══════════════════════════════════════════════════════════════
const cardQueue = [];        // Array<Promise<{card_type, speech_line, …}>>
const QUEUE_TARGET = 3;

function buildGameState() {
  const dx = Math.abs(state.playerPos.x - state.exitPos.x);
  const dy = Math.abs(state.playerPos.y - state.exitPos.y);
  const d = dx + dy;

  // ── Behavioral analytics ─────────────────────────────────────
  const decisions = state.sessionDecisions;
  const moveDecs  = decisions.filter(d => d.type === 'move' || d.type === 'backtrack');
  const backtrackCount = decisions.filter(d => d.type === 'backtrack').length;

  // Stubborn direction: 3+ consecutive moves in same direction
  let stubbornDir = null;
  if (moveDecs.length >= 3) {
    const last3 = moveDecs.slice(-3);
    if (!last3.some(m => m.type === 'backtrack')) {
      const dirs = last3.map(m => m.to ? `${m.to.x - (m.from?.x||0)},${m.to.y - (m.from?.y||0)}` : null).filter(Boolean);
      if (dirs.length === 3 && dirs[0] === dirs[1] && dirs[1] === dirs[2]) stubbornDir = dirs[0];
    }
  }

  // Trial stats
  const trialDecs = decisions.filter(d => d.type === 'trial-answer');
  const trialPass = trialDecs.filter(d => d.passed).length;
  const trialFail = trialDecs.filter(d => !d.passed).length;

  // Active mechanism
  let activeMechanism = null;
  if (state.effects.countdownSteps > 0)     activeMechanism = 'COUNTDOWN';
  else if (state.effects.shadowChaseSteps > 0) activeMechanism = 'SHADOW_CHASE';
  else if (state.effects.wallCloseSteps > 0)   activeMechanism = 'WALL_CLOSE';
  else if (state.effects.memoryScrambleSteps > 0) activeMechanism = 'MEMORY_SCRAMBLE';
  else if (state.effects.echoLoopSteps > 0)   activeMechanism = 'ECHO_LOOP';
  else if (state.currentMechanism)             activeMechanism = state.currentMechanism.id;

  // Recent decisions (last 5 for villain context)
  const recentDecisions = decisions.slice(-5).map(d => ({ type: d.type, step: d.step }));

  // ── Raw behavioral data for villain perception ──
  const raw = state._behaviorRaw;
  const now = Date.now();
  const playTimeMs = raw.gameStartTime ? now - raw.gameStartTime : 0;
  const timeSinceLastInput = raw.lastInputTime ? now - raw.lastInputTime : 0;

  // Pace: last 5 intervals between moves
  const recentPauses = raw.pauseDurations.slice(-5);

  // Temptation pattern
  const tempChoices = raw.temptationChoices;
  const tempFollowCount = tempChoices.filter(c => c === 'follow').length;
  const tempIgnoreCount = tempChoices.filter(c => c === 'ignore').length;

  // Trial timing: raw recent data
  const recentTrials = raw.trialTimings.slice(-5).map(t => ({
    response_ms: t.responseMs,
    input_length: t.inputLength,
    passed: t.passed,
  }));

  // Direction pattern: last 8 moves
  const recentDirs = raw.directionSequence.slice(-8).map(d => {
    if (d.dy < 0) return 'N'; if (d.dy > 0) return 'S';
    if (d.dx > 0) return 'E'; if (d.dx < 0) return 'W';
    return '?';
  });

  return {
    steps: state.steps,
    hp: state.hp,
    god_hand_count: state.godHandCount,
    god_hand_used: state.godHandCount,
    distance_to_exit: d <= 4 ? 'very_near' : d <= 8 ? 'near' : d <= 16 ? 'mid' : 'far',
    distance_to_exit_raw: d,
    recent_cards: state.recentCards.slice(-6),
    deck_idx: state.deck.idx,
    knowledge_flags: state.deck.knowledgeFlags,
    decision_count: decisions.length,
    gameId: state.villainGameId,
    active_mechanism: activeMechanism,
    recent_decisions: recentDecisions,
    // ── Raw behavioral signals (agent interprets, harness doesn't) ──
    behavior: {
      play_time_ms: playTimeMs,
      time_since_last_input_ms: timeSinceLastInput,
      total_moves: moveDecs.length,
      backtrack_count: backtrackCount,
      backtrack_streak: state._backtrackStreak || 0,
      stubborn_direction: stubbornDir,
      recent_directions: recentDirs,
      recent_pause_ms: recentPauses,
      temptation_follow: tempFollowCount,
      temptation_ignore: tempIgnoreCount,
      trial_pass: trialPass,
      trial_fail: trialFail,
      recent_trials: recentTrials,
      hp_loss_events: raw.hpLossEvents.slice(-5),
      retreat_count: raw.retreatCount,
      god_hand_count: raw.godHandCount,
      locked_exit_attempts: raw.lockedExitAttempts,
    },
  };
}

// ── 行为决策日志 ─────────────────────────────────────────────────
function logDecision(type, data = {}) {
  const now = Date.now();
  state.sessionDecisions.push({ timestamp: now, step: state.steps, type, ...data });

  // Feed raw behavioral data
  const raw = state._behaviorRaw;
  if (!raw.gameStartTime) raw.gameStartTime = now;

  // Track pause between inputs
  if (raw.lastInputTime) {
    raw.pauseDurations.push(now - raw.lastInputTime);
  }
  raw.lastInputTime = now;

  if (type === 'move' || type === 'backtrack') {
    raw.moveTimestamps.push(now);
    if (data.from && data.to) {
      raw.directionSequence.push({ dx: data.to.x - data.from.x, dy: data.to.y - data.from.y });
    }
  } else if (type === 'lure-follow') {
    raw.temptationChoices.push('follow');
    if (data.hpLost) raw.hpLossEvents.push({ step: state.steps, cause: 'temptation_trap', hpAfter: state.hp });
  } else if (type === 'lure-ignore') {
    raw.temptationChoices.push('ignore');
  } else if (type === 'trial-answer') {
    // trialTimings populated separately in trials.js with timing data
  } else if (type === 'retreat') {
    raw.retreatCount++;
  } else if (type === 'god-hand') {
    raw.godHandCount++;
  } else if (type === 'locked-exit-attempt') {
    raw.lockedExitAttempts++;
  }
}

// ── HP event tracking (fire-and-forget to server session log) ────────────────
function logHpEvent(cause, delta) {
  if (!serverMode || !state.villainGameId) return;
  const hpAfter = state.hp;
  fetch('/api/hp-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameId: state.villainGameId,
      cause,
      delta,
      hpBefore: hpAfter - delta,
      hpAfter,
      step: state.steps || 0,
    }),
  }).catch(() => {});
}

// ── Bonus truth flags (revealed after all primary truths are known) ──────────
const BONUS_TRUTH_FLAGS = ['mazeIsYourMemory', 'villainKnowsYou', 'trialIsPersonal', 'temptationIsLearned'];

function getUnseenBonusTruth() {
  const f = state.deck.knowledgeFlags;
  const unseen = BONUS_TRUTH_FLAGS.filter(flag => !f[flag]);
  return unseen.length > 0 ? unseen[Math.floor(Math.random() * unseen.length)] : null;
}

// ── Director Deck：抽牌与跳过规则 ───────────────────────────────
function shouldSkipCard(card) {
  const f = state.deck.knowledgeFlags;
  if (card.role === 'truth' && card.flag && f[card.flag]) return true;
  // Trial cooldown: was 7 steps → reduced to 4. At 7, most trials in dense deck
  // regions (Cycle 1: indices 2/5/7) were skipped and lost, causing drain=2% in playtests.
  if (card.role === 'trial' && state.deck.stepsSinceLastTrial < 4) return true;
  if (card.role === 'trial' && card.subtype === 'sacrifice' && state.hp <= 1) return true;
  if (card.role === 'payoff' && !card.lite && !f.firstTrialDone) return true;
  return false;
}

// Cycle 3 starts at index 20 and ends at 29 (10 pressure-heavy cards)
const CYCLE3_START = 20;

function drawNextCard() {
  // Priority: check deferred trial queue first (trials that were skipped by cooldown)
  if (state.deck.deferredTrials.length > 0 && state.deck.stepsSinceLastTrial >= 4) {
    const deferred = state.deck.deferredTrials.shift();
    state.deck.skipCount = 0;
    console.log('[deck] drawing deferred trial (was skipped by cooldown earlier)');
    return deferred;
  }

  let attempts = 0;
  while (attempts < DIRECTOR_DECK.length) {
    const card = DIRECTOR_DECK[state.deck.idx];
    state.deck.idx++;

    // After first full pass, loop only through Cycle 3 (pressure cycle)
    // This prevents tension from resetting to "teaching" mode in long games
    if (state.deck.idx >= DIRECTOR_DECK.length) {
      if (!state.deck._completedFirstPass) {
        state.deck._completedFirstPass = true;
        console.log('[deck] first full pass complete — locking to Cycle 3');
      }
      state.deck.idx = CYCLE3_START;
    }

    if (shouldSkipCard(card)) {
      // When a trial is skipped by cooldown, defer it instead of discarding
      if (card.role === 'trial' && state.deck.stepsSinceLastTrial < 4) {
        state.deck.deferredTrials.push(card);
        console.log(`[deck] trial deferred (cooldown, ${state.deck.deferredTrials.length} in queue)`);
      }
      // When a truth card is skipped (already known), try to substitute with bonus truth
      if (card.role === 'truth' && card.flag) {
        const bonus = getUnseenBonusTruth();
        if (bonus) {
          state.deck.skipCount = 0;
          return { role: 'truth', dealer: 'REVELATION', flag: bonus };
        }
      }
      state.deck.skipCount++; attempts++; continue;
    }
    state.deck.skipCount = 0;
    return card;
  }
  return { role: 'relief', dealer: 'EMPTY' }; // 安全兜底
}

function resolveCardFromConfig(cfg) {
  return {
    id:         cfg.dealer,
    type:       ROLE_TO_TYPE[cfg.role] || 'calm',
    role:       cfg.role,
    difficulty: cfg.difficulty,
    flag:       cfg.flag,
    lite:       cfg.lite,
    anchor:     cfg.anchor,
    name:       cfg.dealer,
    desc:       '',
  };
}

function fallbackSpeech(role) {
  return {
    card_type: ROLE_TO_TYPE[role] || 'calm',
    speech_line: FALLBACK_LINES[Math.floor(Math.random() * FALLBACK_LINES.length)],
  };
}

function fallbackCard() {
  const cfg = drawNextCard();
  state.deck.stepsSinceLastTrial++;
  if (cfg.role === 'trial') { state.deck.stepsSinceLastTrial = 0; state.lastTrialData = getFallbackTrial(); }
  return { ...fallbackSpeech(cfg.role), _cardConfig: cfg };
}


function setAiThinking(v) {
  UI.setText('ai-state', v ? t('ui.status.aiThinking') : t('ui.status.aiReady'));
  UI.toggle('ai-state', 'thinking', v);
  UI.toggle('ai-speech-bar', 'thinking', v);
  // Centered game-area indicator
  const gt = DOM.id('game-thinking');
  if (gt) gt.classList.toggle('hidden', !v);
  // Eye narrows while "thinking" — subtle scanning animation
  const eye = DOM.id('ai-eye');
  if (eye) eye.classList.toggle('thinking', v);
}

// ═══════════════════════════════════════════════════════════════
// AI EYE EMOTION SYSTEM
// ═══════════════════════════════════════════════════════════════
const EMOTION_CLASSES = ['emotion-mocking','emotion-anxious','emotion-angry','emotion-satisfied','emotion-curious'];
let _emotionTimer = null;

/**
 * Set AI eye emotion variant.
 * @param {'mocking'|'anxious'|'angry'|'satisfied'|'curious'|'default'} emotion
 * @param {number} durationMs - auto-revert to default after this (0 = permanent until next call)
 */
function setEyeEmotion(emotion, durationMs = 4000) {
  const eye = DOM.id('ai-eye');
  if (!eye) return;
  if (_emotionTimer) { clearTimeout(_emotionTimer); _emotionTimer = null; }
  EMOTION_CLASSES.forEach(c => eye.classList.remove(c));
  if (emotion && emotion !== 'default') {
    eye.classList.add('emotion-' + emotion);
    if (durationMs > 0) {
      _emotionTimer = setTimeout(() => {
        EMOTION_CLASSES.forEach(c => eye.classList.remove(c));
        _emotionTimer = null;
      }, durationMs);
    }
  }
}

/**
 * Auto-detect eye emotion from game context.
 * Called after card resolution / trial / HP changes.
 */
function updateEyeEmotionFromContext(card, outcome) {
  if (!card) return;
  if (outcome === 'hp_loss') { setEyeEmotion('satisfied', 5000); return; }
  if (outcome === 'trial_pass') { setEyeEmotion('angry', 3000); return; }
  if (outcome === 'trial_fail') { setEyeEmotion('mocking', 4000); return; }
  if (state.exitProximity && state.exitProximity <= 8) { setEyeEmotion('anxious', 0); return; }
  if (card.card_type === 'lure' || card.id === 'BEAUTY_TRAP' || card.id === 'REWARD_MIRAGE') {
    setEyeEmotion('curious', 4000); return;
  }
  if (card.card_type === 'blocker' || card.id === 'WALL_CLOSE' || card.id === 'SHADOW_CHASE' || card.id === 'COUNTDOWN') {
    setEyeEmotion('mocking', 3500); return;
  }
}

// ── Dynamic difficulty adjustment ──
const DIFF_LEVELS = ['medium', 'hard'];
function adjustDifficulty(baseDifficulty) {
  // Map old 'easy' to 'medium' (easy no longer exists)
  let effective = baseDifficulty === 'easy' ? 'medium' : baseDifficulty;
  let idx = DIFF_LEVELS.indexOf(effective);
  if (idx < 0) idx = 0; // default medium

  const recent = state.recentTrialResults;
  const lastN = recent.slice(-3);
  const consecutiveFails = lastN.length > 0 && lastN.every(r => r === 'fail') ? lastN.length : 0;
  const consecutivePasses = lastN.length > 0 && lastN.every(r => r === 'pass') ? lastN.length : 0;

  // Mercy: HP=1 → cap at medium (idx 0); fail streak → cap at medium
  if (state.hp === 1) idx = Math.min(idx, 0);
  if (consecutiveFails >= 3) idx = Math.min(idx, 0);

  // Escalation: full HP + deep in game, or pass streak → harder
  if (state.hp >= 3 && state.steps > 30) idx = Math.min(1, idx + 1);
  if (consecutivePasses >= 3) idx = Math.min(1, idx + 1);

  // Cross-session escalation: veteran winners face harder trials
  const hist = GameHistory.get();
  if (hist.wins >= 3) idx = Math.min(1, idx + 1);

  const adjusted = DIFF_LEVELS[idx];
  if (adjusted !== baseDifficulty) {
    console.log(`[dynamic-difficulty] ${baseDifficulty} → ${adjusted} (HP=${state.hp}, steps=${state.steps}, recent=${lastN.join(',')})`);
  }
  return adjusted;
}

function preloadCard() {
  const showThinking = cardQueue.length === 0;
  if (showThinking) setAiThinking(true);

  const gs = buildGameState();
  const cfg = drawNextCard();
  state.deck.stepsSinceLastTrial++;

  let p;
  if (cfg.role === 'trial') {
    state.deck.stepsSinceLastTrial = 0;
    const difficulty = adjustDifficulty(cfg.difficulty);
    if (serverMode) {
      p = fetch('/api/fill/trial', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...gs, difficulty, gameId: state.villainGameId }),
      }).then(r => r.json())
        .then(trial => { state.lastTrialData = trial; return { card_type:'drain', speech_line:t('trial.speech.precheck'), _cardConfig: cfg }; })
        .catch(() => { state.lastTrialData = getFallbackTrial(); return { card_type:'drain', speech_line:t('trial.speech.precheck'), _cardConfig: cfg }; })
        .finally(() => { if (showThinking) setAiThinking(false); });
    } else {
      state.lastTrialData = getFallbackTrial();
      p = Promise.resolve({ card_type:'drain', speech_line:t('trial.speech.precheck'), _cardConfig: cfg });
      if (showThinking) setAiThinking(false);
    }
  } else {
    // ── Temptation pre-allocation: pop lure + resolve enhanced data ──
    let preLure = null;
    if (cfg.role === 'temptation') {
      preLure = _preAllocateLure();
      // Narrative now uses an independent LLM call — safe to fire immediately.
      if (preLure) preLure.narrativePromise = _fireNarrativePrefetch(preLure);
    }

    if (serverMode) {
      p = fetch('/api/card', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...gs, forced_role: cfg.role, gameId: state.villainGameId }),
      }).then(r => r.json())
        .then(raw => {
          // Card response is back — now safe to fire async prefetches
          // Truth reveal prefetch: fire after card response to stay serialized
          if (cfg.role === 'truth' && cfg.flag) {
            raw._truthRevealPromise = _prefetchTruthReveal(cfg.flag, gs);
          }
          return { ...raw, _cardConfig: cfg, _preLure: preLure };
        })
        .catch(() => ({ ...fallbackSpeech(cfg.role), _cardConfig: cfg, _preLure: preLure }))
        .finally(() => { if (showThinking) setAiThinking(false); });
    } else {
      p = Promise.resolve({ ...fallbackSpeech(cfg.role), _cardConfig: cfg, _preLure: preLure });
      if (showThinking) setAiThinking(false);
    }
  }
  cardQueue.push(p);
}

/** Fill the preload queue toward QUEUE_TARGET (3). Safe to call repeatedly. */
function fillQueue() {
  while (cardQueue.length < QUEUE_TARGET && state.mode !== 'gameover') {
    preloadCard();
  }
}

/**
 * Pre-allocate lure material + resolve enhanced data + prefetch narrative
 * during preloadCard so everything is ready when the temptation card triggers.
 * Returns { lureMat, enhancedLure, narrativePromise } or null.
 */
function _preAllocateLure() {
  const lureMat = popLureItem();
  if (!lureMat) return null;

  // Resolve enhanced data (same logic as mechanics.js had)
  let enhancedLure = null;
  if (window.LureViewer) {
    try {
      const eCache = state._enhancedLureCache || [];
      const luMatPath = lureMat.imagePath || lureMat.path || '';
      const luMatBase = lureMat.preview || luMatPath.split('/').pop() || '';
      const matched = eCache.find(e => {
        if (!e.path) return false;
        const ePath = e.path;
        if (luMatPath && ePath === luMatPath) return true;
        if (luMatBase && ePath.split('/').pop() === luMatBase) return true;
        return false;
      });
      if (matched) {
        enhancedLure = matched;
      } else if (lureMat.type === 'image' && lureMat.imagePath) {
        enhancedLure = { ...lureMat, path: lureMat.imagePath, isText: false };
      } else if (lureMat.textPreview || lureMat.preview) {
        enhancedLure = {
          ...lureMat,
          path: lureMat.path || lureMat.preview || t('lure.enhanced.unknownFile'),
          isText: true,
          textPreview: lureMat.textPreview || lureMat.preview,
        };
      }
    } catch { /* no enhanced data */ }
  }

  console.log('[lure] pre-allocated:', lureMat ? `type=${lureMat.type} preview=${(lureMat.preview||'').slice(0,30)}` : 'null');
  return { lureMat, enhancedLure, narrativePromise: null };
}

/**
 * Fire the narrative prefetch request. Narrative now uses an independent LLM call,
 * so it can start immediately during lure pre-allocation without session contention.
 */
function _fireNarrativePrefetch(preLure) {
  if (!preLure || !serverMode) return null;
  const { lureMat, enhancedLure } = preLure;
  const lureDataForNarrative = enhancedLure ? {
    ...enhancedLure,
    type: lureMat.type || (enhancedLure.isText ? 'text' : 'image'),
    imagePath: lureMat.imagePath || (!enhancedLure.isText ? enhancedLure.path : undefined),
    gameId: state.villainGameId,
    hp: state.hp,
    steps: state.steps,
  } : null;
  if (!lureDataForNarrative) return null;

  console.log('[lure] narrative prefetch started (pre-allocated)');
  return fetch('/api/lure/narrative', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameId: lureDataForNarrative.gameId,
      summary: lureDataForNarrative.summary,
      description: lureDataForNarrative.description,
      tags: lureDataForNarrative.tags,
      mood: lureDataForNarrative.mood,
      path: lureDataForNarrative.path,
      name: lureDataForNarrative.name,
      type: lureDataForNarrative.type,
      isText: lureDataForNarrative.isText,
      lureHook: lureDataForNarrative.lureHook,
      textPreview: (lureDataForNarrative.contentPreview || lureDataForNarrative.textPreview || '').slice(0, 800),
      hp: lureDataForNarrative.hp,
      steps: lureDataForNarrative.steps,
    }),
  }).then(r => r.json())
    .then(data => (data.narrative || '').trim())
    .catch(() => '');
}

/**
 * Prefetch truth revelation text from agent during preloadCard.
 * Called AFTER card response to stay serialized with villain session.
 */
function _prefetchTruthReveal(flag, gs) {
  if (!serverMode || !state.villainGameId) return null;
  console.log('[truth] revelation prefetch started for flag:', flag);
  return fetch('/api/truth/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameId: state.villainGameId,
      flag,
      steps: state.steps,
      hp: state.hp,
      behavior: gs.behavior || null,
    }),
  }).then(r => r.json())
    .catch(() => ({ revelation: null, mood: null }));
}

async function getCard() {
  if (cardQueue.length === 0) return fallbackCard();
  const p = cardQueue.shift();
  try   { return await p; }
  catch { return fallbackCard(); }
  finally {
    // Refill queue toward target (async, next microtask)
    setTimeout(() => fillQueue(), 0);
  }
}

// ── Speculative prefetch: top-up the queue during idle windows ──
// Called when player is busy (reading trial, temptation overlay, event overlay).
let _specPrefetchTimer = null;
function speculativePrefetch(delayMs = 500) {
  if (_specPrefetchTimer) return; // already scheduled
  _specPrefetchTimer = setTimeout(() => {
    _specPrefetchTimer = null;
    if (cardQueue.length < QUEUE_TARGET && state.mode !== 'gameover') {
      console.log('[speculation] topping up card queue during idle window');
      fillQueue();
    }
  }, delayMs);
}

// ═══════════════════════════════════════════════════════════════
// VILLAIN SESSION LIFECYCLE
// ═══════════════════════════════════════════════════════════════

/** Start a new villain session for this game. No-op if not in server mode. */
async function startVillainSession() {
  if (!serverMode) return;
  try {
    const res = await fetch('/api/villain/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const data = await res.json();
      state.villainGameId = data.gameId || null;
    }
  } catch (e) {
    console.warn('[villain] failed to start session:', e.message);
  }
  // Preload lure materials (non-blocking)
  loadLureCache();
}

async function loadLureCache() {
  // Seed cross-game dedup: fetch recently used lure keys from backend
  try {
    const exRes = await fetch('/api/lure/excluded');
    if (exRes.ok) {
      const { keys } = await exRes.json();
      if (Array.isArray(keys)) {
        for (const k of keys) _usedLureKeys.add(k);
        if (keys.length > 0) console.log(`[lure] cross-game dedup: ${keys.length} materials excluded`);
      }
    }
  } catch {}

  try {
    const res = await fetch('/api/lure');
    if (res.ok) {
      const data = await res.json();
      state.lureCache = data.items || [];
      state.lureCacheLoaded = true;
    }
  } catch (e) {
    console.warn('[lure] failed to load materials:', e.message);
  }

  // Also load enhanced (vision-analyzed) lure materials
  try {
    const res = await fetch('/api/lure/enhanced');
    if (res.ok) {
      const data = await res.json();
      state._enhancedLureCache = data.items || [];
      console.log(`[lure] loaded ${state._enhancedLureCache.length} enhanced items`);

      // ── Inject enhanced items directly into lure pool ──
      // Vision-analyzed files (Desktop, Downloads, Pictures) never appear in the
      // standard /api/lure pool; inject a sample so they actually show up in-game
      // with full description/tags/mood/lureHook for richer overlay + narrative.
      const enhanced = state._enhancedLureCache;
      if (enhanced.length > 0) {
        const shuffle = arr => {
          for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
          }
          return arr;
        };

        const imgItems  = shuffle(enhanced.filter(e => !e.isText));
        const textItems = shuffle(enhanced.filter(e =>  e.isText));

        const toInject = [];

        // Up to 3 images
        for (const e of imgItems.slice(0, 3)) {
          toInject.push({
            type:        'image',
            title:       e.lureHook || t('lure.enhanced.imageMemory'),
            preview:     e.lureHook || e.description || '',
            imagePath:   e.path,
            description: e.description,
            tags:        e.tags,
            mood:        e.mood,
            lureHook:    e.lureHook,
          });
        }

        // Up to 3 text files
        for (const e of textItems.slice(0, 3)) {
          toInject.push({
            type:        'text',
            title:       e.lureHook || t('lure.enhanced.fileMemory'),
            preview:     e.lureHook || e.description || '',
            path:          e.path,
            content:       e.content,
            contentPreview:e.contentPreview || e.textPreview,
            textPreview:   e.textPreview,
            description:   e.description,
            summary:       e.summary || e.description,
            tags:          e.tags,
            mood:          e.mood,
            lureHook:      e.lureHook,
            isText:        true,
            language:      e.language,
          });
        }

        // Scatter randomly into existing lure cache
        for (const item of toInject) {
          const pos = Math.floor(Math.random() * (state.lureCache.length + 1));
          state.lureCache.splice(pos, 0, item);
        }
        if (toInject.length > 0) {
          console.log(`[lure] injected ${toInject.length} enhanced items into lure pool (total: ${state.lureCache.length})`);
        }
      }
    }
  } catch (e) {
    console.warn('[lure] enhanced cache not available:', e.message);
  }
}

// Track used lure items to prevent repetition within + across game sessions
const _usedLureKeys = new Set();   // normalized keys (last 3 path segments, lowercase)
const _usedLurePreviews = new Set();

// Must match server/lure-allocator.js _keyFromPath
function _lureKey(filePath) {
  return (filePath || '').replace(/\\/g, '/').split('/').slice(-3).join('/').toLowerCase();
}

function popLureItem() {
  if (!state.lureCache.length) return null;

  // Try to find an unused item (scan from end, max 20 attempts)
  for (let i = state.lureCache.length - 1; i >= 0 && i >= state.lureCache.length - 20; i--) {
    const item = state.lureCache[i];
    const key = _lureKey(item.path || item.imagePath || '');
    const previewKey = (item.preview || '').slice(0, 50);

    if (key && _usedLureKeys.has(key)) continue;
    if (previewKey && _usedLurePreviews.has(previewKey)) continue;

    // Found unused item — remove from cache and mark as used
    state.lureCache.splice(i, 1);
    if (key) _usedLureKeys.add(key);
    if (previewKey) _usedLurePreviews.add(previewKey);
    _notifyLureUsed(item);
    return item;
  }

  // All items in range were used — fall back to popping last (allows some repetition when pool exhausted)
  const item = state.lureCache.pop();
  const key = _lureKey(item.path || item.imagePath || '');
  if (key) _usedLureKeys.add(key);
  _notifyLureUsed(item);
  return item;
}

// Notify backend when a lure item is consumed (for fact-db cooldown + allocator dedup)
function _notifyLureUsed(item) {
  if (!item) return;
  const payload = {
    path: item.path || item.imagePath || '',
    name: item.title || item.name || '',
    gameId: state.villainGameId || '',
  };
  fetch('/api/lure/used', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {}); // fire-and-forget
}

// Reset lure dedup on game restart
function resetLureDedup() {
  _usedLureKeys.clear();
  _usedLurePreviews.clear();
}

/** End the current villain session. No-op if no session or not server mode. */
function endVillainSession(outcome) {
  if (!serverMode || !state.villainGameId) return;
  const gameId = state.villainGameId;
  state.villainGameId = null;

  // Collect game stats for mid-term memory
  const decisions = state.sessionDecisions || [];
  const moves = decisions.filter(d => d.type === 'move' || d.type === 'backtrack');
  const lureFollows = decisions.filter(d => d.type === 'lure-follow').length;
  const lureIgnores = decisions.filter(d => d.type === 'lure-ignore').length;
  const trialAnswers = decisions.filter(d => d.type === 'trial-answer');
  // Count unique trial encounters (by prompt), not individual attempts
  const trialPrompts = new Set(trialAnswers.map(d => d.prompt || ''));
  const trialEncounters = trialPrompts.size;
  const trialPassedPrompts = new Set(trialAnswers.filter(d => d.passed).map(d => d.prompt || ''));
  const trialPassed = trialPassedPrompts.size;

  // Card stats from recentCards (fix: was incorrectly using state.recent_cards)
  const cardStats = {};
  for (const c of (state.recentCards || [])) { cardStats[c] = (cardStats[c] || 0) + 1; }

  // Temptation trapping: lure follows that cost HP
  const lureTraps = decisions.filter(d => d.type === 'lure-follow' && d.hpLost).length;

  // fire-and-forget
  fetch('/api/villain/end', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameId,
      outcome: outcome || 'unknown',
      totalSteps: state.steps || 0,
      finalHp: state.hp,
      maxHp: 3,
      cardStats,
      trialStats: { total: trialEncounters, passed: trialPassed, failed: trialEncounters - trialPassed, totalAttempts: trialAnswers.length },
      godHandCount: state.godHandCount || 0,
      temptationStats: { followed: lureFollows, ignored: lureIgnores, trappedByTemptation: lureTraps },
      decisions: moves.map(m => ({ type: m.type, from: m.from, to: m.to })),
      truthsDiscovered: Object.entries(state.deck.knowledgeFlags)
        .filter(([k, v]) => v === true && k !== 'exitIsConditional' && k !== 'firstTrialDone')
        .map(([k]) => k),
    }),
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
// SERVER DETECTION & STARTUP
// ═══════════════════════════════════════════════════════════════
async function detectServer() {
  try {
    const res = await fetch('/api/ping', { signal: AbortSignal.timeout(2000) });
    if (res.ok) { serverMode = true; return true; }
  } catch {}
  return false;
}

// ── 连接设置面板 ─────────────────────────
let _connectSelectedProvider = 'openclaw-gateway';
let _connectTestPassed = false;

const CONNECT_PRESETS = {
  'openclaw-gateway': { models: ['anthropic/claude-sonnet-4-20250514', 'openai/gpt-5.4', 'openclaw/default'], needsKey: false, needsBase: false },
  anthropic: { models: ['anthropic/claude-sonnet-4-20250514', 'anthropic/claude-haiku-4-5-20251001'], needsKey: true, needsBase: false, placeholder: 'sk-ant-...' },
  openai: { models: ['openai/gpt-4o-mini', 'openai/gpt-4o', 'openai/gpt-4.1-mini'], needsKey: true, needsBase: false, placeholder: 'sk-...' },
  custom: { models: [], needsKey: true, needsBase: true, placeholder: 'your-api-key' },
};

function showConnectOverlay() {
  document.getElementById('connect-overlay').classList.remove('hidden');
  _connectTestPassed = false;
  document.getElementById('connect-save-btn').disabled = true;
  document.getElementById('connect-result').textContent = '';
  fetch('/api/config/provider').then(r => r.json()).then(cfg => {
    _connectSelectedProvider = cfg.provider || 'openclaw-gateway';
    document.getElementById('connect-model').value = cfg.model || '';
    const archField = document.getElementById('connect-archivist-model');
    if (archField) archField.value = cfg.archivistModel || '';
    document.getElementById('connect-status').textContent = cfg.source ? t('connect.status.current', { source: cfg.source, model: cfg.model || 'default' }) : t('connect.status.notConnected');
    document.querySelectorAll('.connect-tab').forEach(t => t.classList.toggle('active', t.dataset.provider === _connectSelectedProvider));
    _updateConnectFields();
    document.getElementById('connect-gateway-status').textContent = cfg.hasKey ? t('connect.gateway.connected') : t('connect.gateway.notFound');
  }).catch(() => {
    document.getElementById('connect-status').textContent = t('connect.status.serverError');
  });
}

function hideConnectOverlay() {
  document.getElementById('connect-overlay').classList.add('hidden');
}

function selectConnectProvider(provider) {
  _connectSelectedProvider = provider;
  _connectTestPassed = false;
  document.getElementById('connect-save-btn').disabled = true;
  document.getElementById('connect-result').textContent = '';
  document.querySelectorAll('.connect-tab').forEach(t => t.classList.toggle('active', t.dataset.provider === provider));
  _updateConnectFields();
}

function _updateConnectFields() {
  const preset = CONNECT_PRESETS[_connectSelectedProvider] || CONNECT_PRESETS.custom;
  const keyField = document.getElementById('connect-apikey-field');
  keyField.classList.toggle('hidden', !preset.needsKey);
  if (preset.placeholder) document.getElementById('connect-apikey').placeholder = preset.placeholder;
  document.getElementById('connect-base-field').classList.toggle('hidden', !preset.needsBase);
  document.getElementById('connect-gateway-info').classList.toggle('hidden', _connectSelectedProvider !== 'openclaw-gateway');
  const presetsEl = document.getElementById('connect-presets');
  if (preset.models.length) {
    presetsEl.innerHTML = preset.models.map(m =>
      `<button class="connect-preset-btn" onclick="document.getElementById('connect-model').value='${m}'">${m}</button>`
    ).join('');
    if (!document.getElementById('connect-model').value) {
      document.getElementById('connect-model').value = preset.models[0];
    }
  } else {
    presetsEl.innerHTML = '';
  }

  // Auth links per provider
  const authLinksEl = document.getElementById('connect-auth-links');
  if (authLinksEl) {
    if (_connectSelectedProvider === 'anthropic') {
      authLinksEl.innerHTML = `<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" class="connect-auth-link">${t('connect.auth.anthropic')}</a>`;
      authLinksEl.classList.remove('hidden');
    } else if (_connectSelectedProvider === 'openai') {
      authLinksEl.innerHTML = `<a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" class="connect-auth-link">${t('connect.auth.openai')}</a>`;
      authLinksEl.classList.remove('hidden');
    } else {
      authLinksEl.innerHTML = '';
      authLinksEl.classList.add('hidden');
    }
  }
}

async function testConnection() {
  const btn = document.getElementById('connect-test-btn');
  const resultEl = document.getElementById('connect-result');
  btn.disabled = true;
  btn.textContent = t('connect.testing');
  resultEl.textContent = '';
  resultEl.className = '';

  const body = { provider: _connectSelectedProvider };
  body.model = document.getElementById('connect-model').value.trim() || '';
  if (CONNECT_PRESETS[_connectSelectedProvider]?.needsKey) {
    body.apiKey = document.getElementById('connect-apikey').value.trim();
    if (!body.apiKey) {
      resultEl.textContent = t('connect.result.noKey');
      resultEl.className = 'connect-fail';
      btn.disabled = false;
      btn.textContent = t('connect.test');
      return;
    }
  }
  if (CONNECT_PRESETS[_connectSelectedProvider]?.needsBase) {
    body.apiBase = document.getElementById('connect-base').value.trim();
  }

  try {
    const res = await fetch('/api/config/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.textContent = t('connect.result.ok', { model: data.model, latency: data.latency });
      resultEl.className = 'connect-ok';
      _connectTestPassed = true;
      document.getElementById('connect-save-btn').disabled = false;
    } else {
      resultEl.textContent = t('connect.result.fail', { error: data.error || t('connect.result.connFail') });
      resultEl.className = 'connect-fail';
      _connectTestPassed = false;
      document.getElementById('connect-save-btn').disabled = true;
    }
  } catch (err) {
    resultEl.textContent = t('connect.result.requestFail', { message: err.message });
    resultEl.className = 'connect-fail';
    _connectTestPassed = false;
    document.getElementById('connect-save-btn').disabled = true;
  }
  btn.disabled = false;
  btn.textContent = t('connect.test');
}

async function saveConnection() {
  if (!_connectTestPassed) return;
  const archModel = (document.getElementById('connect-archivist-model')?.value || '').trim();
  const body = {
    provider: _connectSelectedProvider,
    model: document.getElementById('connect-model').value.trim(),
    archivistModel: archModel || undefined,
  };
  if (CONNECT_PRESETS[_connectSelectedProvider]?.needsKey) {
    body.apiKey = document.getElementById('connect-apikey').value.trim();
  }
  if (CONNECT_PRESETS[_connectSelectedProvider]?.needsBase) {
    body.apiBase = document.getElementById('connect-base').value.trim();
  }

  try {
    const res = await fetch('/api/config/provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.ok) {
      hideConnectOverlay();
      if (!state || state.mode === 'idle') {
        location.reload();
      }
    } else {
      document.getElementById('connect-result').textContent = t('connect.result.fail', { error: data.error || t('connect.result.saveFail') });
      document.getElementById('connect-result').className = 'connect-fail';
    }
  } catch (err) {
    document.getElementById('connect-result').textContent = t('connect.result.fail', { error: err.message });
    document.getElementById('connect-result').className = 'connect-fail';
  }
}

// ═══════════════════════════════════════════════════════════════
// MAZE GENERATION
// ═══════════════════════════════════════════════════════════════
function generateMaze() {
  const grid = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(CELL_WALL));

  // Spawn/exit configurations — mix of corners and interior positions
  // All configurations ensure Manhattan distance ~20-30 (optimal path ~45-55 steps with maze walls)
  const midX = Math.floor(GRID_W / 2) | 1; // ensure odd
  const midY = Math.floor(GRID_H / 2) | 1;
  const configurations = [
    // Corner → opposite corner (classic)
    { spawn: {x:1, y:1},             exit: {x:GRID_W-2, y:GRID_H-2} },
    { spawn: {x:GRID_W-2, y:1},      exit: {x:1, y:GRID_H-2} },
    { spawn: {x:1, y:GRID_H-2},      exit: {x:GRID_W-2, y:1} },
    { spawn: {x:GRID_W-2, y:GRID_H-2}, exit: {x:1, y:1} },
    // Center → corner (player starts in the middle)
    { spawn: {x:midX, y:midY},       exit: {x:1, y:1} },
    { spawn: {x:midX, y:midY},       exit: {x:GRID_W-2, y:GRID_H-2} },
    { spawn: {x:midX, y:midY},       exit: {x:GRID_W-2, y:1} },
    { spawn: {x:midX, y:midY},       exit: {x:1, y:GRID_H-2} },
    // Edge midpoint → opposite edge midpoint
    { spawn: {x:1, y:midY},          exit: {x:GRID_W-2, y:midY} },
    { spawn: {x:midX, y:1},          exit: {x:midX, y:GRID_H-2} },
  ];
  const picked = configurations[Math.floor(Math.random() * configurations.length)];

  function carve(x, y) {
    grid[y][x] = CELL_PATH;
    const dirs = shuffle([[0,-2],[0,2],[-2,0],[2,0]]);
    for (const [dx, dy] of dirs) {
      const nx = x+dx, ny = y+dy;
      if (nx>0 && nx<GRID_W-1 && ny>0 && ny<GRID_H-1 && grid[ny][nx]===CELL_WALL) {
        grid[y+dy/2][x+dx/2] = CELL_PATH;
        carve(nx, ny);
      }
    }
  }
  carve(picked.spawn.x, picked.spawn.y);
  // Extra branching: open 45% of eligible walls for richer junctions
  const candidates = [];
  for (let y=1; y<GRID_H-1; y++) {
    for (let x=1; x<GRID_W-1; x++) {
      if (grid[y][x] !== CELL_WALL) continue;
      const h = x>1 && x<GRID_W-2 && grid[y][x-1]===CELL_PATH && grid[y][x+1]===CELL_PATH;
      const v = y>1 && y<GRID_H-2 && grid[y-1][x]===CELL_PATH && grid[y+1][x]===CELL_PATH;
      if (h || v) candidates.push([x,y]);
    }
  }
  shuffle(candidates);
  for (let i=0; i<Math.floor(candidates.length*0.45); i++) {
    const [x,y] = candidates[i];
    grid[y][x] = CELL_PATH;
  }
  grid[picked.exit.y][picked.exit.x] = CELL_EXIT;
  state.maze = grid;
  state.playerPos = { x: picked.spawn.x, y: picked.spawn.y };
  state.exitPos = picked.exit;
}

function shuffle(arr) {
  for (let i=arr.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
  return arr;
}

function posKey(x, y) { return `${x},${y}`; }

function getNeighbors(x, y) {
  const checks = [
    {dx:0,dy:-1,label:t('direction.north'),dir:'up'},
    {dx:0,dy:1, label:t('direction.south'),dir:'down'},
    {dx:-1,dy:0,label:t('direction.west'),dir:'left'},
    {dx:1,dy:0, label:t('direction.east'),dir:'right'},
  ];
  return checks.filter(c => {
    const nx=x+c.dx, ny=y+c.dy;
    return nx>=0&&ny>=0&&nx<GRID_W&&ny<GRID_H && state.maze[ny][nx]!==CELL_WALL;
  }).map(c => ({ ...c, x:x+c.dx, y:y+c.dy }));
}

// ═══════════════════════════════════════════════════════════════
// GAME HISTORY (localStorage persistence)
// ═══════════════════════════════════════════════════════════════
// Tracks cross-session stats so the villain can "remember" the player.
const GameHistory = {
  _KEY: 'maze_game_history',
  _cache: null,

  _load() {
    if (this._cache) return this._cache;
    try {
      const raw = localStorage.getItem(this._KEY);
      this._cache = raw ? JSON.parse(raw) : this._defaults();
    } catch { this._cache = this._defaults(); }
    return this._cache;
  },

  _defaults() {
    return { totalGames: 0, wins: 0, deaths: 0, mazeLost: 0, quits: 0,
             bestSteps: 9999, bestDepth: 0, totalGodHands: 0,
             totalTrialsPassed: 0, totalTrialsFailed: 0,
             lastOutcome: null, lastSteps: 0, lastDepth: 0,
             firstSeen: Date.now() };
  },

  _save() { try { localStorage.setItem(this._KEY, JSON.stringify(this._cache)); } catch {} },

  get() { return { ...this._load() }; },

  record(outcome) {
    const h = this._load();
    h.totalGames++;
    if (outcome === 'win') h.wins++;
    else if (outcome === 'death') h.deaths++;
    else if (outcome === 'maze-lost') h.mazeLost++;
    else h.quits++;

    h.lastOutcome = outcome;
    h.lastSteps = state.steps;
    h.lastDepth = state.depth;
    h.totalGodHands += state.godHandCount;
    if (outcome === 'win' && state.steps < (h.bestSteps || 9999)) h.bestSteps = state.steps;
    if (state.depth > h.bestDepth) h.bestDepth = state.depth;

    const decisions = state.sessionDecisions || [];
    h.totalTrialsPassed += decisions.filter(d => d.type === 'trial-answer' && d.passed).length;
    h.totalTrialsFailed += decisions.filter(d => d.type === 'trial-answer' && !d.passed).length;

    this._save();
    return { ...h };
  },

  /** Generate a villain line referencing past sessions (null if first game) */
  returnLine() {
    const h = this._load();
    if (h.totalGames === 0) return null;
    const n = h.totalGames;
    if (h.lastOutcome === 'win') {
      return t('history.return.lastWin', { steps: h.lastSteps });
    } else if (h.lastOutcome === 'death') {
      return t('history.return.lastDeath', { n: n + 1, depth: h.lastDepth });
    } else if (h.lastOutcome === 'maze-lost') {
      return t('history.return.lastLost', { n: n + 1, steps: h.lastSteps });
    }
    if (h.deaths >= 3 && h.wins === 0) {
      return t('history.return.manyDeaths', { n: n + 1 });
    }
    if (h.wins >= 3) {
      return t('history.return.manyWins', { wins: h.wins });
    }
    return t('history.return.default', { n: n + 1 });
  },

  reset() { this._cache = this._defaults(); this._save(); },

  /** Returns a human-readable summary string for display or sharing */
  summary() {
    const h = this._load();
    if (h.totalGames === 0) return t('history.summary.first');
    const winRate = h.totalGames > 0 ? Math.round(h.wins / h.totalGames * 100) : 0;
    const parts = [t('history.summary.total', { n: h.totalGames }), t('history.summary.record', { wins: h.wins, deaths: h.deaths, lost: h.mazeLost })];
    if (h.wins > 0 && h.bestSteps < 9999) parts.push(t('history.summary.best', { steps: h.bestSteps }));
    if (h.totalGodHands > 0) parts.push(t('history.summary.godHand', { n: h.totalGodHands }));
    if (h.totalTrialsPassed + h.totalTrialsFailed > 0) {
      const total = h.totalTrialsPassed + h.totalTrialsFailed;
      parts.push(t('history.summary.trials', { passed: h.totalTrialsPassed, total }));
    }
    parts.push(t('history.summary.winRate', { pct: winRate }));
    return parts.join(' · ');
  },

  /** Generate a "villain profile" — villain's assessment of this player */
  villainProfile() {
    const h = this._load();
    if (h.totalGames < 2) return null;
    const winRate = h.wins / h.totalGames;
    const godHandRate = h.totalGodHands / h.totalGames;
    const trialPassRate = (h.totalTrialsPassed + h.totalTrialsFailed) > 0
      ? h.totalTrialsPassed / (h.totalTrialsPassed + h.totalTrialsFailed) : null;

    const traits = [];
    if (godHandRate >= 1) traits.push(t('history.profile.reliant'));
    if (winRate < 0.2 && h.totalGames >= 5) traits.push(t('history.profile.persistent'));
    if (winRate >= 0.5) traits.push(t('history.profile.strong'));
    if (trialPassRate !== null && trialPassRate >= 0.8) traits.push(t('history.profile.learned'));
    if (trialPassRate !== null && trialPassRate < 0.3) traits.push(t('history.profile.impulsive'));
    if (h.mazeLost > h.deaths) traits.push(t('history.profile.lostTendency'));
    if (h.wins > 0 && h.bestSteps < 25) traits.push(t('history.profile.speedrun'));

    return traits.length > 0 ? traits.join(' · ') : t('history.profile.unknown');
  },
};
