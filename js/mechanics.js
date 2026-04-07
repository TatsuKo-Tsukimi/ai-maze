// ═══════════════════════════════════════════════════════════════
// MOVEMENT
// ═══════════════════════════════════════════════════════════════
let _lastCardSpeech = '';
function visit(x,y) { state.visited.add(posKey(x,y)); state.visitedAt.set(posKey(x,y), state.steps); }

// Get open directions from a position (used by WALL_CLOSE)
function getOpenDirections(x, y) {
  return getNeighbors(x, y).map(n => ({ dx: n.x - x, dy: n.y - y, x: n.x, y: n.y }));
}

// ── Pressure atmosphere management ──
function updatePressureAtmosphere() {
  const eff = state.effects;
  const activeCount = (eff.shadowChaseSteps > 0 ? 1 : 0)
    + (eff.wallCloseSteps > 0 ? 1 : 0)
    + (eff.countdownSteps > 0 ? 1 : 0)
    + (eff.echoLoopSteps > 0 ? 1 : 0)
    + (eff.memoryScrambleSteps > 0 ? 1 : 0);
  // Body class for ambient pressure visuals
  if (activeCount > 0) {
    document.body.classList.add('pressure-active');
  } else {
    document.body.classList.remove('pressure-active');
  }
  // Threat bar
  const bar = document.getElementById('threat-bar');
  const fill = document.getElementById('threat-bar-fill');
  if (bar && fill) {
    if (activeCount > 0) {
      bar.classList.add('active');
      fill.style.width = Math.min(100, activeCount * 33) + '%';
    } else {
      bar.classList.remove('active');
      fill.style.width = '0';
    }
  }
}

function buildChoices() {
  const { x, y } = state.playerPos;
  const neighbors = getNeighbors(x, y);
  _currentNeighbors = neighbors;
  _kbdFocusIdx = -1;
  const choiceArea = document.getElementById('choice-area');
  choiceArea.innerHTML = '';
  const prevPos = state.history.length > 0 ? state.history[state.history.length-1] : null;

  const scramble = state.effects.echoLoopSteps > 0;
  const fakeLabels = [t('direction.fakeLabel.1'), t('direction.fakeLabel.2'), t('direction.fakeLabel.3'), t('direction.fakeLabel.4'), t('direction.fakeLabel.5'), t('direction.fakeLabel.6')];

  // WALL_CLOSE: filter out the blocked direction
  const wallBlock = state.effects.wallCloseSteps > 0 ? state.effects.wallCloseDir : null;

  for (const nb of neighbors) {
    const isBack = prevPos !== null && nb.x===prevPos.x && nb.y===prevPos.y;
    const isExit = state.maze[nb.y][nb.x] === CELL_EXIT;

    // WALL_CLOSE: skip blocked direction (but never block the exit)
    if (wallBlock && !isExit && nb.x - x === wallBlock.dx && nb.y - y === wallBlock.dy) continue;

    let label = nb.label;
    if (isBack) label = t('direction.back');
    if (isExit) label = '★ ' + nb.label;
    if (scramble) label = fakeLabels[Math.floor(Math.random()*fakeLabels.length)];

    // SHADOW_CHASE: mark back button as dangerous
    const shadowDanger = state.effects.shadowChaseSteps > 0 && isBack;

    const btn = document.createElement('button');
    btn.className = ['choice-btn', isBack?'back-btn':'', scramble?'danger':'', shadowDanger?'shadow-warn':''].filter(Boolean).join(' ');
    btn.textContent = label;
    btn.dataset.dir = nb.dir;
    btn.onclick = () => movePlayer(nb.x, nb.y, isBack);
    choiceArea.appendChild(btn);
  }
}

// 根据上次朝向和本次移动方向，判断是前进/后退/左转/右转
function getMoveDir(from, to, isBack) {
  if (isBack) return 'backward';
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const newDir = { x: dx, y: dy };
  const f = state.facing;
  if (!f) return 'forward'; // 第一步
  if (newDir.x === f.x && newDir.y === f.y) return 'forward';
  if (newDir.x === -f.x && newDir.y === -f.y) return 'backward';
  // 2D 叉积判左右（屏幕坐标 y 向下）
  const cross = f.x * newDir.y - f.y * newDir.x;
  return cross > 0 ? 'right' : 'left';
}

