// ═══════════════════════════════════════════════════════════════
// TRIAL SYSTEM — minigame trigger, submission, judgment, God Hand, Retreat
// Extracted from mechanics.js per plans/mechanics-split-plan.md
// ═══════════════════════════════════════════════════════════════

function triggerMinigame(isVariant) {
  setMode('event'); // Block movement buttons while trial is active
  const trial = state.lastTrialData || getFallbackTrial();
  state.minigameFailCount = 0;
  state._trialAttempts = []; // accumulate attempts for summary
  _submittingTrial = false; // reset debounce for new trial
  state.minigameReturnPos = { ...state.playerPos };
  // Show evidence (context from player's files) if available — collapsible
  const evidenceEl = document.getElementById('minigame-evidence');
  const evidenceToggle = document.getElementById('minigame-evidence-toggle');
  if (trial.evidence) {
    evidenceEl.textContent = trial.evidence;
    evidenceEl.classList.add('visible');
    evidenceEl.classList.remove('expanded');
    // Show toggle only if content overflows (more than ~1 line)
    const needsToggle = trial.evidence.length > 60;
    if (needsToggle) {
      evidenceToggle.classList.add('visible');
      evidenceToggle.textContent = t('trial.evidence.expand');
      evidenceToggle.onclick = () => {
        const isExpanded = evidenceEl.classList.toggle('expanded');
        evidenceToggle.textContent = isExpanded ? t('trial.evidence.collapse') : t('trial.evidence.expand');
      };
      evidenceEl.onclick = () => {
        const isExpanded = evidenceEl.classList.toggle('expanded');
        evidenceToggle.textContent = isExpanded ? t('trial.evidence.collapse') : t('trial.evidence.expand');
      };
    } else {
      evidenceEl.classList.add('expanded'); // short evidence: show fully
      evidenceToggle.classList.remove('visible');
    }
  } else {
    evidenceEl.textContent = '';
    evidenceEl.classList.remove('visible');
    evidenceToggle.classList.remove('visible');
  }
  document.getElementById('minigame-title').textContent = isVariant ? t('trial.title.variant') : t('trial.title.normal');
  const trialShellKicker = document.querySelector('#minigame-overlay .shell-kicker');
  if (trialShellKicker) trialShellKicker.textContent = isVariant ? 'runtime / variant gate' : 'runtime / response gate';
  document.getElementById('minigame-prompt').textContent = trial.prompt;
  document.getElementById('minigame-input').value = '';
  // Context-aware placeholder
  const placeholders = state.hp <= 1
    ? [t('trial.placeholder.lastChance.1'), t('trial.placeholder.lastChance.2'), t('trial.placeholder.lastChance.3')]
    : state.minigameFailCount > 0
      ? [t('trial.placeholder.retry.1'), t('trial.placeholder.retry.2'), t('trial.placeholder.retry.3')]
      : [t('trial.placeholder.default.1'), t('trial.placeholder.default.2'), t('trial.placeholder.default.3')];
  document.getElementById('minigame-input').placeholder = placeholders[Math.floor(Math.random() * placeholders.length)];
  document.getElementById('minigame-hint').textContent = t('trial.hintAwaiting');
  document.getElementById('minigame-taunt').textContent = '';
  document.getElementById('minigame-taunt').classList.remove('visible');
  document.getElementById('minigame-retreat-wrap').classList.remove('visible');
  document.getElementById('minigame-escapes').classList.remove('visible');
  document.getElementById('fail-counter').textContent = '';
  document.getElementById('fail-counter').classList.remove('warning');
  document.getElementById('btn-godhand').disabled = state.hp <= 0;
  const minigameOverlay = document.getElementById('minigame-overlay');
  minigameOverlay.classList.remove('runtime-press');
  void minigameOverlay.offsetWidth;
  minigameOverlay.classList.add('active', 'runtime-press');
  document.getElementById('minigame-input').focus();
  setTimeout(() => minigameOverlay.classList.remove('runtime-press'), 540);
  state._trialShownAt = Date.now(); // track when trial prompt appeared
  checkFirstTrialHint();
  // Speculative prefetch: player will be busy reading/typing, prefetch next card
  speculativePrefetch(1000);
  // Context-aware AI speech when trial opens
  const trialOpenLines = state.hp <= 1
    ? [t('trial.speech.lowHp.1'), t('trial.speech.lowHp.2'), t('trial.speech.lowHp.3')]
    : [t('trial.speech.open.1'), t('trial.speech.open.2'), t('trial.speech.open.3')];
  setAiSpeech(trialOpenLines[Math.floor(Math.random() * trialOpenLines.length)]);
  logEntry(t('trial.log.locked'), 'danger');
}

