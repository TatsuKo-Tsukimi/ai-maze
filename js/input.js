// ═══════════════════════════════════════════════════════════════
// UTILITY
// ═══════════════════════════════════════════════════════════════
let _twTimer = null;
// Floating whisper positions — four zones around center, avoiding dead center
const _whisperZones = [
  { top: '5%',  left: '3%',  align: 'left'  },    // top-left
  { top: '3%',  left: '55%', align: 'left'  },    // top-right
  { top: '68%', left: '3%',  align: 'left'  },    // bottom-left
  { top: '70%', left: '55%', align: 'left'  },    // bottom-right
  { top: '25%', left: '58%', align: 'left'  },    // mid-right
  { top: '30%', left: '3%',  align: 'left'  },    // mid-left
];
let _whisperZoneIndex = Math.floor(Math.random() * _whisperZones.length);
const _activeWhispers = new Set();
const WHISPER_DURATION = 5000; // 5 seconds visible
const MAX_WHISPERS = 4;       // max simultaneous

function setAiSpeech(rawText, speed = 0) {
  // Also update the hidden legacy element for any code that reads it
  const legacyEl = DOM.id('ai-speech');
  if (legacyEl) legacyEl.textContent = rawText.replace(/<[^>]+>/g, '');

  // Eye glitch on new speech
  const bar = DOM.id('ai-speech-bar');
  if (bar) {
    bar.classList.remove('eye-glitch');
    void bar.offsetWidth;
    bar.classList.add('eye-glitch');
    setTimeout(() => bar.classList.remove('eye-glitch'), 400);
  }

  // Strip HTML
  const text = rawText.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
  if (!text || text === '……') return;

  // Remove oldest whisper if at max
  if (_activeWhispers.size >= MAX_WHISPERS) {
    const oldest = _activeWhispers.values().next().value;
    if (oldest) _removeWhisper(oldest);
  }

  // Pick next zone (round-robin with jitter)
  _whisperZoneIndex = (_whisperZoneIndex + 1 + Math.floor(Math.random() * 2)) % _whisperZones.length;
  const zone = _whisperZones[_whisperZoneIndex];

  // Create floating whisper element
  const whisper = document.createElement('div');
  whisper.className = 'ai-whisper';
  // Add slight random offset so overlapping zones don't stack exactly
  const jitterX = (Math.random() - 0.5) * 8;  // ±4%
  const jitterY = (Math.random() - 0.5) * 6;  // ±3%
  whisper.style.top = `calc(${zone.top} + ${jitterY}%)`;
  whisper.style.left = `calc(${zone.left} + ${jitterX}%)`;
  whisper.style.textAlign = zone.align;

  // Typewriter effect
  const hp = (typeof state !== 'undefined' && state?.hp) ?? 3;
  if (speed === 0) {
    if      (hp <= 1) speed = 65;
    else if (hp <= 2) speed = 45;
    else              speed = 32;
  }

  const container = document.getElementById('scene-container') || document.body;
  container.appendChild(whisper);
  _activeWhispers.add(whisper);

  // Entrance animation
  requestAnimationFrame(() => whisper.classList.add('visible'));

  // Typewriter
  let i = 0;
  const cursor = document.createElement('span');
  cursor.className = 'whisper-cursor';
  whisper.appendChild(cursor);
  const twInterval = setInterval(() => {
    if (i >= text.length) {
      clearInterval(twInterval);
      cursor.remove();
      return;
    }
    whisper.insertBefore(document.createTextNode(text[i]), cursor);
    i++;
  }, speed);

  // Auto-remove after duration
  setTimeout(() => _removeWhisper(whisper, twInterval), WHISPER_DURATION);
}

function _removeWhisper(whisper, twInterval) {
  if (!whisper || !whisper.parentNode) return;
  if (twInterval) clearInterval(twInterval);
  whisper.classList.add('fading');
  _activeWhispers.delete(whisper);
  setTimeout(() => { if (whisper.parentNode) whisper.remove(); }, 800);
}

// ═══════════════════════════════════════════════════════════════
// EYE — Natural blink + saccade (JS-driven for organic timing)
// ═══════════════════════════════════════════════════════════════

const _eyeState = { gaze: { x: 0, y: 0 }, scaleY: 1 };

function _applyEyeTransform() {
  const lid = document.getElementById('eye-lid');
  if (!lid) return;
  lid.style.transform = `translate(${_eyeState.gaze.x}px, ${_eyeState.gaze.y}px) scaleY(${_eyeState.scaleY})`;
}

function _eyeBlinkLoop() {
  const lid = document.getElementById('eye-lid');
  if (!lid) return;

  function blink() {
    // Quick close (80ms)
    lid.style.transition = 'transform 0.08s ease-in';
    _eyeState.scaleY = 0.05;
    _applyEyeTransform();
    // Quick open (100ms)
    setTimeout(() => {
      lid.style.transition = 'transform 0.1s ease-out';
      _eyeState.scaleY = 1;
      _applyEyeTransform();
    }, 80);
  }

  function schedule() {
    const delay = 2500 + Math.random() * 3000; // 2.5-5.5s
    setTimeout(() => {
      blink();
      // 20% chance of double-blink
      if (Math.random() < 0.2) {
        setTimeout(blink, 280);
      }
      schedule();
    }, delay);
  }
  schedule();
}