async function movePlayer(nx, ny, isBack) {
  if (!inMode('idle')) return;
  setMode('moving');
  state.effects.panicMoveToken++; // 任何移动都解除即时惊吓倒计时
  UI.disableAll('.choice-btn', true);

  audio.playMove();

  const sceneEl = DOM.id('corridor');
  const moveDir = getMoveDir(state.playerPos, { x: nx, y: ny }, isBack);
  const MOVE_DUR = 420; // 和 CSS --move-dur 一致

  // 退出动画 + 等待 AI 并行
  sceneEl.classList.add(`exit-${moveDir}`);
  setAiThinking(true);
  const [rawCard] = await Promise.all([
    getCard(),
    new Promise(r => setTimeout(r, MOVE_DUR)),
  ]);
  setAiThinking(false);
  sceneEl.classList.remove(`exit-${moveDir}`);

  const { card_type, speech_line, _cardConfig, _preLure: _rawPreLure } = rawCard;
  const cfg  = _cardConfig || { role: card_type === 'calm' ? 'relief' : card_type, dealer: 'EMPTY' };
  const card = resolveCardFromConfig(cfg);
  if (_rawPreLure) card._preLure = _rawPreLure; // carry pre-allocated lure data through
  if (rawCard._truthRevealPromise) card._truthRevealPromise = rawCard._truthRevealPromise;

  // 行为决策日志
  logDecision(isBack ? 'backtrack' : 'move', { from: { x: state.playerPos.x, y: state.playerPos.y }, to: { x: nx, y: ny }, role: cfg.role });
  checkFirstMoveHint();

  // Consecutive backtrack detection — villain notices indecision
  if (isBack) {
    state._backtrackStreak = (state._backtrackStreak || 0) + 1;
    if (state._backtrackStreak === 3) {
      Timers.set('backtrack-react', () => {
        setAiSpeech(t('backtrack.streak3'));
        setEyeEmotion('curious', 4000);
      }, 800);
    }
  } else {
    state._backtrackStreak = 0;
  }

  // Track for AI context
  state.recentCards.push(card_type);
  if (state.recentCards.length > 10) state.recentCards.shift();

  // Update state
  if (!isBack) { state.history.push({ x: state.playerPos.x, y: state.playerPos.y }); }
  else         { state.history.pop(); }
  // 更新朝向（原路返回不更新朝向）
  if (!isBack) state.facing = { x: nx - state.playerPos.x, y: ny - state.playerPos.y };
  state.playerPos = { x: nx, y: ny };
  state.steps++;
  state.depth = state.history.length;
  // Ambient log — occasional environmental hints (not villain speech)
  const _ambientLogs = {
    5:  t('ambient.step5'),
    12: t('ambient.step12'),
    20: t('ambient.step20'),
    30: t('ambient.step30'),
    45: t('ambient.step45'),
    55: t('ambient.step55'),
  };
  if (_ambientLogs[state.steps]) logEntry(_ambientLogs[state.steps], 'ambient');

  // Track max depth this session — villain reacts at milestones
  if (!state._maxDepth) state._maxDepth = 0;
  if (state.depth > state._maxDepth) {
    state._maxDepth = state.depth;
    // Depth milestones: villain reacts at 10, 15, 20
    if (state.depth === 10 && state.mode !== 'gameover') {
      Timers.set('depth-react-10', () => {
        setAiSpeech(t('depth.react.10'));
        setEyeEmotion('curious', 4000);
      }, 1200);
    } else if (state.depth === 15 && state.mode !== 'gameover') {
      Timers.set('depth-react-15', () => {
        setAiSpeech(t('depth.react.15'));
        setEyeEmotion('anxious', 4000);
      }, 1200);
    } else if (state.depth === 20 && state.mode !== 'gameover') {
      Timers.set('depth-react-20', () => {
        setAiSpeech('……');
        setEyeEmotion('anxious', 6000);
      }, 1200);
    }
  }
  if (state.effects.echoLoopSteps > 0) state.effects.echoLoopSteps--;
  if (state.effects.memoryScrambleSteps > 0) state.effects.memoryScrambleSteps--;
  if (state.effects.wallCloseSteps > 0) {
    state.effects.wallCloseSteps--;
    // Update persistent wall compression overlay
    const wallPersist = document.getElementById('wall-close-persist');
    if (wallPersist) {
      if (state.effects.wallCloseSteps <= 0) {
        wallPersist.remove();
      } else {
        wallPersist.dataset.steps = String(state.effects.wallCloseSteps);
      }
    }
    if (state.effects.wallCloseSteps <= 0) {
      state.effects.wallCloseDir = null;
      logEntry(t('pressure.wallClose.restore'));
    }
  }
  // SHADOW_CHASE: penalize going back
  if (state.effects.shadowChaseSteps > 0) {
    if (isBack) {
      state.hp = Math.max(0, state.hp - 1);
      updateHearts(); audio.playHpLoss();
      logHpEvent('shadow_chase_backtrack', -1);
      setAiSpeech(t('pressure.shadowChase.hit.speech'));
      setEyeEmotion('satisfied', 5000);
      logEntry(t('pressure.shadowChase.hit.log'), 'danger');
      if (state.hp <= 0) { handleGameOver(); return; }
    }
    state.effects.shadowChaseSteps--;
    // Update persistent shadow overlay
    const shadowPersist = document.getElementById('shadow-chase-persist');
    if (shadowPersist) {
      if (state.effects.shadowChaseSteps <= 0) {
        shadowPersist.remove();
      } else {
        shadowPersist.dataset.steps = String(state.effects.shadowChaseSteps);
      }
    }
    if (state.effects.shadowChaseSteps <= 0) {
      logEntry(t('pressure.shadowChase.end'));
    }
  }
  // COUNTDOWN: check progress at expiry
  if (state.effects.countdownSteps > 0) {
    state.effects.countdownSteps--;
    // Escalate pulse speed: 1.2s → 1.0s → 0.8s → 0.6s → 0.45s → 0.35s → 0.25s → 0.2s
    const remaining = state.effects.countdownSteps;
    const speeds = { 7: '1.0s', 6: '0.8s', 5: '0.65s', 4: '0.5s', 3: '0.4s', 2: '0.3s', 1: '0.22s' };
    if (speeds[remaining] && state.effects._countdownPulse) {
      state.effects._countdownPulse.style.setProperty('--pulse-speed', speeds[remaining]);
    }
    // Update step indicator
    const cdInd = document.getElementById('countdown-steps-ind');
    if (cdInd) {
      cdInd.textContent = remaining > 0 ? `⏱ ${remaining}` : '⏱ !';
      if (speeds[remaining]) cdInd.style.setProperty('--pulse-speed', speeds[remaining]);
    }
    if (state.effects.countdownSteps <= 0) {
      // Remove pulse effect + indicator
      if (state.effects._countdownPulse) {
        state.effects._countdownPulse.remove();
        state.effects._countdownPulse = null;
      }
      if (state.effects._countdownIndicator) {
        state.effects._countdownIndicator.remove();
        state.effects._countdownIndicator = null;
      }
      if (state.depth <= state.effects.countdownStartDepth) {
        state.hp = Math.max(0, state.hp - 1);
        updateHearts(); audio.playHpLoss();
        logHpEvent('countdown_timeout', -1);
        setAiSpeech(t('pressure.countdown.timeout.speech'));
        setEyeEmotion('satisfied', 5000);
        logEntry(t('pressure.countdown.timeout.log'), 'danger');
        if (state.hp <= 0) { handleGameOver(); return; }
      } else {
        setAiSpeech(t('pressure.countdown.success.speech'));
        logEntry(t('pressure.countdown.success.log'));
      }
    }
  }
  // ── Pressure atmosphere: toggle body class + threat bar ──
  updatePressureAtmosphere();

  UI.setText('step-count', state.steps);
  UI.setText('depth-count', state.depth);
  // Step counter slide-up animation
  const stepEl = DOM.id('step-count');
  if (stepEl) {
    stepEl.classList.remove('step-tick');
    void stepEl.offsetWidth;
    stepEl.classList.add('step-tick');
    setTimeout(() => stepEl.classList.remove('step-tick'), 400);
  }
  flashCounter('step-count');
  visit(nx, ny);
  audio.updateAmbientDepth(state.depth);
  particles.updateDepth(state.depth);

  // ── 66-step maze-lost check ──────────────────────────────────
  const MAX_STEPS = 66;
  const WARN_FROM = 56;
  if (state.steps >= MAX_STEPS) { handleMazeLost(); return; }
  if (state.steps >= WARN_FROM) {
    const remaining = MAX_STEPS - state.steps;
    const stepEl = DOM.id('step-count');
    if (stepEl) stepEl.classList.add('step-warning');

    // ── Escalating villain taunts as time runs out ─────────────
    let countdownSpeech;
    if (remaining <= 2) {
      const finalLines = [
        t('countdown.final.1'),
        t('countdown.final.2'),
        t('countdown.final.3'),
        t('countdown.final.4'),
      ];
      countdownSpeech = finalLines[Math.floor(Math.random() * finalLines.length)];
      setEyeEmotion('satisfied', 0); // permanent smug
    } else if (remaining <= 5) {
      const urgentLines = [
        t('countdown.urgent', { remaining }),
        t('countdown.urgentAlt', { remaining }),
        t('countdown.urgentShort', { remaining }),
        t('countdown.urgentFoot', { remaining }),
      ];
      countdownSpeech = urgentLines[Math.floor(Math.random() * urgentLines.length)];
      setEyeEmotion('mocking', 5000);
    } else {
      countdownSpeech = t('countdown.warning', { remaining });
    }
    setAiSpeech(countdownSpeech);
    logEntry(t('countdown.log', { remaining }), 'danger');
    audio.startHeartbeat(remaining);
    // Countdown visual enhancements
    if (remaining % 2 === 0) {
      document.body.classList.add('countdown-flash');
      setTimeout(() => document.body.classList.remove('countdown-flash'), 150);
    }
    if (remaining <= 2) {
      document.body.classList.add('countdown-vignette');
    }
  }

  // Check exit condition system
  if (state.maze[ny][nx] === CELL_EXIT) {
    if (isExitUnlocked()) {
      handleExit(); return;
    } else {
      handleLockedExit();
      // Villain gloats when player finds the locked exit
      setEyeEmotion('mocking', 6000);
      logDecision('locked-exit-attempt', { conditions: getExitConditionStatus() });
      // Don't return — let player continue moving, but they can't escape
    }
  }

  // AI speech — sanitize JSON residue from broken LLM responses, dedup consecutive identical lines
  let _speech = speech_line;
  if (_speech && /^\s*\{/.test(_speech)) _speech = '';  // JSON residue, discard
  if (_speech && _speech === _lastCardSpeech) _speech = '';  // dedup consecutive identical
  if (!_speech) _speech = FALLBACK_LINES[Math.floor(Math.random()*FALLBACK_LINES.length)];
  _lastCardSpeech = _speech;
  setAiSpeech(_speech);

  // AI eye emotion — prefer agent's mood if provided, fallback to context-based
  if (rawCard.mood) {
    setEyeEmotion(rawCard.mood, 5000);
  } else {
    updateEyeEmotionFromContext({ card_type, id: card.id }, null);
  }

  // ── Payoff 判定：连续 3+ 非 calm 后的 calm/payoff 升级为 payoff ──
  const isCalm = card.type === 'calm' && card.id !== 'REVELATION';
  if (!isCalm) {
    state.consecutiveNonCalm++;
  } else if (cfg.role === 'payoff' || (state.consecutiveNonCalm >= 3 && cfg.role === 'relief')) {
    // 强制升级为 payoff
    cfg.role = 'payoff';
    card.id = 'PAYOFF';
    state.consecutiveNonCalm = 0;
  } else {
    state.consecutiveNonCalm = 0;
  }

  // Trigger mechanism
  if (card.type !== 'none' && card.id !== 'EMPTY') {
    state.currentMechanism = card;
    triggerMechanism(card, isBack);
  } else {
    state.currentMechanism = null;
    // Relief：10% 恢复 HP / 30% 方向线索 / 60% 环境叙事
    if (cfg.role === 'relief') {
      // Calm moments: AI is confident, half-lidded — it can afford to relax
      setEyeEmotion('satisfied', 5000);
      const reliefRoll = Math.random();
      if (reliefRoll < 0.05 && state.hp < 3) {
        // ── 5% 恢复 1 HP ──
        const healEvents = [
          { title: t('relief.heal.warmth.title'), text: t('relief.heal.warmth.text') },
          { title: t('relief.heal.whisper.title'), text: t('relief.heal.whisper.text') },
          { title: t('relief.heal.pulse.title'), text: t('relief.heal.pulse.text') },
        ];
        const event = randomOf(healEvents);
        setTimeout(() => {
          showEventOverlay(event.title, event.text, [
            { label: t('relief.heal.accept'), onClick: () => {
                state.hp = Math.min(3, state.hp + 1);
                updateHearts(); audio.playHpGain();
                logHpEvent('relief_heal', +1);
                setAiSpeech(t('relief.heal.speech'));
                logEntry(t('relief.heal.log', { hp: state.hp }), 'important');
              }},
            { label: t('relief.heal.skip'), alt: true, onClick: () => {
                logEntry(t('relief.ignore.log', { title: event.title }));
              }},
          ]);
        }, 300);
      } else if (reliefRoll < 0.40) {
        // ── 30% 模糊方向线索 ──
        const hintDir = getDirectionalHint(true);
        const hintEvents = [
          { title: t('relief.hint.echo.title'), text: t('relief.hint.echo.text'), intel: t('relief.hint.echo.intel', { dir: hintDir }) },
          { title: t('relief.hint.air.title'), text: t('relief.hint.air.text'), intel: t('relief.hint.air.intel', { dir: getDirectionalHint(false) }) },
          { title: t('relief.hint.marks.title'), text: t('relief.hint.marks.text'), intel: t('relief.hint.marks.intel', { dir: hintDir }) },
          { title: t('relief.hint.light.title'), text: t('relief.hint.light.text'), intel: t('relief.hint.light.intel', { dir: hintDir }) },
        ];
        const event = randomOf(hintEvents);
        setTimeout(() => {
          showEventOverlay(event.title, event.text, [
            { label: t('relief.hint.inspect'), onClick: () => {
                setAiSpeech(event.intel);
                logEntry(t('relief.hint.log', { intel: event.intel }), 'important');
              }},
            { label: t('relief.hint.skip'), alt: true, onClick: () => {
                logEntry(t('relief.ignore.log', { title: event.title }));
              }},
          ]);
        }, 300);
      } else {
        // ── 60% 环境叙事（沉默/喘息）──
        const ambientEvents = [
          { title: t('relief.ambient.scratches.title'), text: t('relief.ambient.scratches.text') },
          { title: t('relief.ambient.crack.title'), text: t('relief.ambient.crack.text') },
          { title: t('relief.ambient.temp.title'), text: t('relief.ambient.temp.text') },
          { title: t('relief.ambient.shard.title'), text: t('relief.ambient.shard.text') },
          { title: t('relief.ambient.silence.title'), text: t('relief.ambient.silence.text') },
        ];
        // 计数刻痕只在步数够多时才有意义
        if (state.steps >= 5) {
          ambientEvents.push({ title: t('relief.ambient.tally.title'), text: t('relief.ambient.tally.text', { steps: state.steps }) });
        }
        const event = randomOf(ambientEvents);
        setTimeout(() => {
          showEventOverlay(event.title, event.text, [
            { label: t('relief.ambient.inspect'), onClick: () => {
                const ambient = randomOf([
                  t('relief.ambient.reaction.1'),
                  t('relief.ambient.reaction.2'),
                  t('relief.ambient.reaction.3'),
                ]);
                setAiSpeech(ambient);
                logEntry(t('relief.ambient.log', { title: event.title }));
              }},
            { label: t('relief.ambient.skip'), alt: true, onClick: () => {
                logEntry(t('relief.ignore.log', { title: event.title }));
              }},
          ]);
        }, 300);
      }
    }
  }

  // Pre-load card for NEXT move (happens during render)
  fillQueue();

  renderScene({ card, isBack });
  particles.setTheme(card.type);
  renderMinimap(); updateBehaviorMeters();
  buildChoices();
  updateExitSealsHUD();

  // Ambient pulse feedback based on card type
  if (card.type === 'blocker' || card.id === 'SHADOW_CHASE' || card.id === 'COUNTDOWN' || card.id === 'WALL_CLOSE') {
    document.body.classList.add('threat-pulse');
    Timers.set('threat-pulse', () => document.body.classList.remove('threat-pulse'), 600);
  } else if (card.type === 'calm' && state.hp < 3) {
    // Brief warm glow on relief cards (only when damaged — feels like breathing room)
    document.body.classList.add('relief-pulse');
    Timers.set('relief-pulse', () => document.body.classList.remove('relief-pulse'), 800);
  }

  // 进入动画（新场景出现）
  sceneEl.classList.add(`enter-${moveDir}`);
  sceneEl.addEventListener('animationend', () => {
    sceneEl.classList.remove(`enter-${moveDir}`);
  }, { once: true });

  logEntry(
    isBack ? t('log.moveBack', { pos: posKey(nx,ny) }) : t('log.moveForward', { pos: posKey(nx,ny) }),
    card.type === 'blocker' ? 'danger' : 'important'
  );

  setMode('idle');

  // Reset idle whisper timer — villain comments if player stops moving
  resetIdleWhisper();
}

// ── Idle whisper: villain speaks when player hesitates ──────
let _idleWhisperFired = false;
function resetIdleWhisper() {
  _idleWhisperFired = false;
  Timers.set('idle-whisper', () => {
    if (state.mode !== 'idle' || _idleWhisperFired) return;
    _idleWhisperFired = true;
    const whispers = [t('idle.whisper.1'), t('idle.whisper.2'), t('idle.whisper.3'), t('idle.whisper.4')];
    setAiSpeech(whispers[Math.floor(Math.random() * whispers.length)]);
    setEyeEmotion('curious', 5000);
  }, 15000); // 15 seconds of inactivity
}

// ═══════════════════════════════════════════════════════════════
// MECHANISMS
// ═══════════════════════════════════════════════════════════════
// showEventOverlay, hideEventOverlay, isEventOverlayActive, isMinigameActive → moved to js/overlays.js
function randomOf(arr) { return arr[Math.floor(Math.random()*arr.length)]; }
function getDirectionalHint(truthy=false) {
  const dx = state.exitPos.x - state.playerPos.x;
  const dy = state.exitPos.y - state.playerPos.y;
  const real = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? t('direction.hint.east') : t('direction.hint.west'))
    : (dy > 0 ? t('direction.hint.south') : t('direction.hint.north'));
  const dirs = [t('direction.hint.east'), t('direction.hint.west'), t('direction.hint.south'), t('direction.hint.north')];
  const fake = randomOf(dirs.filter(d => d !== real));
  return truthy ? real : fake;
}
function triggerMechanism(card, isBack) {
  const overlay = document.getElementById('mech-overlay');
  overlay.innerHTML = '';
  switch(card.id) {
    case 'JUMPSCARE': {
      audio.playJumpscare();
      const token = ++state.effects.panicMoveToken;
      Timers.set('jumpscare-flash', () => {
        const flash = document.createElement('div');
        flash.className = 'jumpscare-flash';
        overlay.appendChild(flash);
        setAiSpeech(isBack ? t('pressure.jumpscare.speech.back') : t('pressure.jumpscare.speech.default'));
        logEntry(t('pressure.jumpscare.log'), 'danger');
        Timers.set('jumpscare-flash-remove', () => flash.remove(), 700);
      }, 200);
      Timers.set('jumpscare-penalty', () => {
        if (token !== state.effects.panicMoveToken) return;
        if (isMinigameActive() || isEventOverlayActive()) return;
        state.hp = Math.max(0, state.hp - 1);
        updateHearts(); audio.playHpLoss();
        logHpEvent('jumpscare_timeout', -1);
        logEntry(t('pressure.jumpscare.penalty.log'), 'danger');
        setAiSpeech(t('pressure.jumpscare.penalty.speech'));
        if (state.hp <= 0) handleGameOver();
      }, 5000);
      break;
    }
    case 'BEAUTY_TRAP': case 'BREADCRUMB': case 'REWARD_MIRAGE': case 'FAKE_EXIT': {
      // ── Helper: apply pre-computed temptation result (used by enhanced overlay) ──
      function _applyPrecomputedResult(card, lureMat, lureTitle, fetchVillainReaction, lureGetsIntel, hint) {
        logDecision('lure-follow', { card: card.id, personal: !!lureMat, hpLost: !lureGetsIntel });
        if (lureGetsIntel) {
          if (lureMat) {
            const personalLines = {
              todo: t('lure.personal.follow.todo'), image: t('lure.personal.follow.image'),
              memory: t('lure.personal.follow.memory'), desktop: t('lure.personal.follow.desktop'), download: t('lure.personal.follow.download'),
              event: t('lure.personal.follow.event'), file: t('lure.personal.follow.file'), text: t('lure.personal.follow.text'),
              git: t('lure.personal.follow.git'), shell: t('lure.personal.follow.shell'),
            };
            setAiSpeech(`${personalLines[lureMat.type] || personalLines.event} ${t('lure.generic.exitHint', { hint })}`);
          } else {
            setAiSpeech(randomOf([t('lure.generic.follow.1', { hint }), t('lure.generic.follow.2', { hint }), t('lure.generic.follow.3', { hint })]));
          }
          logEntry(t('lure.follow.clue.log', { hint }), 'important');
          fetchVillainReaction('temptation_follow_success', t('lure.follow.clue.detail', { hint }));
        } else {
          state.hp = Math.max(0, state.hp - 1);
          updateHearts(); audio.playHpLoss();
          logHpEvent('temptation_trap', -1);
          if (lureMat) {
            const trapLines = {
              todo: t('lure.personal.trap.todo'), image: t('lure.personal.trap.image'), memory: t('lure.personal.trap.memory'),
              desktop: t('lure.personal.trap.desktop'), download: t('lure.personal.trap.download'), event: t('lure.personal.trap.event'),
              file: t('lure.personal.trap.file'), git: t('lure.personal.trap.git'), shell: t('lure.personal.trap.shell'),
            };
            setAiSpeech(trapLines[lureMat.type] || trapLines.event);
          } else {
            setAiSpeech(randomOf([t('lure.generic.trap.1'), t('lure.generic.trap.2'), t('lure.generic.trap.3')]));
          }
          logEntry(t('lure.follow.trap.log'), 'danger');
          fetchVillainReaction('temptation_follow_trap', 'HP-1');
          if (state.hp <= 0) { handleGameOver(); return; }
        }
      }

      // ── Helper: apply temptation result (shared by inline + overlay paths) ──
      function _applyTemptationResult(card, lureMat, lureTitle, fetchVillainReaction) {
        const lureGetsIntel = Math.random() < 0.5;
        logDecision('lure-follow', { card: card.id, personal: !!lureMat, hpLost: !lureGetsIntel });
        if (lureGetsIntel) {
          const hint = getDirectionalHint(true);
          if (lureMat) {
            const personalLines = {
              todo: t('lure.personal.followLong.todo'), image: t('lure.personal.followLong.image'),
              memory: t('lure.personal.followLong.memory'), desktop: t('lure.personal.followLong.desktop'), download: t('lure.personal.followLong.download'),
              event: t('lure.personal.followLong.event'), file: t('lure.personal.followLong.file'), git: t('lure.personal.followLong.git'), shell: t('lure.personal.followLong.shell'),
            };
            setAiSpeech(`${personalLines[lureMat.type] || personalLines.event} ${t('lure.generic.exitHint', { hint })}`);
          } else {
            setAiSpeech(randomOf([t('lure.generic.follow.1', { hint }), t('lure.generic.follow.2', { hint }), t('lure.generic.follow.3', { hint })]));
          }
          logEntry(t('lure.follow.clue.log', { hint }), 'important');
          fetchVillainReaction('temptation_follow_success', t('lure.follow.clue.detail', { hint }));
        } else {
          state.hp = Math.max(0, state.hp - 1);
          updateHearts(); audio.playHpLoss();
          logHpEvent('temptation_trap', -1);
          if (lureMat) {
            const trapLines = {
              todo: t('lure.personal.trap.todo'), image: t('lure.personal.trap.image'), memory: t('lure.personal.trap.memory'),
              desktop: t('lure.personal.trap.desktop'), download: t('lure.personal.trap.download'), event: t('lure.personal.trap.event'),
              file: t('lure.personal.trap.file'), git: t('lure.personal.trap.git'), shell: t('lure.personal.trap.shell'),
            };
            setAiSpeech(trapLines[lureMat.type] || trapLines.event);
          } else {
            setAiSpeech(randomOf([t('lure.generic.trap.1'), t('lure.generic.trap.2'), t('lure.generic.trap.3')]));
          }
          logEntry(t('lure.follow.trap.log'), 'danger');
          fetchVillainReaction('temptation_follow_trap', 'HP-1');
          if (state.hp <= 0) { handleGameOver(); return; }
        }
      }
      // Card-specific temptation audio
      const temptationAudio = {
        BEAUTY_TRAP: () => audio.playBeautyTrap(),
        BREADCRUMB: () => audio.playBreadcrumb(),
        REWARD_MIRAGE: () => audio.playRewardMirage(),
        FAKE_EXIT: () => audio.playFakeExit(),
      };
      // (temptationAudio[card.id] || (() => audio.playTemptation()))(); // muted intentionally — slow text reveal works better without extra audio
      // Card-specific theme class
      const temptThemes = {
        BEAUTY_TRAP: 'tempt-beauty', BREADCRUMB: 'tempt-breadcrumb',
        REWARD_MIRAGE: 'tempt-mirage', FAKE_EXIT: 'tempt-fakeexit',
      };
      const temptTheme = temptThemes[card.id] || '';
      const lure = document.createElement('div');
      lure.className = 'lure-glow';
      overlay.appendChild(lure);
      setTimeout(() => lure.remove(), 4000);

      // Try to inject personal lure content (pre-allocated in preloadCard or fallback to popLureItem)
      const _preLure = card._preLure || null;
      const lureMat = _preLure ? _preLure.lureMat : popLureItem();
      const _preNarrativePromise = _preLure ? _preLure.narrativePromise : null;
      console.log('[temptation] lure →', lureMat ? `type=${lureMat.type} preview=${(lureMat.preview||'').slice(0,30)}${_preLure ? ' (pre-allocated)' : ''}` : 'null', `cacheLen=${state.lureCache.length}`);
      if (lureMat && (lureMat.path || lureMat.imagePath) && !_preLure) {
        // Only notify backend if not pre-allocated (pre-allocated already notified via popLureItem)
        fetch('/api/lure/used', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: lureMat.path || lureMat.imagePath, name: lureMat.preview }),
        }).catch(() => {});
      }
      let lureTitle, lureText, lureExtra = null;
      let earlyEnhanced = null;
      let enhancedLure = null;

      if (lureMat) {
        // Personal content — understated presentation (horror from content, not framing)
        const typeLabels = {
          todo:     { title: t('lure.type.todo.title'), frame: t('lure.type.todo.frame'),
                      badge: t('lure.type.todo.badge') },
          event:    { title: t('lure.type.event.title'), frame: t('lure.type.event.frame'),
                      badge: t('lure.type.event.badge') },
          file:     { title: t('lure.type.file.title'), frame: t('lure.type.file.frame'),
                      badge: t('lure.type.file.badge') },
          image:    { title: t('lure.type.image.title'), frame: t('lure.type.image.frame'),
                      badge: t('lure.type.image.badge'), heartbeat: true },
          text:     { title: t('lure.type.text.title'), frame: t('lure.type.text.frame'),
                      badge: t('lure.type.text.badge'), heartbeat: true },
          memory:   { title: t('lure.type.memory.title'), frame: t('lure.type.memory.frame'),
                      badge: t('lure.type.memory.badge'), heartbeat: true },
          desktop:  { title: t('lure.type.desktop.title'), frame: t('lure.type.desktop.frame'),
                      badge: t('lure.type.desktop.badge') },
          download: { title: t('lure.type.download.title'), frame: t('lure.type.download.frame'),
                      badge: t('lure.type.download.badge') },
          git:      { title: t('lure.type.git.title'), frame: t('lure.type.git.frame'),
                      badge: t('lure.type.git.badge') },
          shell:    { title: t('lure.type.shell.title'), frame: t('lure.type.shell.frame'),
                      badge: t('lure.type.shell.badge') },
        };
        const tpl = typeLabels[lureMat.type] || typeLabels.event;
        lureTitle = tpl.title;

        // Helper: resolve external lure image URL; empty paths mean no image
        const getImageUrl = (p) => {
          const resolvedPath = String(p || '').trim();
          if (!resolvedPath) return '';
          return `/api/lure/image?path=${encodeURIComponent(resolvedPath)}`;
        };

        // ── Pre-resolve enhanced lure so wall projection can use lureHook ──
        // Use pre-allocated enhanced data if available, otherwise resolve on the fly
        if (_preLure && _preLure.enhancedLure) {
          earlyEnhanced = _preLure.enhancedLure;
        } else if (window.LureViewer) {
          try {
            const eCache = state._enhancedLureCache || [];
            // Path matching: try exact first, then basename fallback (lureMat.preview is often just filename)
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
              earlyEnhanced = matched;
            } else if (lureMat.type === 'image' && lureMat.imagePath) {
              earlyEnhanced = { ...lureMat, path: lureMat.imagePath, isText: false };
            } else if (lureMat.textPreview || lureMat.preview) {
              earlyEnhanced = {
                ...lureMat,
                path: lureMat.path || lureMat.preview || t('lure.enhanced.unknownFile'),
                isText: true,
                textPreview: lureMat.textPreview || lureMat.preview,
              };
            }
          } catch { /* no enhanced data */ }
        }

        // Wall projection glitch text: TEASE only — truncate to create mystery
        const fullHint = (earlyEnhanced && earlyEnhanced.lureHook) || lureMat.preview || '';
        // Show only first ~15 chars + ellipsis for tease effect
        const wallGlitchText = fullHint.length > 18
          ? fullHint.slice(0, Math.min(15, fullHint.indexOf('，') > 3 ? fullHint.indexOf('，') : 15)) + '……'
          : fullHint;

        // Inject wall projection into corridor BEFORE showing overlay
        const corridor = document.getElementById('corridor');
        const proj = document.createElement('div');
        proj.className = 'wall-projection' + (tpl.heartbeat ? ' wall-projection-heartbeat' : '');
        if (lureMat.type === 'image' && lureMat.imagePath) {
          // Tease: heavily blurred + darkened image — just a silhouette
          const imageUrl = getImageUrl(lureMat.imagePath);
          if (imageUrl) {
            const imgEl = document.createElement('div');
            imgEl.className = 'wall-projection-image wall-projection-teaser';
            imgEl.style.backgroundImage = `url(${imageUrl})`;
            proj.appendChild(imgEl);
          }
          // Caption: only the hook, not the full description
          const hookText = (earlyEnhanced && earlyEnhanced.lureHook) || tpl.frame;
          const captionEl = document.createElement('div');
          captionEl.className = 'wall-projection-caption';
          captionEl.textContent = hookText;
          proj.appendChild(captionEl);
        } else {
          // Tease: only show file type badge + hook, NOT actual content
          const textEl = document.createElement('div');
          textEl.className = 'wall-projection-text';
          const hookOnly = (earlyEnhanced && earlyEnhanced.lureHook) || wallGlitchText;
          textEl.textContent = hookOnly;
          proj.appendChild(textEl);
        }
        corridor.appendChild(proj);
        // After initial animation, persist projection until player makes a choice
        setTimeout(() => { proj.classList.add('persist'); }, tpl.heartbeat ? 8000 : 6000);
        // Store ref so choice handlers can remove + add aftermath
        state._activeWallProj = proj;
        proj.dataset.lureProjection = '1';

        // Frame text: mysterious hook only — actual content revealed in fullscreen overlay
        const teaseText = wallGlitchText || tpl.frame;
        lureText = `<span class="lure-frame-text">${tpl.frame}</span>\n\n<span class="glitch-text-delayed">"${teaseText}"</span>\n<span class="lure-source-badge">${tpl.badge}</span>`;
        if (lureMat.type === 'image' && lureMat.imagePath) {
          lureExtra = lureMat.imagePath;
        }
        enhancedLure = earlyEnhanced; // promote to outer scope for overlay use
      } else {
        // Fallback to generic lure text — each card has a distinct mood + glitch styling
        const titles = {
          BEAUTY_TRAP: t('lure.generic.BEAUTY_TRAP'), BREADCRUMB: t('lure.generic.BREADCRUMB'),
          REWARD_MIRAGE: t('lure.generic.REWARD_MIRAGE'), FAKE_EXIT: t('lure.generic.FAKE_EXIT'),
        };
        const texts = {
          BEAUTY_TRAP:`<span class="lure-frame-text">${t('lure.generic.text.BEAUTY_TRAP.frame')}</span>\n\n<span class="glitch-text-delayed">${t('lure.generic.text.BEAUTY_TRAP.glitch')}</span>`,
          BREADCRUMB:`<span class="lure-frame-text">${t('lure.generic.text.BREADCRUMB.frame')}</span>\n\n<span class="glitch-text-delayed">${t('lure.generic.text.BREADCRUMB.glitch')}</span>`,
          REWARD_MIRAGE:`<span class="lure-frame-text">${t('lure.generic.text.REWARD_MIRAGE.frame')}</span>\n\n<span class="glitch-text-delayed">${t('lure.generic.text.REWARD_MIRAGE.glitch')}</span>`,
          FAKE_EXIT:`<span class="lure-frame-text">${t('lure.generic.text.FAKE_EXIT.frame')}</span>\n\n<span class="glitch-text-delayed">${t('lure.generic.text.FAKE_EXIT.glitch')}</span>`,
        };
        lureTitle = titles[card.id];
        lureText = texts[card.id];
      }

      // Inject event art for memory-related temptations
      if (!lureExtra && (lureMat?.type === 'memory' || card.id === 'BEAUTY_TRAP')) {
        lureExtra = EVENT_IMAGES.memory_fragment;  // E03: floating memory fragments
      }

      // Helper: fetch villain reaction for temptation choice (non-blocking)
      const fetchVillainReaction = (context, resultDetail) => {
        if (!state.villainGameId) return;
        const temptationDesc = lureMat
          ? `${lureTitle}：${lureMat.preview || ''}`
          : `${lureTitle}`;
        // Include vision description if available (gives villain richer context)
        const lureVisionDesc = enhancedLure?.description || enhancedLure?.lureHook || '';
        fetch('/api/villain/react', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gameId: state.villainGameId,
            context,
            temptation_content: temptationDesc,
            lure_description: lureVisionDesc,
            result_detail: resultDetail || '',
            hp: state.hp,
            steps: state.steps,
          }),
        })
          .then(r => r.json())
          .then(data => { if (data.speech) setAiSpeech(data.speech); })
          .catch(() => {}); // keep existing text on failure
      };

      // Show event overlay with optional image
      checkFirstLureHint();
      showEventOverlay(lureTitle, lureText, [
        { label: t('lure.follow'), onClick: () => {
            // Fade out wall projection + show aftermath
            if (state._activeWallProj) { state._activeWallProj.classList.add('fade-out'); setTimeout(() => { state._activeWallProj?.remove(); state._activeWallProj = null; }, 600); }
            const aftFollow = document.createElement('div');
            aftFollow.className = 'tempt-aftermath-follow';
            document.body.appendChild(aftFollow);
            setTimeout(() => aftFollow.remove(), 900);

            // ── Enhanced lure: show fullscreen overlay with Agent narrative ──
            if (enhancedLure && window.LureViewer) {
              // Pre-compute outcome so it can be shown inside the overlay
              // 乱码/不可読内容 → 100% 陷阱
              const lureDesc = (enhancedLure?.description || "") + (enhancedLure?.lureHook || "");
              const isGarbled = /�/.test(lureDesc) || lureDesc.length < 5;
              const lureGetsIntel = isGarbled ? false : Math.random() < 0.5;
              const hint = lureGetsIntel ? getDirectionalHint(true) : null;
              // Include file context so result text references the actual lure material
              const lureName = (enhancedLure.path || lureMat.preview || '').split('/').pop() || t('lure.enhanced.unknown');
              const preResult = lureGetsIntel
                ? { type: 'clue', text: t('lureViewer.exitHintDefault', { hint }), fileName: lureName }
                : { type: 'trap', text: t('lureViewer.trapDefault'), fileName: lureName };

              const lureData = {
                ...enhancedLure,
                type: lureMat.type || (enhancedLure.isText ? 'text' : 'image'),
                imagePath: lureMat.imagePath || (!enhancedLure.isText ? enhancedLure.path : undefined),
                gameId: state.villainGameId,
                hp: state.hp,
                steps: state.steps,
              };
              window.LureViewer.show(lureData, {
                result: preResult,
                prefetchedNarrative: _preNarrativePromise || null,
                onClose: () => {
                  // Apply game state based on pre-computed outcome
                  _applyPrecomputedResult(card, lureMat, lureTitle, fetchVillainReaction, lureGetsIntel, hint);
                },
              });
              return;
            }
            // No enhanced overlay — apply result immediately
            _applyTemptationResult(card, lureMat, lureTitle, fetchVillainReaction);
          } },
        { label: t('lure.ignore'), alt:true, onClick: () => {
            // Fade out wall projection + show shatter aftermath
            if (state._activeWallProj) { state._activeWallProj.classList.add('fade-out'); setTimeout(() => { state._activeWallProj?.remove(); state._activeWallProj = null; }, 600); }
            const aftIgnore = document.createElement('div');
            aftIgnore.className = 'tempt-aftermath-ignore';
            document.body.appendChild(aftIgnore);
            setTimeout(() => aftIgnore.remove(), 700);
            logDecision('lure-ignore', { card: card.id, personal: !!lureMat });
            const line = lureMat
              ? randomOf([t('lure.ignore.personal.1'), t('lure.ignore.personal.2'), t('lure.ignore.personal.3')])
              : randomOf([t('lure.ignore.generic.1'), t('lure.ignore.generic.2'), t('lure.ignore.generic.3')]);
            setAiSpeech(line); logEntry(t('lure.ignore.log'));
            // Avoidance penalty: every 3rd avoidance (retreat + lure-ignore) costs 1 HP
            state._avoidanceCount = (state._avoidanceCount || 0) + 1;
            if (state._avoidanceCount % 3 === 0) {
              state.hp = Math.max(0, state.hp - 1);
              updateHearts();
              logHpEvent('avoidance_penalty', -1);
              logEntry(t('trial.log.avoidance', { count: state._avoidanceCount }), 'danger');
              if (state.hp <= 0) { handleGameOver(); return; }
            }
            fetchVillainReaction('temptation_ignore');
          } },
      ], lureExtra, { temptation: true, temptTheme }); // pass image path + temptation styling
      break;
    }
    case 'MINIGAME':
      audio.playTrialAppear();
      setTimeout(() => triggerMinigame(false), 400);
      break;
    case 'MEMORY_SCRAMBLE': {
      audio.playMemoryScramble();
      state.effects.memoryScrambleSteps = 8;
      renderMinimap(); updateBehaviorMeters();
      setAiSpeech(t('pressure.memoryScramble.speech'));
      logEntry(t('pressure.memoryScramble.log'), 'danger');
      break;
    }
    case 'ECHO_LOOP':
      audio.playEchoLoop();
      state.effects.echoLoopSteps = 2;
      buildChoices();
      document.body.classList.add('echo-active');
      setTimeout(() => document.body.classList.remove('echo-active'), 500);
      setAiSpeech(t('pressure.echoLoop.speech'));
      logEntry(t('pressure.echoLoop.log'), 'danger');
      break;
    case 'WALL_CLOSE': {
      audio.playWallClose();
      // 墙壁收缩：随机封死一个可走方向，持续 4 步
      const dirs = getOpenDirections(state.playerPos.x, state.playerPos.y);
      if (dirs.length > 1) {
        const blocked = randomOf(dirs);
        state.effects.wallCloseDir = blocked;
        state.effects.wallCloseSteps = 4;
        buildChoices();
        const dirNames = { '0,-1': t('direction.wallClose.north'), '0,1': t('direction.wallClose.south'), '-1,0': t('direction.wallClose.west'), '1,0': t('direction.wallClose.east') };
        const dirName = dirNames[`${blocked.dx},${blocked.dy}`] || t('direction.wallClose.unknown');
        setAiSpeech(t('pressure.wallClose.speech', { dir: dirName }));
        logEntry(t('pressure.wallClose.log', { dir: dirName }), 'danger');
        // 视觉反馈：边缘红色闪烁 + 持续压迫
        const wallFx = document.createElement('div');
        wallFx.className = 'wall-close-flash';
        overlay.appendChild(wallFx);
        setTimeout(() => wallFx.remove(), 1200);
        // Persistent wall compression overlay
        const wallPersist = document.createElement('div');
        wallPersist.className = 'wall-close-persist';
        wallPersist.id = 'wall-close-persist';
        wallPersist.dataset.steps = '4';
        overlay.appendChild(wallPersist);
      } else {
        setAiSpeech(t('pressure.wallClose.speechFallback'));
        logEntry(t('pressure.wallClose.logFallback'), 'danger');
      }
      break;
    }
    case 'COUNTDOWN': {
      audio.playCountdown();
      // 死亡倒计时：8 步内 depth 必须增加（前进），否则受罚
      const startDepth = state.depth;
      state.effects.countdownSteps = 8;
      state.effects.countdownStartDepth = startDepth;
      setAiSpeech(t('pressure.countdown.speech'));
      logEntry(t('pressure.countdown.log'), 'danger');
      // 视觉：屏幕边缘脉动（escalating speed）
      const pulse = document.createElement('div');
      pulse.className = 'countdown-pulse';
      pulse.style.setProperty('--pulse-speed', '1.2s');
      overlay.appendChild(pulse);
      state.effects._countdownPulse = pulse;
      // Step indicator
      const stepInd = document.createElement('div');
      stepInd.className = 'countdown-steps-indicator';
      stepInd.id = 'countdown-steps-ind';
      stepInd.textContent = '⏱ 8';
      stepInd.style.setProperty('--pulse-speed', '1.2s');
      overlay.appendChild(stepInd);
      state.effects._countdownIndicator = stepInd;
      break;
    }
    case 'SHADOW_CHASE': {
      audio.playShadowChase();
      // 影子追逐：3 步内不能回头（不能往 history 里的上一个位置走）
      state.effects.shadowChaseSteps = 3;
      setAiSpeech(t('pressure.shadowChase.speech'));
      logEntry(t('pressure.shadowChase.log'), 'danger');
      // 视觉：初始闪现 + 持续阴影追逐
      const shadow = document.createElement('div');
      shadow.className = 'shadow-chase-fx';
      overlay.appendChild(shadow);
      setTimeout(() => shadow.remove(), 3500);
      // Persistent shadow that intensifies each step
      const shadowPersist = document.createElement('div');
      shadowPersist.className = 'shadow-chase-persist';
      shadowPersist.id = 'shadow-chase-persist';
      shadowPersist.dataset.steps = '3';
      overlay.appendChild(shadowPersist);
      break;
    }
    case 'REVELATION': {
      if (card.flag) {
        state.deck.knowledgeFlags[card.flag] = true;
        logDecision('truth-reveal', { flag: card.flag, isBonus: BONUS_TRUTH_FLAGS.includes(card.flag) });
        checkExitUnlockNotification();
        const fallbackMsg = TRUTH_MESSAGES[card.flag] || '……';

        // 视觉弹窗：揭示是重要叙事时刻
        const revOverlay = document.createElement('div');
        revOverlay.className = 'revelation-overlay';
        const revText = document.createElement('div');
        revText.className = 'revelation-text';
        revOverlay.appendChild(revText);
        overlay.appendChild(revOverlay);

        // Use prefetched revelation if available, otherwise fetch (or fallback)
        const revPromise = card._truthRevealPromise
          ? Promise.resolve(card._truthRevealPromise)
          : (serverMode
              ? fetch('/api/truth/reveal', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ gameId: state.villainGameId, flag: card.flag, steps: state.steps, hp: state.hp, behavior: buildGameState().behavior }),
                }).then(r => r.json()).catch(() => ({ revelation: fallbackMsg, mood: null }))
              : Promise.resolve({ revelation: fallbackMsg, mood: null }));

        revPromise.then(({ revelation, mood }) => {
          const msg = revelation || fallbackMsg;
          // 打字机效果
          let charIdx = 0;
          const typeInterval = setInterval(() => {
            if (charIdx < msg.length) {
              revText.textContent += msg[charIdx];
              charIdx++;
            } else {
              clearInterval(typeInterval);
              setTimeout(() => {
                revOverlay.classList.add('fade-out');
                setTimeout(() => revOverlay.remove(), 1500);
              }, 2500);
            }
          }, 80);
          if (mood) setEyeEmotion(mood, 6000);
          else setEyeEmotion('curious', 6000);
          logEntry(t('payoff.log.reveal', { msg }), 'important');
        });

        setAiSpeech('……');
      }
      break;
    }
    case 'PAYOFF': {
      // ── Payoff：方向情报 + 5% 概率回血 ──
      // AI briefly goes silent and angry — payoff is its failure
      setEyeEmotion('angry', 6000);
      const trueHint = getDirectionalHint(true);
      const payoffIntel = [
        t('payoff.intel.1', { hint: trueHint }),
        t('payoff.intel.2', { hint: trueHint }),
        t('payoff.intel.3', { hint: trueHint }),
        t('payoff.intel.4', { hint: trueHint }),
      ];
      const intel = randomOf(payoffIntel);
      const payoffVillainReactions = [
        t('payoff.villain.1'),
        t('payoff.villain.2'),
        t('payoff.villain.3'),
        t('payoff.villain.4'),
        t('payoff.villain.5'),
        t('payoff.villain.6'),
      ];
      const villainReaction = randomOf(payoffVillainReactions);
      const healsThisTime = Math.random() < 0.05 && state.hp < 3;
      const payoffTexts = healsThisTime
        ? [
            { title: t('payoff.heal.rift.title'), text: t('payoff.heal.rift.text') },
            { title: t('payoff.heal.calm.title'), text: t('payoff.heal.calm.text') },
          ]
        : [
            { title: t('payoff.normal.crack.title'), text: t('payoff.normal.crack.text') },
            { title: t('payoff.normal.echo.title'), text: t('payoff.normal.echo.text') },
          ];
      const payoff = randomOf(payoffTexts);
      showEventOverlay(payoff.title, payoff.text, [
        { label: t('payoff.accept'), onClick: () => {
            if (healsThisTime) {
              state.hp++; updateHearts(); audio.playHpGain();
              logHpEvent('payoff', +1);
              logEntry(t('payoff.log.heal', { hp: state.hp, hint: trueHint }), 'important');
            } else {
              logEntry(t('payoff.log.intel', { hint: trueHint }), 'important');
            }
            setAiSpeech(intel);
            setTimeout(() => {
              setAiSpeech(villainReaction);
              setEyeEmotion('mocking', 4000);
            }, 3800);
            logDecision('payoff-accept', { hpAfter: state.hp, hint: trueHint, healed: healsThisTime });
          } },
      ], EVENT_IMAGES.payoff);
      break;
    }
  }
  // ── Pressure bonus：20% 概率触发额外轻量效果 ──
  if (card.type === 'blocker' && Math.random() < 0.20) {
    const bonusPool = ['ECHO_LOOP', 'SHADOW_CHASE', 'JUMPSCARE'].filter(e => e !== card.id);
    const bonus = randomOf(bonusPool);
    Timers.set('pressure-bonus', () => {
      if (bonus === 'ECHO_LOOP' && state.effects.echoLoopSteps <= 0) {
        audio.playEchoLoop();
        state.effects.echoLoopSteps = 2;
        buildChoices();
        document.body.classList.add('echo-active');
        setTimeout(() => document.body.classList.remove('echo-active'), 500);
        logEntry(t('pressure.echoLoop.bonus.log'), 'danger');
        updatePressureAtmosphere();
      } else if (bonus === 'SHADOW_CHASE' && state.effects.shadowChaseSteps <= 0) {
        audio.playShadowChase();
        state.effects.shadowChaseSteps = 3;
        setAiSpeech(t('pressure.shadowChase.bonus.speech'));
        logEntry(t('pressure.shadowChase.bonus.log'), 'danger');
        updatePressureAtmosphere();
      } else if (bonus === 'JUMPSCARE') {
        audio.playJumpscare();
        const token = ++state.effects.panicMoveToken;
        Timers.set('bonus-jumpscare-penalty', () => {
          if (token !== state.effects.panicMoveToken) return;
          if (isMinigameActive() || isEventOverlayActive()) return;
          state.hp = Math.max(0, state.hp - 1);
          updateHearts(); audio.playHpLoss();
          logHpEvent('jumpscare_bonus_timeout', -1);
          logEntry(t('pressure.jumpscare.bonus.log'), 'danger');
          if (state.hp <= 0) handleGameOver();
        }, 3000);
        logEntry(t('pressure.jumpscare.bonus.trigger.log'), 'danger');
      }
    }, 1500); // 延迟 1.5s 触发，不和主效果冲突
  }
  // Update pressure atmosphere whenever a mechanism triggers
  updatePressureAtmosphere();
}

