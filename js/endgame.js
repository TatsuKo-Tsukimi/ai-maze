// ═══════════════════════════════════════════════════════════════
// ENDGAME — exit conditions, win/death/lost screens, epilogues
// Extracted from mechanics.js per plans/mechanics-split-plan.md
// ═══════════════════════════════════════════════════════════════
// ─── Villain Epilogue fetcher (shared by all endgame screens) ────────────────
function _fetchVillainEpilogue(elementId, outcome, trialPassed, trialFailed, backtracks) {
  const fallbacks = {
    'escaped':   t('endgame.epilogue.escaped'),
    'trapped':   t('endgame.epilogue.trapped'),
    'maze-lost': t('endgame.epilogue.mazeLost'),
  };

  // Delay before showing epilogue (dramatic pause)
  Timers.set(elementId, () => {
    const epi = document.getElementById(elementId);
    if (!epi) return;

    if (!serverMode || !state.villainGameId) {
      // Offline: use fallback
      epi.textContent = fallbacks[outcome] || fallbacks['trapped'];
      epi.classList.add('visible');
      return;
    }

    // Show loading state
    epi.textContent = '...';
    epi.classList.add('visible');

    const decisions = state.sessionDecisions || [];
    fetch('/api/villain/epilogue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: state.villainGameId,
        outcome,
        steps: state.steps,
        hp: state.hp,
        godHand: state.godHandCount,
        trialPassed: trialPassed || 0,
        trialFailed: trialFailed || 0,
        backtracks: backtracks || 0,
      }),
    })
    .then(r => r.json())
    .then(({ epilogue, mood }) => {
      const text = epilogue || fallbacks[outcome] || '...';
      if (mood) setEyeEmotion(mood, 8000);
      // Typewriter effect
      epi.textContent = '';
      let i = 0;
      const interval = setInterval(() => {
        if (i < text.length) {
          epi.textContent += text[i];
          i++;
        } else {
          clearInterval(interval);
        }
      }, 60);
    })
    .catch(() => {
      epi.textContent = fallbacks[outcome] || '...';
    });
  }, 4000); // 4s dramatic pause before epilogue
}

const EXIT_CONDITIONS = {
  minKnowledgeFlags: 2,  // need at least 2 truth revelations
  minDepth: 6,           // must have explored to depth 6+
};

function countKnowledgeFlags() {
  const f = state.deck.knowledgeFlags;
  // Only count the 4 truth flags, not firstTrialDone
  return ['mazeRemembersBacktrack', 'agentIsAdversarial', 'exitIsConditional', 'agentJudgesAnswers']
    .filter(k => f[k]).length;
}

function isExitUnlocked() {
  return countKnowledgeFlags() >= EXIT_CONDITIONS.minKnowledgeFlags
    && state.depth >= EXIT_CONDITIONS.minDepth;
}

function getExitConditionStatus() {
  const flags = countKnowledgeFlags();
  const depthOk = state.depth >= EXIT_CONDITIONS.minDepth;
  const flagsOk = flags >= EXIT_CONDITIONS.minKnowledgeFlags;
  return {
    flagsOk, depthOk,
    flagsCurrent: flags, flagsNeeded: EXIT_CONDITIONS.minKnowledgeFlags,
    depthCurrent: state.depth, depthNeeded: EXIT_CONDITIONS.minDepth,
    unlocked: flagsOk && depthOk,
  };
}