function _eyeSaccadeLoop() {
  const lid = document.getElementById('eye-lid');
  if (!lid) return;

  const gazeTargets = [
    { x: 0,    y: 0 },     // center (weighted ×3)
    { x: 0,    y: 0 },
    { x: 0,    y: 0 },
    { x: -4,   y: 1 },     // left
    { x: 4,    y: 0.5 },   // right
    { x: -2.5, y: -2 },    // up-left
    { x: 3,    y: -1.5 },  // up-right
    { x: -2,   y: 2.5 },   // down-left
    { x: 2.5,  y: 2 },     // down-right
  ];

  function saccade() {
    // Pick new target, avoid repeating
    let target;
    for (let i = 0; i < 5; i++) {
      target = gazeTargets[Math.floor(Math.random() * gazeTargets.length)];
      if (target.x !== _eyeState.gaze.x || target.y !== _eyeState.gaze.y) break;
    }
    _eyeState.gaze = target;

    // Fast snap (saccades are ~50-80ms in real eyes)
    lid.style.transition = 'transform 0.07s ease-out';
    _applyEyeTransform();

    // Hold 1.2-4 seconds before next movement
    const holdTime = 1200 + Math.random() * 2800;
    setTimeout(saccade, holdTime);
  }

  setTimeout(saccade, 800);
}

// Start eye animations when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { _eyeBlinkLoop(); _eyeSaccadeLoop(); });
} else {
  setTimeout(() => { _eyeBlinkLoop(); _eyeSaccadeLoop(); }, 100);
}

function flashCounter(id) {
  const el = DOM.id(id);
  if (!el) return;
  el.classList.remove('num-flash');
  void el.offsetWidth;
  el.classList.add('num-flash');
  setTimeout(() => el.classList.remove('num-flash'), 600);
}

function logEntry(text, cls='') {
  const log = DOM.id('event-log');
  const now = new Date();
  const time = `${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const el = document.createElement('div');
  el.className = `log-entry ${cls}`;
  el.innerHTML = `<span class="time">[${time}]</span>${text}`;
  log.prepend(el);
  while (log.children.length > 40) log.removeChild(log.lastChild);
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
function initGame() {
  _initFallbackLines();
  // Show session counter for returning players
  const hist = GameHistory.get();
  const sessionEl = document.getElementById('session-num');
  if (sessionEl && hist.totalGames > 0) {
    sessionEl.textContent = `#${hist.totalGames + 1}`;
    sessionEl.classList.remove('hidden');
  }
  generateMaze();
  state.maze[1][1] = CELL_PATH;
  // exitPos is set by generateMaze() at (13,21); do not override here
  visit(1, 1);
  // Init audio on first user-initiated game
  audio.init();
  particles.init();

  // Start villain session only if not already set (boot sequence handles first-load)
  if (!state.villainGameId) startVillainSession();

  // Kick off first card pre-load
  fillQueue();

  // Show thinking indicator until first card is ready (don't consume it)
  if (serverMode && cardQueue.length > 0) {
    setAiThinking(true);
    cardQueue[0].then(() => setAiThinking(false)).catch(() => setAiThinking(false));
  }

  renderScene({ card: { type:'none' } });
  renderMinimap(); updateBehaviorMeters();
  buildChoices();
  logEntry(t('game.init'), 'important');
  startMapPulse();
  setTimeout(() => {
    document.getElementById('loading-overlay').classList.add('hidden');
    showIntro(); // plays first time only; no-op on restart
  }, 400);
}