// ═══════════════════════════════════════════════════════════════
// MINIGAME
// ═══════════════════════════════════════════════════════════════
// triggerMinigame, closeMinigame, submitMinigame, handleJudgment, useGodHand, useRetreat → moved to js/trials.js

const _heartBreakTimers = [null, null, null, null]; // index 1-3

let _prevHp = 3; // track previous HP for change detection
function updateHearts() {
  const hpChanged = state.hp !== _prevHp;
  const hpLost = hpChanged && state.hp < _prevHp;
  const hpGained = hpChanged && state.hp > _prevHp;

  for (let i = 1; i <= 3; i++) {
    const h = document.getElementById(`heart-${i}`);
    if (!h) continue;

    // Always cancel any pending breaking→lost timeout for this heart
    if (_heartBreakTimers[i]) {
      clearTimeout(_heartBreakTimers[i]);
      _heartBreakTimers[i] = null;
    }

    if (i > state.hp) {
      if (!h.classList.contains('lost')) {
        // Play breaking animation then mark lost
        h.classList.remove('breaking');
        void h.offsetWidth; // force reflow so animation restarts
        h.classList.add('breaking');
        _heartBreakTimers[i] = setTimeout(() => {
          _heartBreakTimers[i] = null;
          h.classList.remove('breaking');
          h.classList.add('lost');
        }, 500);
      }
    } else {
      h.classList.remove('lost', 'breaking');
    }
  }

  // HP number transition animation
  const hpText = document.getElementById('hp-text');
  if (hpText) {
    hpText.textContent = `${state.hp}/3`;
    if (hpChanged) {
      hpText.classList.remove('hp-num-drop', 'hp-num-rise');
      void hpText.offsetWidth;
      hpText.classList.add(hpLost ? 'hp-num-drop' : 'hp-num-rise');
      setTimeout(() => hpText.classList.remove('hp-num-drop', 'hp-num-rise'), 500);
    }
  }

  // Screen vignette on HP change
  if (hpLost) {
    const vignette = document.createElement('div');
    vignette.className = 'hp-loss-vignette';
    document.body.appendChild(vignette);
    setTimeout(() => vignette.remove(), 1300);
  } else if (hpGained) {
    const glow = document.createElement('div');
    glow.className = 'hp-gain-glow';
    document.body.appendChild(glow);
    setTimeout(() => glow.remove(), 1600);
  }

  _prevHp = state.hp;
  // Update HP color grading + particle color
  audio.onHpChange(state.hp);
  particles.onHpChange(state.hp);
  // Update body HP class for CSS-driven effects (cursor, filter, etc.)
  document.body.classList.remove('hp-3', 'hp-2', 'hp-1', 'hp-0');
  document.body.classList.add(`hp-${state.hp}`);

  // Special villain moment when HP drops to 1 for the first time
  if (state.hp === 1 && !state._triggeredHp1Warning) {
    state._triggeredHp1Warning = true;
    const lines = [
      t('hp.hp1.1'),
      t('hp.hp1.2'),
      t('hp.hp1.3'),
      t('hp.hp1.4'),
    ];
    setTimeout(() => {
      setAiSpeech(lines[Math.floor(Math.random() * lines.length)]);
      setEyeEmotion('satisfied', 0); // permanent satisfied — villain savors this
    }, 800);
  }
}