function handleLockedExit() {
  const cond = getExitConditionStatus();
  audio.playFakeExit();
  const missing = [];
  if (!cond.flagsOk) missing.push(t('exit.locked.condSecret', { current: cond.flagsCurrent, needed: cond.flagsNeeded }));
  if (!cond.depthOk) missing.push(t('exit.locked.condDepth', { current: cond.depthCurrent, needed: cond.depthNeeded }));

  const texts = [
    t('exit.locked.text.1'),
    t('exit.locked.text.2'),
    t('exit.locked.text.3'),
  ];
  const text = texts[Math.floor(Math.random() * texts.length)];

  // Locked exit villain speech
  const lockedSpeeches = [
    t('exit.locked.speech.1'),
    t('exit.locked.speech.2'),
    t('exit.locked.speech.3'),
    t('exit.locked.speech.4'),
    t('exit.locked.speech.5'),
  ];
  const lockedSpeech = lockedSpeeches[Math.floor(Math.random() * lockedSpeeches.length)];

  showEventOverlay(t('exit.locked.title'), `${text}\n\n${t('exit.locked.needed')}${missing.join('\n')}`, [
    { label: t('exit.locked.btn'), onClick: () => {
      setAiSpeech(lockedSpeech);
      logEntry(t('exit.locked.log', { conditions: missing.join('、') }), 'danger');
    } },
  ]);
}

// Update the exit seals HUD indicator (only visible after exitIsConditional is revealed)
function updateExitSealsHUD() {
  const sealsEl = document.getElementById('exit-seals');
  if (!sealsEl) return;
  if (!state.deck.knowledgeFlags.exitIsConditional) {
    sealsEl.classList.add('hidden');
    return;
  }
  sealsEl.classList.remove('hidden');
  const cond = getExitConditionStatus();
  // Track previous state for animation
  const prevHTML = sealsEl.innerHTML;
  if (cond.unlocked) {
    sealsEl.innerHTML = `&nbsp;|&nbsp; <span class="seal-unlocked">${t('exit.seals.unlocked')}</span>`;
  } else {
    const sealIcons = [];
    for (let i = 0; i < cond.flagsNeeded; i++) {
      const filled = i < cond.flagsCurrent;
      // Animate newly filled seals
      if (filled && prevHTML.includes('◇') && i === cond.flagsCurrent - 1) {
        sealIcons.push('<span class="seal-just-unlocked">◆</span>');
      } else {
        sealIcons.push(filled ? '◆' : '◇');
      }
    }
    const depthIcon = cond.depthOk ? '◆' : '◇';
    sealsEl.innerHTML = `&nbsp;|&nbsp; <span class="seal-progress">${t('exit.seals.progress', { seals: sealIcons.join(''), depth: depthIcon })}</span>`;
  }
}

// Check if exit just became unlocked (call after revealing truth)
function checkExitUnlockNotification() {
  updateExitSealsHUD();
  if (state._exitUnlockNotified) return;
  if (isExitUnlocked()) {
    state._exitUnlockNotified = true;
    logEntry(t('exit.unlock.notify'), 'important');
    // Brief green flash on exit beacon
    const beacon = document.getElementById('exit-beacon');
    if (beacon) {
      beacon.classList.add('exit-unlock-flash');
      setTimeout(() => beacon.classList.remove('exit-unlock-flash'), 2000);
    }
  }
}