function restartGame() {
  // End villain session BEFORE wiping state (needs gameId + decisions for stats)
  endVillainSession('quit');
  // Reset lure dedup tracking
  if (typeof resetLureDedup === 'function') resetLureDedup();
  // Record quit in persistent history (only if game was actually started)
  if (state.steps > 0) GameHistory.record('quit');
  Object.assign(state, {
    maze:[], visited:new Set(), visitedAt:new Map(), history:[],
    playerPos:{x:1,y:1}, steps:0, depth:0,
    hp:3, godHandCount:0, minigameFailCount:0, minigameReturnPos:null, _avoidanceCount:0,
    currentMechanism:null, mode:'idle', recentCards:[], facing:null,
    effects:{ echoLoopSteps:0, memoryScrambleSteps:0, panicMoveToken:0, wallCloseDir:null, wallCloseSteps:0, shadowChaseSteps:0, countdownSteps:0, countdownStartDepth:0, _countdownPulse:null, _countdownIndicator:null },
    deck: {
      idx: 0,
      knowledgeFlags: { mazeRemembersBacktrack:false, agentIsAdversarial:false, exitIsConditional:false, agentJudgesAnswers:false, firstTrialDone:false, mazeIsYourMemory:false, villainKnowsYou:false, trialIsPersonal:false, temptationIsLearned:false },
      stepsSinceLastTrial: 99,
      skipCount: 0,
      deferredTrials: [],
      _completedFirstPass: false,
    },
    sessionDecisions: [],
    _behaviorRaw: {
      gameStartTime: Date.now(),
      lastInputTime: 0,
      moveTimestamps: [],
      trialTimings: [],
      temptationChoices: [],
      hpLossEvents: [],
      directionSequence: [],
      pauseDurations: [],
      inputEditCount: 0,
      retreatCount: 0,
      godHandCount: 0,
      lockedExitAttempts: 0,
    },
    lastTrialData: null,
    _exitUnlockNotified: false,
    _triggeredHp1Warning: false,
    _maxDepth: 0,
    _backtrackStreak: 0,
    _activeWallProj: null,
    recentTrialResults: [],
    consecutiveNonCalm: 0,
    lureCache: [],
    lureCacheLoaded: false,
    villainGameId: null,
  });
  cardQueue.length = 0;
  _currentNeighbors = []; _kbdFocusIdx = -1;
  Timers.clearAll();
  audio.reset();
  if (_twTimer) { clearInterval(_twTimer); _twTimer = null; }
  for (let i=1;i<=3;i++) { const h=document.getElementById(`heart-${i}`); h.classList.remove('lost','breaking'); }
  if (_mapPulseRaf) { cancelAnimationFrame(_mapPulseRaf); _mapPulseRaf=null; }
  document.getElementById('mech-overlay').innerHTML='';
  document.getElementById('event-log').innerHTML='';
  // Clean up any lingering wall projections
  document.querySelectorAll('[data-lure-projection]').forEach(el => el.remove());
  // Clear step warning + visual effects
  const stepEl = document.getElementById('step-count');
  if (stepEl) stepEl.classList.remove('step-warning');
  document.body.classList.remove('hp-2', 'hp-1', 'hp-0', 'countdown-flash', 'countdown-vignette', 'echo-active', 'threat-pulse', 'relief-pulse');
  // Clear screen overlay if visible
  const ov = document.getElementById('screen-overlay');
  if (ov) { ov.className = ''; document.getElementById('screen-content').innerHTML = ''; }
  // Reset corridor glitch + speech bar card classes
  const corridor = document.getElementById('corridor');
  if (corridor) corridor.classList.remove('glitch-low','glitch-mid','glitch-high','glitch-lure');
  const bar = document.getElementById('ai-speech-bar');
  if (bar) bar.classList.remove('card-blocker','card-lure','card-drain','eye-glitch');
  // Clean up floating whispers
  document.querySelectorAll('.ai-whisper').forEach(w => w.remove());
  _activeWhispers.clear();
  // Reset exit proximity
  document.body.classList.remove('exit-mid','exit-near','exit-very-near');
  const beacon = document.getElementById('exit-beacon');
  if (beacon) beacon.style.backgroundImage = 'none';
  initGame();
}

// ─── Boot Sequence Helpers ────────────────────────────────────
// Controls the loading-overlay checklist + progress bar.

const BOOT_STEPS = ['agent', 'memory', 'villain', 'maze'];
const BOOT_PROGRESS = { agent: 25, memory: 50, villain: 75, maze: 100 };

function _bootEl(stepId, cls) {
  return document.querySelector(`#boot-step-${stepId} .${cls}`);
}

function bootSetActive(stepId) {
  const el = document.getElementById(`boot-step-${stepId}`);
  if (!el) return;
  el.classList.add('active');
  _bootEl(stepId, 'bstep-icon').textContent = '◎';
}

function bootSetDone(stepId, resultText, state = 'done') {
  const el = document.getElementById(`boot-step-${stepId}`);
  if (!el) return;
  el.classList.remove('active');
  el.classList.add(state);
  const icons = { done: '✓', warn: '!', fail: '✗' };
  _bootEl(stepId, 'bstep-icon').textContent = icons[state] || '✓';
  _bootEl(stepId, 'bstep-dots').textContent = '';
  _bootEl(stepId, 'bstep-result').textContent = resultText;
  // Progress bar
  const pct = BOOT_PROGRESS[stepId] || 0;
  const fill = document.getElementById('boot-progress-fill');
  const label = document.getElementById('boot-progress-pct');
  if (fill)  fill.style.width  = pct + '%';
  if (label) label.textContent = pct + '%';
}

function bootSetDots(stepId) {
  // Animate the dots span manually since CSS content animation is limited
  const dotsEl = _bootEl(stepId, 'bstep-dots');
  if (!dotsEl) return;
  const frames = ['·', '· ·', '· · ·', '· · · ·'];
  let i = 0;
  const tid = setInterval(() => {
    dotsEl.textContent = frames[i++ % frames.length];
  }, 260);
  dotsEl._tid = tid;
}