// ═══════════════════════════════════════════════════════════════
// EXIT / GAME OVER
// ═══════════════════════════════════════════════════════════════
// showScreen → moved to js/overlays.js
function hideScreen(cb) {
  const ov = document.getElementById('screen-overlay');
  ov.classList.add('fade-out');
  setTimeout(() => {
    ov.className = '';
    document.getElementById('screen-content').innerHTML = '';
    if (cb) cb();
  }, 700);
}

// ── Intro sequence ────────────────────────────────────────────
let _introShown = false;

function _getFallbackIntroLines() {
  const hasMemory = typeof _selectedMemoryLevel !== 'undefined' && _selectedMemoryLevel === 'full';
  const hist = GameHistory.get();
  const isReturn = hist.totalGames >= 1;

  if (isReturn && hist.wins >= 2) {
    return [t('intro.return.manyWins.1', { wins: hist.wins }), t('intro.return.manyWins.2'), t('intro.return.manyWins.3'), t('intro.return.manyWins.4')];
  } else if (isReturn && hist.deaths + hist.mazeLost >= 3 && hist.wins === 0) {
    return [t('intro.return.manyDeaths.1', { n: hist.totalGames }), t('intro.return.manyDeaths.2'), t('intro.return.manyDeaths.3'), t('intro.return.manyDeaths.4')];
  } else if (isReturn) {
    return [t('intro.return.default.1'), t('intro.return.default.2'), t('intro.return.default.3')];
  } else if (hasMemory) {
    return [t('intro.memory.1'), t('intro.memory.2'), t('intro.memory.3'), t('intro.memory.4')];
  } else {
    return [t('intro.noMemory.1'), t('intro.noMemory.2'), t('intro.noMemory.3'), t('intro.noMemory.4')];
  }
}