function closeMinigame() {
  const overlay = document.getElementById('minigame-overlay');
  overlay.classList.add('closing');
  document.getElementById('minigame-retreat-wrap').classList.remove('visible');
  document.getElementById('minigame-escapes').classList.remove('visible');
  setTimeout(() => {
    overlay.classList.remove('active', 'closing');
    setMode('idle'); // Re-enable movement after trial closes
  }, 250);
}

let _submittingTrial = false; // debounce guard — prevents Enter key + click double-submit

async function submitMinigame() {
  const raw = document.getElementById('minigame-input').value.trim();
  const input = raw.slice(0, 200);
  if (!input) return;
  if (_submittingTrial) return; // ← debounce: reject concurrent submits
  _submittingTrial = true;

  const trial = state.lastTrialData || getFallbackTrial();
  const gs    = buildGameState();

  if (serverMode) {
    // 禁止重复提交
    const submitBtn = document.getElementById('minigame-submit');
    submitBtn.disabled = true;
    submitBtn.dataset.busy = 'true';
    submitBtn.textContent = t('trial.submitting');
    setAiThinking(true);
    try {
      const res = await fetch('/api/judge/answer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trial_prompt:      trial.prompt,
          evaluation_guide:  trial.evaluation_guide,
          player_input:      input,
          fail_count:        state.minigameFailCount,
          ...gs,
        }),
      });
      const judgeResult = await res.json();
      const { judgment, feedback, mood, hit } = judgeResult;
      // Accumulate attempt for trial summary
      state._trialAttempts.push({ input, passed: judgment === 'pass', hit: !!hit });
      setAiThinking(false);
      submitBtn.disabled = false;
      submitBtn.dataset.busy = 'false';
      submitBtn.textContent = t('trial.submit');
      _submittingTrial = false; // ← unlock after response
      if (mood) setEyeEmotion(mood, 5000);
      handleJudgment(judgment === 'pass', feedback, input, trial);
    } catch {
      const fallbackPassed = input.length > 1;
      state._trialAttempts.push({ input, passed: fallbackPassed, hit: false });
      setAiThinking(false);
      submitBtn.disabled = false;
      submitBtn.dataset.busy = 'false';
      submitBtn.textContent = t('trial.submit');
      _submittingTrial = false; // ← unlock on error too
      handleJudgment(fallbackPassed, t('trial.speech.fail.fallback'), input, trial);
    }
  } else {
    // 无服务：简单兜底判断
    _submittingTrial = false;
    handleJudgment(input.length > 1, input.length > 1 ? t('trial.speech.pass.default') : t('trial.speech.fail.default'), input, trial);
  }
}