function buildEndgameStats() {
  const decisions = state.sessionDecisions || [];
  const lureFollows = decisions.filter(d => d.type === 'lure-follow').length;
  const lureIgnores = decisions.filter(d => d.type === 'lure-ignore').length;
  const lureTotal = lureFollows + lureIgnores;
  const trialAnswers = decisions.filter(d => d.type === 'trial-answer');
  const trialPrompts = new Set(trialAnswers.map(d => d.prompt || ''));
  const trialTotal = trialPrompts.size;
  const trialPassed = new Set(trialAnswers.filter(d => d.passed).map(d => d.prompt || '')).size;
  const backtracks = decisions.filter(d => d.type === 'backtrack').length;

  const lines = [];
  if (lureTotal > 0) {
    const followPct = Math.round(lureFollows / lureTotal * 100);
    lines.push(`${t('endgame.stat.clues')} <span>${lureFollows}/${lureTotal}</span> (${t('endgame.stat.trackPct', { pct: followPct })})`);
  }
  if (trialTotal > 0) {
    const passPct = Math.round(trialPassed / trialTotal * 100);
    lines.push(`${t('endgame.stat.trials')} <span>${trialPassed}/${trialTotal}</span> (${t('endgame.stat.passPct', { pct: passPct })})`);
  }
  if (backtracks > 0) {
    lines.push(`${t('endgame.stat.backtracks')} <span>${backtracks}</span>`);
  }
  // Cross-session history line
  const hist = GameHistory.get();
  if (hist.totalGames > 1) {
    lines.push(`${t('endgame.stat.cumulative')} <span>${t('endgame.stat.cumulative.record', { wins: hist.wins, losses: hist.deaths + hist.mazeLost })}</span>`);
  }

  // Truths discovered this session
  const truthLabels = {
    mazeRemembersBacktrack: t('endgame.truth.mazeRemembersBacktrack'),
    agentIsAdversarial: t('endgame.truth.agentIsAdversarial'),
    exitIsConditional: t('endgame.truth.exitIsConditional'),
    agentJudgesAnswers: t('endgame.truth.agentJudgesAnswers'),
    mazeIsYourMemory: t('endgame.truth.mazeIsYourMemory'),
    villainKnowsYou: t('endgame.truth.villainKnowsYou'),
    trialIsPersonal: t('endgame.truth.trialIsPersonal'),
    temptationIsLearned: t('endgame.truth.temptationIsLearned'),
  };
  const f = state.deck.knowledgeFlags;
  const discovered = Object.keys(truthLabels).filter(k => f[k]);
  let truthHtml = '';
  if (discovered.length > 0) {
    const truthTags = discovered.map(k =>
      `<span class="truth-tag">${truthLabels[k]}</span>`).join(' ');
    truthHtml = `<div class="endgame-truths">${truthTags}</div>`;
  }

  const detailHtml = lines.length > 0
    ? `<div class="endgame-detail">${lines.join(' &nbsp;·&nbsp; ')}</div>`
    : '';

  // Villain profile (2+ games)
  const profile = GameHistory.villainProfile();
  const profileHtml = profile
    ? `<div class="villain-profile">${t('endgame.stat.villainProfile', { profile })}</div>` : '';

  return detailHtml + truthHtml + profileHtml;
}