function bootClearDots(stepId) {
  const dotsEl = _bootEl(stepId, 'bstep-dots');
  if (dotsEl && dotsEl._tid) { clearInterval(dotsEl._tid); dotsEl._tid = null; }
}

function bootFinal(msg) {
  const el = document.getElementById('boot-final');
  if (el) { el.textContent = msg; el.classList.add('visible'); }
}

function bootSleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function bootFetchJson(url, options = {}) {
  const res = await fetch(url, options);
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const detail = data?.error || data?.message || `${res.status} ${res.statusText}`.trim();
    throw new Error(detail || t('boot.abort.requestFail'));
  }
  return data;
}

function summarizeMemoryHealth(health) {
  const coreFiles = health.coreFiles || {};
  const loaded = Object.entries(coreFiles).filter(([, v]) => v.loaded);
  const missing = Object.entries(coreFiles).filter(([, v]) => !v.loaded);

  // Critical: SOUL_PATH must exist and at least SOUL.md must be loaded
  if (!health.soulLoaded) {
    const reason = health.memoryLevel === 'none' ? t('boot.memory.off') : t('boot.memory.noWorkspace');
    return { state: 'fail', label: reason, degraded: true };
  }

  // Build file status summary
  const fileLabels = loaded.map(([name]) => name.replace('.md', '')).join(' · ');
  const chunks = health.factDbStats?.chunks || 0;

  // fact-db not ready is a warning (archivist is async), not a blocker
  // playerProfile not ready is normal on first boot
  const warnings = [];
  if (missing.length > 0) {
    warnings.push(t('boot.memory.missing', { files: missing.map(([name]) => name).join('/') }));
  }

  if (warnings.length > 0) {
    return {
      state: 'warn',
      label: `${fileLabels} ✓ · ${warnings.join('；')}`,
      degraded: false, // missing optional files is not degraded
    };
  }

  return {
    state: 'done',
    label: `${fileLabels} ✓` + (chunks > 0 ? ` · ${chunks} chunks` : ''),
    degraded: false,
  };
}

function generateBootMazeSnapshot() {
  generateMaze();

  const maze = state?.maze;
  if (!Array.isArray(maze) || !maze.length || !Array.isArray(maze[0]) || !maze[0].length) {
    throw new Error(t('boot.abort.mazeEmpty'));
  }

  const height = maze.length;
  const width = maze[0].length;
  const hasExit = maze.some(row => Array.isArray(row) && row.includes(CELL_EXIT));
  if (!hasExit) throw new Error(t('boot.abort.noExit'));
  if (!state?.playerPos || typeof state.playerPos.x !== 'number' || typeof state.playerPos.y !== 'number') {
    throw new Error(t('boot.abort.noSpawn'));
  }

  return { width, height };
}

function bootAbort(stepId, resultText, finalText, pendingSteps = []) {
  bootClearDots(stepId);
  bootSetDone(stepId, resultText, 'fail');
  pendingSteps.forEach(id => bootSetDone(id, t('boot.abort.aborted'), 'fail'));
  bootFinal(finalText);
}

// ─── LLM Setup Guidance Overlay ──────────────────────────────
function showLLMSetupOverlay(degradedReason) {
  // Reuse the scan-consent-overlay container
  const overlay = document.getElementById('scan-consent-overlay');
  const box = document.getElementById('scan-consent-box');

  let title, desc;
  switch (degradedReason) {
    case 'no-soul':
      title = t('llmSetup.noSoul.title');
      desc = t('llmSetup.noSoul.desc');
      break;
    case 'auth-error':
      title = t('llmSetup.authError.title');
      desc = t('llmSetup.authError.desc');
      break;
    case 'villain-fail':
      title = t('llmSetup.villainFail.title');
      desc = t('llmSetup.villainFail.desc');
      break;
    default:
      title = t('llmSetup.default.title');
      desc = t('llmSetup.default.desc');
  }

  box.innerHTML = `
    <div class="runtime-shell-header"><span class="shell-kicker">runtime / setup required</span><div class="auth-title">${title}</div></div>
    <div style="padding:1.2rem 1.8rem;line-height:1.8;color:var(--c-fg,#d4d4d4);">
      <p style="color:var(--c-warn,#ff6b6b);margin-bottom:1.2rem;">${desc}</p>

      <div style="display:flex;flex-direction:column;gap:.7rem;margin-bottom:1.2rem;">
        <button class="llm-setup-action-btn" onclick="document.getElementById('scan-consent-overlay').classList.add('hidden');showConnectOverlay();">
          ${t('llmSetup.openConnect')}
          <span style="opacity:.5;font-size:.85em;margin-left:auto;">${t('llmSetup.openConnect.sub')}</span>
        </button>
        <button class="llm-setup-action-btn" onclick="location.reload()">
          ${t('llmSetup.reload')}
          <span style="opacity:.5;font-size:.85em;margin-left:auto;">${t('llmSetup.reload.sub')}</span>
        </button>
      </div>

      <div style="background:rgba(255,255,255,.05);border-radius:6px;padding:.8rem 1rem;margin-bottom:.8rem;">
        <p style="font-weight:bold;margin-bottom:.5rem;font-size:.9em;">${t('llmSetup.noKeyTitle')}</p>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" class="llm-auth-link">
            <span>${t('llmSetup.anthropic')}</span><span style="opacity:.5;font-size:.8em;">${t('llmSetup.anthropic.sub')}</span>
          </a>
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" class="llm-auth-link">
            <span>${t('llmSetup.openai')}</span><span style="opacity:.5;font-size:.8em;">${t('llmSetup.openai.sub')}</span>
          </a>
        </div>
      </div>

      <p style="opacity:.5;font-size:.8em;text-align:center;">${t('llmSetup.openclawHint')}</p>
    </div>`;
  overlay.classList.remove('hidden');
  overlay.classList.remove('fade-out');
  // Hide loading overlay if visible
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) loadingOverlay.classList.add('hidden');
}