function handleJudgment(passed, feedback, input, trial) {
  const trialResponseMs = state._trialShownAt ? Date.now() - state._trialShownAt : 0;
  logDecision('trial-answer', { answer: input, passed, prompt: trial?.prompt || '' });
  // Feed raw timing data
  state._behaviorRaw.trialTimings.push({
    promptShownAt: state._trialShownAt || 0,
    submittedAt: Date.now(),
    responseMs: trialResponseMs,
    inputLength: input.length,
    passed,
  });
  // Track for dynamic difficulty
  state.recentTrialResults.push(passed ? 'pass' : 'fail');
  if (state.recentTrialResults.length > 5) state.recentTrialResults.shift();
  if (passed) {
    audio.playTrialPass();
    state.deck.knowledgeFlags.firstTrialDone = true;
    sendTrialComplete('pass');
    // Show pass feedback with animation before closing
    const promptEl = document.getElementById('minigame-prompt');
    promptEl.textContent = `[ pass ] ${feedback || t('trial.speech.pass.default')}`;
    promptEl.classList.remove('result-pass', 'result-fail');
    void promptEl.offsetWidth;
    promptEl.classList.add('result-pass');
    setTimeout(() => {
      closeMinigame();
      fillQueue(); buildChoices();
    }, 600);
    setAiSpeech(feedback || t('trial.speech.pass.default'));
    setEyeEmotion('angry', 3000);
    logEntry(t('trial.log.pass', { feedback: (feedback || t('trial.speech.pass.alt')).slice(0, 40) }), 'important');
    return;
  }
  audio.playTrialFail();
  setEyeEmotion('mocking', 4000);
  state.minigameFailCount++;
  // 13 fails in a single trial — instant kill
  if (state.minigameFailCount >= 13) {
    sendTrialComplete('stubborn_death');
    state.hp = 0;
    logHpEvent('stubborn_death', -(state.hp || 3));
    updateHearts();
    setAiSpeech(t('trial.stubbornDeath'));
    setEyeEmotion('satisfied', 6000);
    logEntry(t('trial.stubbornDeath.log'), 'danger');
    setTimeout(() => { closeMinigame(); handleGameOver(); }, 1500);
    return;
  }
  // Fail animation on prompt text
  const promptEl = document.getElementById('minigame-prompt');
  promptEl.classList.remove('result-pass', 'result-fail');
  void promptEl.offsetWidth;
  promptEl.classList.add('result-fail');
  setTimeout(() => promptEl.classList.remove('result-fail'), 500);
  // Input shake
  const inp = document.getElementById('minigame-input');
  inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake');
  inp.style.borderColor = '#ff4757';
  setTimeout(() => { inp.style.borderColor = ''; inp.classList.remove('shake'); }, 500);
  const hint = trial?.hint;
  document.getElementById('minigame-hint').textContent = hint ? `hint // ${hint}` : t('trial.hintNotPassed');
  document.getElementById('minigame-submit').dataset.busy = 'false';
  setAiSpeech(feedback || t('trial.speech.fail.default'));
  const fc = document.getElementById('fail-counter');
  fc.textContent = `failures // ${state.minigameFailCount}/5`; 
  if (state.minigameFailCount >= 3) fc.classList.add('warning');
  logEntry(t('trial.log.fail', { count: state.minigameFailCount, feedback: (feedback || t('trial.speech.fail.default')).slice(0, 30) }), 'danger');
  // Escalating villain taunts on repeated failures
  if (state.minigameFailCount >= 5) {
    document.getElementById('minigame-escapes').classList.add('visible');
    document.getElementById('btn-godhand').disabled = state.hp <= 0;
    checkGodHandHint();
    document.getElementById('minigame-hint').textContent = t('trial.overrideUnlocked');
    setAiSpeech(t('trial.speech.choices'));
    setEyeEmotion('satisfied', 5000);
  } else if (state.minigameFailCount === 4) {
    document.getElementById('minigame-input').placeholder = t('trial.placeholder.lastAttempt');
    document.getElementById('minigame-taunt').textContent = t('trial.taunt.fail4');
    document.getElementById('minigame-taunt').classList.add('visible');
  } else if (state.minigameFailCount === 3) {
    document.getElementById('minigame-input').placeholder = t('trial.placeholder.thinkHard');
    document.getElementById('minigame-taunt').textContent = t('trial.taunt.fail3');
    document.getElementById('minigame-taunt').classList.add('visible');
  } else if (state.minigameFailCount === 2) {
    // Retreat unlocks at 2 fails — gives player an early exit for bad questions
    document.getElementById('minigame-retreat-wrap').classList.add('visible');
    document.getElementById('minigame-taunt').textContent = t('trial.taunt.fail2');
    document.getElementById('minigame-taunt').classList.add('visible');
  }
}