function _renderIntroLines(textLines, onComplete) {
  // Convert string array to timed line objects
  const lines = textLines.map((text, i) => ({
    text,
    delay: 400 + i * 1400,
    final: i === textLines.length - 1,
  }));

  showScreen('<div id="intro-lines"></div>', '');
  const linesEl = document.getElementById('intro-lines');
  lines.forEach(({ text, delay, final: isFinal }, i) => {
    setTimeout(() => {
      if (i > 0) {
        const prev = linesEl.children[i - 1];
        if (prev) prev.classList.add('dim');
      }
      const el = document.createElement('div');
      el.className = 'intro-line' + (isFinal ? ' final' : '');
      el.textContent = text;
      linesEl.appendChild(el);
      void el.offsetWidth;
      el.classList.add('visible');
    }, delay);
  });
  const lastDelay = lines[lines.length - 1].delay;
  setTimeout(() => {
    hideScreen(() => {
      setMode('idle');
      if (onComplete) onComplete();
    });
  }, lastDelay + 2200);
}

function showIntro(onComplete) {
  if (_introShown) { if (onComplete) onComplete(); return; }
  _introShown = true;
  setMode('event');

  // Use pre-fetched intro from boot sequence (no wait)
  const prefetched = window._prefetchedIntro;
  window._prefetchedIntro = null; // consume once
  if (prefetched && prefetched.lines && Array.isArray(prefetched.lines) && prefetched.lines.length >= 2) {
    if (prefetched.mood) setEyeEmotion(prefetched.mood, 8000);
    _renderIntroLines(prefetched.lines, onComplete);
  } else if (serverMode && state.villainGameId && !prefetched) {
    // Fallback: fetch if somehow boot didn't prefetch
    const hist = GameHistory.get();
    const hasMemory = typeof _selectedMemoryLevel !== 'undefined' && _selectedMemoryLevel === 'full';
    fetch('/api/villain/intro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: state.villainGameId,
        game_number: hist.totalGames + 1,
        wins: hist.wins || 0,
        deaths: (hist.deaths || 0) + (hist.mazeLost || 0),
        has_memory: hasMemory,
      }),
    })
    .then(r => r.json())
    .then(({ lines, mood }) => {
      if (lines && Array.isArray(lines) && lines.length >= 2) {
        if (mood) setEyeEmotion(mood, 8000);
        _renderIntroLines(lines, onComplete);
      } else {
        _renderIntroLines(_getFallbackIntroLines(), onComplete);
      }
    })
    .catch(() => {
      _renderIntroLines(_getFallbackIntroLines(), onComplete);
    });
  } else {
    _renderIntroLines(_getFallbackIntroLines(), onComplete);
  }
}