function handleExit() {
  endVillainSession('escaped');
  GameHistory.record('win');
  setMode('gameover');
  audio.playWin();
  renderMinimap();
  setEyeEmotion('anxious', 0); // villain is nervous — player escaped

  // ── Personalized exit commentary ────────────────────────────
  const decisions = state.sessionDecisions || [];
  const backtracks = decisions.filter(d => d.type === 'backtrack').length;
  const trialAnswers = decisions.filter(d => d.type === 'trial-answer');
  // Count by unique trial prompt, not individual attempts
  const trialPrompts = new Set(trialAnswers.map(d => d.prompt || ''));
  const trialEncounters = trialPrompts.size;
  const trialPassedPrompts = new Set(trialAnswers.filter(d => d.passed).map(d => d.prompt || ''));
  const trialPassed = trialPassedPrompts.size;
  const trialFailed = trialEncounters - trialPassed;

  let godHandNote = '';
  let aiLine;
  let performanceTag = '';

  if (state.godHandCount > 0) {
    const tmpl = GODHAND_SETTLE_LINES[Math.floor(Math.random() * GODHAND_SETTLE_LINES.length)];
    godHandNote = tmpl.replace('{n}', state.godHandCount);
    aiLine = t('endgame.victory.speech.godhand', { n: state.godHandCount });
    setEyeEmotion('mocking', 0);
  } else if (state.hp === 3 && state.steps < 35) {
    aiLine = t('endgame.victory.speech.perfect');
    performanceTag = `<div class="win-badge">${t('endgame.victory.perfect')}</div>`;
    setEyeEmotion('angry', 0);
  } else if (state.hp === 3) {
    aiLine = t('endgame.victory.speech.flawless');
    performanceTag = `<div class="win-badge">${t('endgame.victory.flawless')}</div>`;
    setEyeEmotion('angry', 0);
  } else if (state.hp === 1) {
    aiLine = t('endgame.victory.speech.close');
  } else {
    aiLine = t('endgame.victory.speech.default');
  }
  // Cross-session record check
  const hist = GameHistory.get();
  if (hist.totalGames > 1 && state.steps <= hist.bestSteps) {
    performanceTag += `<div class="win-badge">${t('endgame.victory.bestRun')}</div>`;
  }

  setAiSpeech(aiLine);
  logEntry(t('endgame.victory.log'), 'important');

  // Build personalized stats summary
  const statsLines = [
    `${t('endgame.victory.stat.steps')} <span>${state.steps}</span>`,
    `${t('endgame.victory.stat.depth')} <span>${state.depth}</span>`,
    `${t('endgame.victory.stat.hp')} <span>${state.hp}/3</span>`,
    `${t('endgame.victory.stat.godhand')} <span>${state.godHandCount}</span>`,
  ];
  if (trialEncounters > 0) statsLines.push(`${t('endgame.victory.stat.trials')} <span>${trialPassed}/${trialEncounters}</span>`);
  if (backtracks > 0) statsLines.push(`${t('endgame.victory.stat.backtracks')} <span>${backtracks}</span>`);

  const godNote = godHandNote
    ? `<div class="win-ai-note">${godHandNote}</div>` : '';
  // Victory statsLines already includes trial/backtrack — no need for detailStats here

  setTimeout(() => {
    showScreen(`
      <img class="screen-art" src="${KEY_ART.victory}" alt="" aria-hidden="true" onerror="this.remove()"/>
      <div class="win-header">SESSION TERMINATED</div>
      <div class="session-id">session ${(state.villainGameId || 'local').slice(0,8)}</div>
      <div class="win-title">${t('endgame.victory.title')}</div>
      ${performanceTag}
      <div class="win-stats">
        ${statsLines.join(' &nbsp;·&nbsp; ')}
      </div>
      ${godNote}
      <div id="villain-epilogue" class="villain-epilogue"></div>
      <button class="screen-btn green" onclick="restartGame()">${t('endgame.victory.btn')}</button>
    `, 'win');

    // ── Villain Epilogue: agent-generated final monologue ──────
    _fetchVillainEpilogue('villain-epilogue', 'escaped', trialPassed, trialFailed, backtracks);
  }, 800);
}

function handleGameOver() {
  endVillainSession('trapped');
  GameHistory.record('death');
  setMode('gameover');
  audio.playGameOver();
  renderMinimap();
  setEyeEmotion('satisfied', 0); // permanent smug
  setAiSpeech(t('endgame.death.speech'));
  logEntry(t('endgame.death.log'), 'danger');

  // ── Personalized death taunt based on game history ──────────
  const decisions = state.sessionDecisions || [];
  const backtracks = decisions.filter(d => d.type === 'backtrack').length;
  // Count failed trial encounters (unique prompts), not individual failed attempts
  const _trialAnswers = decisions.filter(d => d.type === 'trial-answer');
  const _passedPrompts = new Set(_trialAnswers.filter(d => d.passed).map(d => d.prompt || ''));
  const _allPrompts = new Set(_trialAnswers.map(d => d.prompt || ''));
  const trialFails = [..._allPrompts].filter(p => !_passedPrompts.has(p)).length;
  const lureFollows = decisions.filter(d => d.type === 'lure-follow').length;

  let taunt;
  if (state.godHandCount >= 2) {
    taunt = t('endgame.death.taunt.godhand', { n: state.godHandCount });
  } else if (backtracks > state.steps * 0.4) {
    taunt = t('endgame.death.taunt.backtrack', { n: backtracks });
  } else if (trialFails >= 3) {
    taunt = t('endgame.death.taunt.trialFail', { n: trialFails });
  } else if (lureFollows >= 2) {
    taunt = t('endgame.death.taunt.lureFall');
  } else {
    const taunts = [
      t('endgame.death.taunt.default.1'),
      t('endgame.death.taunt.default.2'),
      t('endgame.death.taunt.default.3'),
    ];
    taunt = taunts[Math.floor(Math.random() * taunts.length)];
  }

  const detailStats = buildEndgameStats();
  setTimeout(() => {
    showScreen(`
      <div class="death-label">PROCESS TERMINATED</div>
      <div class="session-id">session ${(state.villainGameId || 'local').slice(0,8)}</div>
      <div class="death-title">${t('endgame.death.title')}</div>
      <div class="death-divider"></div>
      <div class="death-body">${taunt}</div>
      <div class="death-stats">
        ${t('endgame.death.stat.steps')} <span>${state.steps}</span> &nbsp;·&nbsp;
        ${t('endgame.death.stat.godhand')} <span>${state.godHandCount}</span> &nbsp;·&nbsp;
        ${t('endgame.death.stat.depth')} <span>${state.depth}</span>
      </div>
      ${detailStats}
      <div id="villain-epilogue-death" class="villain-epilogue"></div>
      <button class="screen-btn red" onclick="restartGame()">${t('endgame.death.btn')}</button>
    `, 'death');

    // ── Villain Epilogue: agent-generated ──────────────────────
    _fetchVillainEpilogue('villain-epilogue-death', 'trapped', 0, trialFails, backtracks);
  }, 600);
}