// ─── Scan Consent + Memory Auth + Entry Point ───────────────
let _selectedMemoryLevel = 'none';

let _langConfirmTimer = null;
function toggleLang() {
  const el = document.getElementById('lang-value');
  if (!el) return;

  // First click: show confirmation
  if (!_langConfirmTimer) {
    const current = getLocale();
    el.textContent = current === 'zh' ? '→en?' : '→zh?';
    _langConfirmTimer = setTimeout(() => {
      el.textContent = getLocale();
      _langConfirmTimer = null;
    }, 3000);
    return;
  }

  // Second click within 3s: switch and restart
  clearTimeout(_langConfirmTimer);
  _langConfirmTimer = null;
  const current = getLocale();
  const next = current === 'zh' ? 'en' : 'zh';
  setLocale(next);
  fetch('/api/config/lang', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang: next }),
  }).catch(() => {});
  // Reload page to apply language cleanly
  location.reload();
}

function selectLang(lang) {
  setLocale(lang);
  // Notify backend
  fetch('/api/config/lang', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang }),
  }).catch(() => {});
  // Hide language overlay, show scan consent
  const langOverlay = document.getElementById('lang-overlay');
  if (langOverlay) langOverlay.classList.add('hidden');
  const scanOverlay = document.getElementById('scan-consent-overlay');
  if (scanOverlay) scanOverlay.classList.remove('hidden');
  // Apply i18n to DOM
  _applyDomI18n();
}