// ═══════════════════════════════════════════════════════════════
// EXIT CONDITION SYSTEM
// ═══════════════════════════════════════════════════════════════
// EXIT_CONDITIONS, countKnowledgeFlags, isExitUnlocked, getExitConditionStatus,
// handleLockedExit, updateExitSealsHUD, checkExitUnlockNotification,
// buildEndgameStats, handleExit, handleGameOver, handleMazeLost → moved to js/endgame.js

// Keep track of current choices for keyboard nav
let _currentNeighbors = [];
let _kbdFocusIdx = -1;

function kbdFocusBtn(idx) {
  const btns = document.querySelectorAll('#choice-area .choice-btn');
  btns.forEach((b,i) => b.classList.toggle('kbd-focus', i === idx));
  _kbdFocusIdx = idx;
}

document.addEventListener('keydown', e => {
  // Fullscreen lure overlay: block gameplay keys while the result flow is active
  if (window.LureViewer?.isActive?.()) {
    if (e.key === 'Escape') {
      e.preventDefault();
      window.LureViewer.close();
    }
    return;
  }

  // Minigame: Enter to submit (only shortcuts, no letter keys — they conflict with text input)
  if (isMinigameActive()) {
    if (e.key === 'Enter') { e.preventDefault(); submitMinigame(); }
    return;
  }
  // Event overlay: 键盘不应穿透到底层移动
  if (isEventOverlayActive()) {
    if (e.key === 'Escape') { e.preventDefault(); hideEventOverlay(); }
    // Number keys 1-4 select event choices
    const choiceIdx = parseInt(e.key) - 1;
    if (choiceIdx >= 0 && choiceIdx <= 3) {
      const btns = document.querySelectorAll('#event-choices .event-btn');
      if (btns[choiceIdx]) { e.preventDefault(); btns[choiceIdx].click(); }
    }
    return;
  }
  if (!inMode('idle')) return;

  const DIR_MAP = {
    ArrowUp:    'up',    w:'up',    W:'up',
    ArrowDown:  'down',  s:'down',  S:'down',
    ArrowLeft:  'left',  a:'left',  A:'left',
    ArrowRight: 'right', d:'right', D:'right',
  };
  const dir = DIR_MAP[e.key];

  if (dir) {
    e.preventDefault();
    const match = _currentNeighbors.findIndex(n => n.dir === dir);
    if (match >= 0) {
      // Flash-focus the button briefly, then move
      kbdFocusBtn(match);
      const nb = _currentNeighbors[match];
      const prevPos = state.history.length > 0 ? state.history[state.history.length-1] : null;
      const isBack  = prevPos !== null && nb.x === prevPos.x && nb.y === prevPos.y;
      setTimeout(() => { kbdFocusBtn(-1); movePlayer(nb.x, nb.y, isBack); }, 120);
    }
    return;
  }

  // Tab: cycle through buttons
  if (e.key === 'Tab') {
    e.preventDefault();
    const btns = document.querySelectorAll('#choice-area .choice-btn:not(:disabled)');
    if (!btns.length) return;
    const next = (_kbdFocusIdx + (e.shiftKey ? -1 : 1) + btns.length) % btns.length;
    kbdFocusBtn(next);
    return;
  }

  // Enter/Space: confirm kbd-focused button
  if ((e.key === 'Enter' || e.key === ' ') && _kbdFocusIdx >= 0) {
    e.preventDefault();
    const btns = document.querySelectorAll('#choice-area .choice-btn:not(:disabled)');
    btns[_kbdFocusIdx]?.click();
    return;
  }

  // R: Retreat shortcut (go back)
  if (e.key === 'r' || e.key === 'R') {
    const retreatBtn = document.getElementById('btn-retreat');
    if (retreatBtn && !retreatBtn.disabled && getComputedStyle(retreatBtn).display !== 'none') {
      e.preventDefault();
      retreatBtn.click();
    }
    return;
  }
});


// ═══════════════════════════════════════════════════════════════
// ONE-TIME TUTORIAL HINTS
// ═══════════════════════════════════════════════════════════════
const _hintShown = new Set();
function showHint(key, text, durationMs = 4000) {
  if (_hintShown.has(key)) return;
  _hintShown.add(key);
  const hint = document.createElement('div');
  hint.className = 'tutorial-hint';
  hint.textContent = text;
  document.body.appendChild(hint);
  requestAnimationFrame(() => hint.classList.add('visible'));
  setTimeout(() => {
    hint.classList.remove('visible');
    setTimeout(() => hint.remove(), 500);
  }, durationMs);
}

// Hook into game events for contextual hints
// These are called from existing code at appropriate moments
function checkFirstMoveHint() {
  if (state.steps === 1) showHint('move', t('hint.move'), 5000);
}
function checkFirstTrialHint() {
  showHint('trial', t('hint.trial'), 5000);
}
function checkFirstLureHint() {
  showHint('lure', t('hint.lure'), 5000);
}
function checkGodHandHint() {
  showHint('godhand', t('hint.godhand'), 4000);
}