function handleMazeLost() {
  endVillainSession('trapped');
  GameHistory.record('maze-lost');
  setMode('gameover');
  audio.playGameOver();
  renderMinimap();
  setEyeEmotion('satisfied', 0);
  setAiSpeech(t('endgame.lost.speech'));
  logEntry(t('endgame.lost.log'), 'danger');

  // ── Personalized maze-lost taunt ──────────────────────────────
  const decisions = state.sessionDecisions || [];
  const backtracks = decisions.filter(d => d.type === 'backtrack').length;
  const visited = state.visited ? state.visited.size : 0;
  const totalCells = Math.floor(GRID_W * GRID_H * 0.55); // approx path cells

  let taunt;
  if (backtracks > 20) {
    taunt = t('endgame.lost.taunt.backtrack', { n: backtracks });
  } else if (visited < totalCells * 0.3) {
    taunt = t('endgame.lost.taunt.fewVisited');
  } else if (state.depth < 8) {
    taunt = t('endgame.lost.taunt.shallow', { depth: state.depth });
  } else {
    const taunts = [
      t('endgame.lost.taunt.default.1'),
      t('endgame.lost.taunt.default.2'),
      t('endgame.lost.taunt.default.3'),
      t('endgame.lost.taunt.default.4'),
    ];
    taunt = taunts[Math.floor(Math.random() * taunts.length)];
  }

  const detailStats = buildEndgameStats();
  setTimeout(() => {
    showScreen(`
      <img class="screen-art" src="${KEY_ART.maze_lost}" alt="" aria-hidden="true" onerror="this.remove()"/>
      <div class="death-label">SIGNAL LOST</div>
      <div class="session-id">session ${(state.villainGameId || 'local').slice(0,8)}</div>
      <div class="death-title">${t('endgame.lost.title')}</div>
      <div class="death-divider"></div>
      <div class="death-body">${taunt}</div>
      <div class="death-stats">
        ${t('endgame.death.stat.steps')} <span>${state.steps}</span> &nbsp;·&nbsp;
        ${t('endgame.death.stat.godhand')} <span>${state.godHandCount}</span> &nbsp;·&nbsp;
        ${t('endgame.death.stat.depth')} <span>${state.depth}</span>
      </div>
      ${detailStats}
      <div id="villain-epilogue-lost" class="villain-epilogue"></div>
      <button class="screen-btn red" onclick="restartGame()">${t('endgame.lost.btn')}</button>
    `, 'death');

    // ── Villain Epilogue: agent-generated ──────────────────────
    _fetchVillainEpilogue('villain-epilogue-lost', 'maze-lost', 0, 0, backtracks);
  }, 600);
}