async function acceptScanConsent(allowed) {
  const overlay = document.getElementById('scan-consent-overlay');
  if (!allowed) {
    // Denied: show choices — go back or close
    const box = document.getElementById('scan-consent-box');
    box.innerHTML = `
      <div class="runtime-shell-header"><span class="shell-kicker">runtime / terminated</span><div class="auth-title">${t('scan.denied.title')}</div></div>
      <div style="padding:1.5rem 2rem;color:var(--c-fg,#d4d4d4);text-align:center;line-height:1.8;">
        <p style="color:var(--c-warn,#ff6b6b);">${t('scan.denied.desc')}</p>
        <p style="opacity:.7;font-size:.85em;">${t('scan.denied.detail')}</p>
        <div style="display:flex;gap:1rem;justify-content:center;margin-top:1.5rem;">
          <button onclick="location.reload()" style="display:inline-flex;align-items:center;gap:.5rem;padding:.7rem 1.8rem;background:rgba(100,200,255,.15);border:1px solid rgba(100,200,255,.3);color:#8cf;border-radius:6px;cursor:pointer;font-size:.95rem;white-space:nowrap;">
            ${t('scan.denied.back')}
          </button>
          <button id="scan-deny-close-btn" onclick="try{window.close()}catch{};document.getElementById('scan-deny-close-btn').textContent=t('scan.denied.closeFallback')" style="display:inline-flex;align-items:center;gap:.5rem;padding:.7rem 1.8rem;background:rgba(255,100,100,.1);border:1px solid rgba(255,100,100,.25);color:#f88;border-radius:6px;cursor:pointer;font-size:.95rem;white-space:nowrap;">
            ${t('scan.denied.close')}
          </button>
        </div>
      </div>`;
    return;
  }
  // Allowed: disable button + show loading state
  const btn = overlay.querySelector('.auth-btn-full');
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'wait';
    const strong = btn.querySelector('strong');
    if (strong) strong.textContent = t('scan.initializing');
  }
  // Notify server and proceed
  try {
    await fetch('/api/scan/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {}
  // Fade out consent overlay
  overlay.classList.add('fade-out');
  await new Promise(r => setTimeout(r, 500));
  overlay.classList.add('hidden');

  // Proceed to soul path config
  showSoulPathConfig();
}

// ─── Soul Path Configuration ─────────────────────────────────
async function showSoulPathConfig() {
  const overlay = document.getElementById('soul-path-overlay');
  const detected = document.getElementById('soul-path-detected');
  const missing = document.getElementById('soul-path-missing');
  const input = document.getElementById('soul-path-input');
  const validateResult = document.getElementById('soul-path-validate-result');

  // Reset state
  detected.classList.add('hidden');
  missing.classList.add('hidden');
  validateResult.classList.add('hidden');
  validateResult.className = 'hidden';

  // Fetch current soul path status
  try {
    const res = await fetch('/api/health/memory');
    const health = await res.json();
    if (health.soulPath) {
      // Auto-detected
      detected.classList.remove('hidden');
      document.getElementById('soul-path-current').textContent = health.soulPath;
      const fileList = document.getElementById('soul-path-files');
      fileList.innerHTML = '';
      const coreFiles = health.coreFiles || {};
      for (const [name, info] of Object.entries(coreFiles)) {
        const tag = document.createElement('span');
        tag.className = 'auth-file-tag';
        tag.textContent = info.loaded ? `${name} ✓` : `${name} ✗`;
        tag.style.opacity = info.loaded ? '1' : '0.4';
        fileList.appendChild(tag);
      }
      input.value = health.soulPath;
    } else {
      // Not detected
      missing.classList.remove('hidden');
      input.value = '';
    }
  } catch {
    missing.classList.remove('hidden');
    input.value = '';
  }

  overlay.classList.remove('hidden');
}

async function confirmSoulPath() {
  const overlay = document.getElementById('soul-path-overlay');
  const input = document.getElementById('soul-path-input');
  const validateResult = document.getElementById('soul-path-validate-result');
  const pathValue = (input.value || '').trim();

  if (!pathValue) {
    validateResult.textContent = t('soulPath.error.empty');
    validateResult.className = 'soul-path-error';
    validateResult.classList.remove('hidden');
    return;
  }

  // Disable confirm button to prevent repeated clicks
  const confirmBtn = overlay.querySelector('.auth-btn-full');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.5';
    confirmBtn.style.cursor = 'wait';
  }

  validateResult.textContent = t('soulPath.validating');
  validateResult.className = 'soul-path-success';
  validateResult.classList.remove('hidden');

  try {
    const res = await fetch('/api/config/soul-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathValue }),
    });
    const data = await res.json();

    if (data.ok) {
      // Success — show found files then proceed
      const fileNames = Object.entries(data.files || {})
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ');
      validateResult.textContent = t('soulPath.validated', { files: fileNames || t('soulPath.validateFallback') });
      validateResult.className = 'soul-path-success';
      await new Promise(r => setTimeout(r, 800));

      // Fade out and proceed to memory auth
      overlay.classList.add('fade-out');
      await new Promise(r => setTimeout(r, 500));
      overlay.classList.add('hidden');

      const authOverlay = document.getElementById('memory-auth-overlay');
      authOverlay.classList.remove('hidden');
      scanMemory();
    } else {
      // Validation failed
      let msg = data.error || t('soulPath.error.fail');
      if (data.files) {
        const status = Object.entries(data.files)
          .map(([k, v]) => `${k}: ${v ? '✓' : '✗'}`)
          .join('  ');
        msg += '\n' + status;
      }
      validateResult.textContent = msg;
      validateResult.className = 'soul-path-error';
      validateResult.style.whiteSpace = 'pre-line';
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.style.opacity = ''; confirmBtn.style.cursor = ''; }
    }
  } catch (e) {
    validateResult.textContent = t('soulPath.error.request', { message: e.message || t('soulPath.error.network') });
    validateResult.className = 'soul-path-error';
    if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.style.opacity = ''; confirmBtn.style.cursor = ''; }
  }
}

async function skipSoulPath() {
  const overlay = document.getElementById('soul-path-overlay');
  overlay.classList.add('fade-out');
  await new Promise(r => setTimeout(r, 500));
  overlay.classList.add('hidden');

  // Proceed directly to memory auth
  const authOverlay = document.getElementById('memory-auth-overlay');
  authOverlay.classList.remove('hidden');
  scanMemory();
}

async function scanMemory() {
  const overlay    = document.getElementById('memory-auth-overlay');
  const scanStatus = document.getElementById('auth-scan-status');
  const scanResult = document.getElementById('auth-scan-result');
  const noMemory   = document.getElementById('auth-no-memory');
  const choices    = document.getElementById('auth-choices');
  const skipBtn    = document.getElementById('auth-skip');

  // Check if server is running first
  const hasServer = await detectServer();
  if (!hasServer) {
    overlay.classList.add('hidden');
    showConnectOverlay();
    return false;
  }

  try {
    const res  = await fetch('/api/memory/scan');
    const data = await res.json();

    scanStatus.classList.add('hidden');

    if (data.found && (data.files.soul || data.files.memory)) {
      scanResult.classList.remove('hidden');

      const pathEl = document.getElementById('auth-workspace-path');
      const displayPath = data.path.replace(/^\/home\/[^/]+\//, '~/');
      pathEl.textContent = '📂 ' + displayPath;

      const fileList = document.getElementById('auth-file-list');
      const files = [
        ['SOUL.md',     data.files.soul],
        ['MEMORY.md',   data.files.memory],
        ['USER.md',     data.files.user],
        ['IDENTITY.md', data.files.identity],
        [`${t('file.diary')} ×${data.files.dailyNotes}`, data.files.dailyNotes > 0],
      ];
      fileList.innerHTML = files.map(([name, found]) =>
        `<span class="auth-file-tag ${found ? 'found' : ''}">${found ? '✓' : '✗'} ${name}</span>`
      ).join('');

      choices.classList.remove('hidden');
    } else {
      noMemory.classList.remove('hidden');
      skipBtn.classList.remove('hidden');
    }
    return true;
  } catch {
    overlay.classList.add('hidden');
    return true;
  }
}

async function selectMemoryLevel(level) {
  _selectedMemoryLevel = level;

  try {
    await fetch('/api/memory/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level }),
    });
  } catch {}

  const overlay = document.getElementById('memory-auth-overlay');
  overlay.classList.add('fade-out');
  await new Promise(r => setTimeout(r, 500));
  overlay.classList.add('hidden');

  runBootSequence();
}