function useGodHand() {
  if (state.hp <= 0) return;
  sendTrialComplete('god_hand');
  state.hp--; state.godHandCount++;
  logHpEvent('god_hand', -1);
  updateHearts(); audio.playGodHand();

  const taunt = GODHAND_TAUNTS[Math.floor(Math.random()*GODHAND_TAUNTS.length)];
  setAiSpeech(taunt);
  setEyeEmotion('angry', 4000);
  logDecision('god-hand', { hpAfter: state.hp, totalUses: state.godHandCount });
  logEntry(t('godhand.log', { hp: state.hp }), 'danger');

  // 上帝之手：只显示嘲讽，不揭露答案（审讯式 Trial 没有标准答案）
  const tauntEl = document.getElementById('minigame-taunt');
  tauntEl.innerHTML = `<span style="display:block;margin-bottom:6px;">${taunt}</span>`;
  tauntEl.classList.add('visible');

  setTimeout(() => {
    closeMinigame();
    if (state.hp <= 0) { handleGameOver(); }
    else { fillQueue(); buildChoices(); }
  }, 1200);
}

function useRetreat() {
  sendTrialComplete('retreat');
  closeMinigame();
  audio.playRetreat();
  const taunt = RETREAT_TAUNTS[Math.floor(Math.random()*RETREAT_TAUNTS.length)];
  setAiSpeech(taunt);
  setEyeEmotion('satisfied', 3000);
  logDecision('retreat', { from: { ...state.playerPos } });
  logEntry(t('trial.log.retreat'));
  // Avoidance penalty: every 3rd avoidance (retreat + lure-ignore) costs 1 HP
  state._avoidanceCount = (state._avoidanceCount || 0) + 1;
  if (state._avoidanceCount % 3 === 0) {
    state.hp = Math.max(0, state.hp - 1);
    updateHearts();
    logHpEvent('avoidance_penalty', -1);
    logEntry(t('trial.log.avoidance', { count: state._avoidanceCount }), 'danger');
    if (state.hp <= 0) { handleGameOver(); return; }
  }
  if (state.history.length > 0) {
    const prev = state.history.pop();
    state.playerPos = { ...prev };
    state.steps++; state.depth = state.history.length;
    document.getElementById('step-count').textContent = state.steps;
    document.getElementById('depth-count').textContent = state.depth;
    fillQueue();
    renderScene({ card: { type:'none' } });
    renderMinimap(); buildChoices();
  }
  setMode('idle'); // Ensure movement re-enabled after retreat
}

/**
 * Send trial summary to server when trial concludes (pass, god-hand, or retreat).
 * Replaces per-judgment trialNote injection with a single enriched summary.
 */
function sendTrialComplete(exitMethod) {
  if (!serverMode || !state.villainGameId) return;
  const trial = state.lastTrialData;
  if (!trial) return;
  const attempts = state._trialAttempts || [];
  if (attempts.length === 0 && exitMethod !== 'retreat') return; // retreat with 0 attempts is possible (retreat before answering — shouldn't happen but guard)
  const uniqueAnswers = new Set(attempts.map(a => a.input.trim().toLowerCase())).size;
  const totalTimeMs = state._trialShownAt ? Date.now() - state._trialShownAt : 0;
  fetch('/api/trial/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gameId: state.villainGameId,
      prompt: trial.prompt || '',
      confrontation_type: trial.confrontation_type || 'unknown', // passthrough only, server is authoritative
      attempts: attempts.map(a => ({ input: a.input, passed: a.passed, hit: a.hit })),
      uniqueAnswers,
      exitMethod, // 'pass' | 'god_hand' | 'retreat'
      totalTimeMs,
      step: state.steps || 0,
    }),
  }).catch(() => {}); // fire-and-forget
}