async function runBootSequence() {
  let introData = null;
  let degraded = false;

  // ── Step 1: Connect Agent ──
  bootSetActive('agent');
  bootSetDots('agent');

  const hasServer = await detectServer();
  if (!hasServer) {
    bootAbort('agent', t('boot.abort.agent'), t('boot.abort.agentFinal'), ['memory', 'villain', 'maze']);
    await bootSleep(600);
    showConnectOverlay();
    document.getElementById('loading-overlay').classList.add('hidden');
    return;
  }

  let ping = null;
  try {
    ping = await bootFetchJson('/api/ping');
  } catch (err) {
    bootAbort('agent', err.message || t('boot.abort.pingFail'), t('boot.abort.agentHandshake'), ['memory', 'villain', 'maze']);
    await bootSleep(600);
    showConnectOverlay();
    document.getElementById('loading-overlay').classList.add('hidden');
    return;
  }

  // Verify LLM is available — show setup guidance if missing
  if (ping?.degraded || (!ping?.hasKey && ping?.provider !== 'openclaw-gateway')) {
    bootAbort('agent', t('boot.abort.noAI'), t('boot.abort.noAIFinal'), ['memory', 'villain', 'maze']);
    await bootSleep(400);
    showLLMSetupOverlay(ping?.degraded);
    return;
  }

  bootClearDots('agent');
  const modelLabel = ping?.model ? ping.model.replace('claude-','').replace('-2024','') : 'online';
  bootSetDone('agent', modelLabel, 'done');

  // Show "change model" link next to result
  const agentResult = document.querySelector('#boot-step-agent .bstep-result');
  if (agentResult) {
    const changeLink = document.createElement('a');
    changeLink.textContent = ' ' + t('connect.change');
    changeLink.href = '#';
    changeLink.style.cssText = 'color:#8cf;opacity:.7;font-size:.85em;text-decoration:none;';
    changeLink.onclick = (e) => {
      e.preventDefault();
      showConnectOverlay();
    };
    agentResult.appendChild(changeLink);
  }
  await bootSleep(120);

  // ── Step 2: Memory ──
  bootSetActive('memory');
  bootSetDots('memory');
  try {
    const memoryHealth = await bootFetchJson('/api/health/memory');
    const memorySummary = summarizeMemoryHealth(memoryHealth);
    degraded = degraded || memorySummary.degraded;
    bootClearDots('memory');
    bootSetDone('memory', memorySummary.label, memorySummary.state);
  } catch (err) {
    degraded = true;
    bootClearDots('memory');
    bootSetDone('memory', err.message || t('boot.abort.memoryFail'), 'warn');
  }
  await bootSleep(120);

  // ── Step 3: Wake Villain (api/villain/start) ──
  bootSetActive('villain');
  bootSetDots('villain');
  try {
    const vres = await bootFetchJson('/api/villain/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!vres.gameId) throw new Error(t('boot.abort.noSession'));
    state.villainGameId = vres.gameId;
    bootClearDots('villain');
    bootSetDone('villain', 'session ready', 'done');
  } catch (err) {
    const msg = (err.message || t('boot.abort.villainFail'));
    const isAuthError = /401|authentication|unauthorized|invalid.*key/i.test(msg);
    bootAbort('villain', msg, t('boot.abort.villainFinal'), ['maze']);
    await bootSleep(400);
    if (isAuthError) {
      showLLMSetupOverlay('auth-error');
    } else {
      showLLMSetupOverlay('villain-fail');
    }
    return;
  }

  // ── Step 4: Generate Maze + Pre-fetch intro (parallel) ──
  bootSetActive('maze');
  bootSetDots('maze');

  let introPromise = null;
  if (serverMode && state.villainGameId) {
    const hist = GameHistory.get();
    const hasMemory = typeof _selectedMemoryLevel !== 'undefined' && _selectedMemoryLevel === 'full';
    introPromise = fetch('/api/villain/intro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: state.villainGameId,
        game_number: hist.totalGames + 1,
        wins: hist.wins || 0,
        deaths: (hist.deaths || 0) + (hist.mazeLost || 0),
        has_memory: hasMemory,
      }),
    }).then(r => r.json()).catch(() => null);
  }

  try {
    const mazeInfo = generateBootMazeSnapshot();
    bootClearDots('maze');
    bootSetDone('maze', `${mazeInfo.width} × ${mazeInfo.height}`, 'done');
  } catch (err) {
    degraded = true;
    bootClearDots('maze');
    bootSetDone('maze', err.message || t('boot.abort.mazeFail'), 'warn');
  }

  if (introPromise) {
    bootFinal(t('boot.final.intro'));
    introData = await introPromise;
  }

  if (introData) {
    window._prefetchedIntro = introData;
  }

  // ── Wait for at least 1 card in ammo queue (up to 15s) ──
  if (serverMode && state.villainGameId) {
    bootFinal(t('boot.final.ammo'));
    const ammoStart = Date.now();
    while (Date.now() - ammoStart < 15000) {
      try {
        const ammoRes = await fetch(`/api/ammo/status?gameId=${encodeURIComponent(state.villainGameId)}`);
        const ammo = await ammoRes.json();
        if ((ammo.cards || 0) + (ammo.trials || 0) > 0) break;
      } catch {}
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  const returnLine = GameHistory.returnLine();
  if (returnLine) {
    bootFinal(returnLine);
    await bootSleep(1800);
  } else {
    bootFinal(degraded ? t('boot.final.degraded') : t('boot.final.ready'));
    await bootSleep(520);
  }

  initGame();
  loadLureCache();
}

// ─── Auto-start ──────────────────────────────────────────────
// Reset all overlay states on page load (fixes refresh behavior)
(async () => {
  // Ensure overlays are in clean state on refresh
  const scanConsentOverlay = document.getElementById('scan-consent-overlay');
  if (scanConsentOverlay) {
    scanConsentOverlay.classList.remove('hidden', 'fade-out');
  }
  const authOverlay = document.getElementById('memory-auth-overlay');
  if (authOverlay) {
    authOverlay.classList.add('hidden');
    authOverlay.classList.remove('fade-out');
  }
  const soulPathOverlay = document.getElementById('soul-path-overlay');
  if (soulPathOverlay) {
    soulPathOverlay.classList.add('hidden');
    soulPathOverlay.classList.remove('fade-out');
  }
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) {
    loadingOverlay.classList.remove('hidden');
  }
  // Reset boot step indicators
  ['agent', 'memory', 'villain', 'maze'].forEach(step => {
    const el = document.getElementById(`boot-step-${step}`);
    if (el) {
      const icon = el.querySelector('.bstep-icon');
      const result = el.querySelector('.bstep-result');
      if (icon) icon.textContent = '○';
      if (result) result.textContent = '';
    }
  });
  const fill = document.getElementById('boot-progress-fill');
  const pct = document.getElementById('boot-progress-pct');
  if (fill) fill.style.width = '0%';
  if (pct) pct.textContent = '0%';
  const bootFinal = document.getElementById('boot-final');
  if (bootFinal) { bootFinal.textContent = ''; bootFinal.classList.remove('visible'); }

  // ── Language selection ──
  // If no saved language preference, show language selector first
  const savedLang = localStorage.getItem('maze-lang');
  if (!savedLang) {
    // Hide scan consent, show language selector
    if (scanConsentOverlay) scanConsentOverlay.classList.add('hidden');
    const langOverlay = document.getElementById('lang-overlay');
    if (langOverlay) langOverlay.classList.remove('hidden');
    // Wait for user to select language (selectLang will continue the flow)
    return;
  }
  // Sync saved language to server (server restarts lose locale state)
  fetch('/api/config/lang', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang: savedLang }),
  }).catch(() => {});
  const _langEl = document.getElementById('lang-value');
  if (_langEl) _langEl.textContent = savedLang;

  // Flow: scan consent overlay is visible by default → user clicks allow/deny
  // → acceptScanConsent() hides it and shows memory auth overlay → scanMemory()
  // Check if server is up first; if not, skip consent and go straight to connect
  const hasServer = await detectServer();
  if (!hasServer) {
    if (scanConsentOverlay) scanConsentOverlay.classList.add('hidden');
    showConnectOverlay();
  } else {
    // If server already has scan consent (from a previous page load in this server session),
    // skip the consent overlay and go straight to boot sequence
    try {
      const pingRes = await fetch('/api/ping');
      const ping = await pingRes.json();
      if (ping.scanConsentReceived) {
        if (scanConsentOverlay) scanConsentOverlay.classList.add('hidden');
        // If SOUL_PATH already configured (path exists, even if personality not loaded),
        // skip soul path overlay. Use soulPathConfigured (checks ctx.SOUL_PATH),
        // not soulLoaded (checks PERSONALITY_CONTEXT which can be cleared by memory level choice).
        if (ping.soulPathConfigured) {
          runBootSequence();
        } else {
          showSoulPathConfig();
        }
      }
    } catch {}
  }
})();
