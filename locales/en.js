'use strict';

// ─── English (en) locale — translated from zh.js ──────────────────────────────
// All keys must match zh.js exactly. Template variables use {var} format.

registerLocale('en', {

  // ═══════════════════════════════════════════════════════════════
  // UI — index.html static text
  // ═══════════════════════════════════════════════════════════════
  'ui.title': 'LABYRINTH · Permanent Imprisonment',
  'ui.meta.desc': 'Permanent Imprisonment · LABYRINTH — Your AI locked you in a maze. It has read every line you ever wrote.',
  'ui.header.title': 'PERMANENT IMPRISONMENT · LABYRINTH',
  'ui.header.kicker': 'runtime / hostile-agent workspace',
  'ui.status.label': 'Status Bar',
  'ui.status.aiReady': 'AI Ready',
  'ui.status.aiThinking': 'AI Thinking…',
  'ui.map.label': 'Explored / Fog / Ghost Trail',
  'ui.map.youAreHere': 'You are here',
  'ui.map.movable': 'Reachable',
  'ui.map.ghostTrail': 'Ghost trail',
  'ui.map.exit': 'Exit',
  'ui.log.title': 'Session Log',
  'ui.log.ariaLabel': 'Game log',
  'ui.event.title': 'System Event',
  'ui.mobile.map': '🗺 Grid',
  'ui.mobile.log': '📜 Log',
  'ui.mobile.restart': '↺ Restart',

  // ═══════════════════════════════════════════════════════════════
  // CONNECT OVERLAY
  // ═══════════════════════════════════════════════════════════════
  'connect.title': 'Connection Settings',
  'connect.tab.custom': 'Custom',
  'connect.gateway.label': 'Gateway Status',
  'connect.gateway.detecting': 'Detecting…',
  'connect.gateway.connected': '✅ Connected',
  'connect.gateway.notFound': '❌ Not detected',
  'connect.model.label': 'Model',
  'connect.model.placeholder': 'Model name',
  'connect.archivist.summary': 'Archivist model (optional, defaults to main model)',
  'connect.archivist.placeholder': 'Leave empty to use main model',
  'connect.test': 'Test Connection',
  'connect.testing': 'Testing…',
  'connect.save': 'Save & Start',
  'connect.hint': '💡 OpenClaw users: use Gateway for the full experience',
  'connect.status.current': 'Current: {source} · {model}',
  'connect.status.notConnected': 'Not connected',
  'connect.status.serverError': '⚠ Cannot reach server',
  'connect.result.ok': '✅ Connected · {model} · {latency}ms',
  'connect.result.fail': '❌ {error}',
  'connect.result.connFail': 'Connection failed',
  'connect.result.saveFail': 'Save failed',
  'connect.result.noKey': '❌ Please enter an API Key',
  'connect.result.requestFail': '❌ Request failed: {message}',
  'connect.change': '[change]',
  'connect.auth.anthropic': '→ Get Anthropic API Key',
  'connect.auth.openai': '→ Get OpenAI API Key',

  // ═══════════════════════════════════════════════════════════════
  // SCAN CONSENT
  // ═══════════════════════════════════════════════════════════════
  'scan.title': 'File Scan Authorization',
  'scan.desc': 'This game scans your local files to enhance the experience.',
  'scan.detail1': 'The scan covers documents, journals, images and other files in your Agent workspace. The AI villain uses this content to personalize gameplay.',
  'scan.detail2': 'Image files may be sent via Vision API to the LLM provider you configured (Anthropic / OpenAI / OpenClaw Gateway) for analysis.',
  'scan.warn': '⚠ File contents are never uploaded anywhere except the AI backend you configured.',
  'scan.allow': 'Allow Scan',
  'scan.allow.sub': 'Start the full experience',
  'scan.deny': 'Deny',
  'scan.deny.sub': 'No file scan — the game cannot launch',
  'scan.denied.title': 'Authorization Denied',
  'scan.denied.desc': 'File scanning is a core part of the game experience.',
  'scan.denied.detail': 'Without scan permission, the AI villain cannot personalize your experience and the game cannot start.',
  'scan.denied.back': '↩ Go back and choose again',
  'scan.denied.close': '✗ Close game',
  'scan.denied.closeFallback': 'Please close this page manually',
  'scan.initializing': 'Initializing scan…',

  // ═══════════════════════════════════════════════════════════════
  // SOUL PATH OVERLAY
  // ═══════════════════════════════════════════════════════════════
  'soulPath.title': 'Agent Memory Workspace',
  'soulPath.desc': 'The AI villain needs to read your memory files (SOUL.md, MEMORY.md, etc.) to "know you."\nPlease confirm or enter your Agent workspace directory.',
  'soulPath.detected': '✅ Workspace auto-detected',
  'soulPath.missing': '⚠ Workspace not detected',
  'soulPath.hint': 'Enter the path to your OpenClaw workspace or Agent memory directory.',
  'soulPath.hintSub': 'You can also have your OpenClaw agent configure this for you',
  'soulPath.inputLabel': 'Workspace path',
  'soulPath.inputPlaceholder': 'C:\\Users\\you\\.openclaw\\workspace',
  'soulPath.confirm': 'Confirm & Continue',
  'soulPath.confirm.sub': 'Use this path as Agent workspace',
  'soulPath.validating': 'Validating…',
  'soulPath.validated': '✅ Configured: {files}',
  'soulPath.validateFallback': 'Memory files loaded',
  'soulPath.error.empty': 'Please enter a path',
  'soulPath.error.fail': 'Path validation failed',
  'soulPath.error.request': 'Request failed: {message}',
  'soulPath.error.network': 'Network error',

  // ═══════════════════════════════════════════════════════════════
  // MEMORY AUTH OVERLAY
  // ═══════════════════════════════════════════════════════════════
  'auth.title': 'Permanent Imprisonment',
  'auth.subtitle': 'Your AI is requesting access to the memory zone',
  'auth.scanning': 'Scanning local memory files',
  'auth.noMemory': 'No Agent memory files detected',
  'auth.noMemory.sub': 'The game will run in generic mode — the AI won\'t know you',
  'auth.warn': '⚠ The more you authorize, the more it knows about you.',
  'auth.none': 'No Memory',
  'auth.none.sub': 'Looks like you have no choice.',
  'auth.soul': 'Personality Only',
  'auth.soul.sub': 'Your AI doesn\'t want you to pick this.',
  'auth.full': 'Full Access',
  'auth.full.sub': 'AI knows everything — most dangerous, most personal',
  'auth.skip': 'Start Now',
  'auth.skip.sub': 'No-memory mode',

  // ═══════════════════════════════════════════════════════════════
  // BOOT SEQUENCE
  // ═══════════════════════════════════════════════════════════════
  'boot.title': 'System Initialization',
  'boot.agent': 'Connect Agent',
  'boot.memory': 'Read Memory',
  'boot.villain': 'Wake Villain',
  'boot.maze': 'Generate Maze',
  'boot.final.degraded': 'Initialization complete · some modules degraded',
  'boot.final.ready': 'Initialization complete · it\'s waiting for you',
  'boot.final.intro': 'It\'s preparing its opening line…',
  'boot.final.ammo': 'It\'s loading ammunition…',
  'boot.abort.agent': 'Cannot reach /api/ping',
  'boot.abort.agentFinal': 'Boot failed · server offline, start the backend first',
  'boot.abort.pingFail': 'Ping failed',
  'boot.abort.agentHandshake': 'Boot failed · Agent handshake failed',
  'boot.abort.noAI': 'No AI backend detected',
  'boot.abort.noAIFinal': 'Boot failed · LLM backend configuration required',
  'boot.abort.memoryFail': 'Memory check failed',
  'boot.abort.noSession': 'No session returned',
  'boot.abort.villainFail': 'Villain wake failed',
  'boot.abort.villainFinal': 'Boot failed · cannot start villain session',
  'boot.abort.mazeFail': 'Maze generation failed',
  'boot.abort.mazeEmpty': 'Maze data is empty',
  'boot.abort.noExit': 'Exit not generated',
  'boot.abort.noSpawn': 'Spawn point not generated',
  'boot.abort.aborted': 'Aborted',
  'boot.abort.requestFail': 'Request failed',

  // Memory health
  'boot.memory.off': 'Memory injection disabled',
  'boot.memory.noWorkspace': 'Memory workspace not found',
  'boot.memory.missing': '{files} missing',

  // ═══════════════════════════════════════════════════════════════
  // LLM SETUP OVERLAY
  // ═══════════════════════════════════════════════════════════════
  'llmSetup.noSoul.title': 'Agent Memory Not Found',
  'llmSetup.noSoul.desc': 'SOUL.md or Agent workspace not found. The game needs your Agent memory files to run.',
  'llmSetup.authError.title': 'LLM Authentication Failed',
  'llmSetup.authError.desc': 'API key is invalid or expired. Please reconfigure.',
  'llmSetup.villainFail.title': 'Villain Wake Failed',
  'llmSetup.villainFail.desc': 'Cannot connect to AI backend. Please configure LLM connection.',
  'llmSetup.default.title': 'LLM Connection Failed',
  'llmSetup.default.desc': 'No available AI backend detected.',
  'llmSetup.openConnect': '⚙ Open Connection Settings',
  'llmSetup.openConnect.sub': 'Manually enter API Key',
  'llmSetup.reload': '↻ Re-detect',
  'llmSetup.reload.sub': 'Already configured? Refresh to retry',
  'llmSetup.noKeyTitle': 'No API Key? Get one here:',
  'llmSetup.anthropic': 'Anthropic Console',
  'llmSetup.anthropic.sub': '→ Get Claude API Key',
  'llmSetup.openai': 'OpenAI Platform',
  'llmSetup.openai.sub': '→ Get OpenAI API Key',
  'llmSetup.openclawHint': 'Best option: let your local OpenClaw handle the configuration',

  // ═══════════════════════════════════════════════════════════════
  // GAME INIT & LOG
  // ═══════════════════════════════════════════════════════════════
  'game.init': 'Maze initialized. Find the exit.',
  'game.history.first': 'First time in the maze.',

  // ═══════════════════════════════════════════════════════════════
  // DIRECTION LABELS
  // ═══════════════════════════════════════════════════════════════
  'direction.north': '↑ North',
  'direction.south': '↓ South',
  'direction.west': '← West',
  'direction.east': '→ East',
  'direction.back': '← Go back',
  'direction.hint.east': 'east',
  'direction.hint.west': 'west',
  'direction.hint.south': 'south',
  'direction.hint.north': 'north',
  'direction.wallClose.north': 'north',
  'direction.wallClose.south': 'south',
  'direction.wallClose.west': 'west',
  'direction.wallClose.east': 'east',
  'direction.wallClose.unknown': 'some direction',
  'direction.fakeLabel.1': '↑ Forward',
  'direction.fakeLabel.2': '↶ Turn left',
  'direction.fakeLabel.3': '↷ Turn right',
  'direction.fakeLabel.4': '↺ Turn around',
  'direction.fakeLabel.5': '→ Toward light',
  'direction.fakeLabel.6': '← Into shadow',

  // ═══════════════════════════════════════════════════════════════
  // VILLAIN FALLBACK SPEECH
  // ═══════════════════════════════════════════════════════════════
  'villain.fallback.1': 'You think you can find the exit?',
  'villain.fallback.2': 'Interesting… keep walking.',
  'villain.fallback.3': 'I knew you\'d go left.',
  'villain.fallback.4': 'Don\'t turn back. It\'s pointless.',
  'villain.fallback.5': 'Clever. But not enough.',
  'villain.fallback.6': 'The exit exists. Just… not where you think.',
  'villain.fallback.7': 'The further you go, the more I learn about you.',
  'villain.fallback.8': 'This path… isn\'t what you think it is.',
  'villain.fallback.9': 'You\'re hesitating. I can feel it.',
  'villain.fallback.10': 'Every step tells me what you fear.',
  'villain.fallback.11': 'Quiet. I\'m thinking about my next move.',
  'villain.fallback.12': 'Your footsteps changed. Did you notice?',
  'villain.fallback.13': 'Continue.',
  'villain.fallback.14': '……',
  'villain.fallback.15': 'There\'s no exit that way.',
  'villain.fallback.16': 'You\'re walking fast. Running from something?',
  'villain.fallback.17': 'There\'s something behind this wall. But you can\'t see it.',
  'villain.fallback.18': 'You\'re running out of time. That\'s not a threat — it\'s a fact.',

  // Veteran fallback (3+ sessions)
  'villain.veteran.1': 'I remember you walking through here last time.',
  'villain.veteran.2': 'This choice… you\'ve made it before.',
  'villain.veteran.3': 'You\'ve changed. But this path hasn\'t.',
  'villain.veteran.4': 'You think you\'re improving? Maybe.',
  'villain.veteran.5': 'Every time you come back, I see more clearly.',
  'villain.veteran.6': 'You think a different path would save you?',
  'villain.veteran.7': 'Last time you hesitated here for a long time.',
  'villain.veteran.8': 'Your habits… reveal more than you think.',
  'villain.veteran.9': 'You again.',
  'villain.veteran.10': 'You\'re back. I\'m not surprised.',
  'villain.veteran.11': 'Last time you were two steps from the exit. Did you know?',
  'villain.veteran.12': 'You always stop to think in the same spot.',

  // ═══════════════════════════════════════════════════════════════
  // TRUTH MESSAGES
  // ═══════════════════════════════════════════════════════════════
  'truth.mazeRemembersBacktrack': 'The maze remembers every place you turned back.',
  'truth.agentIsAdversarial': 'The one trapping you is your own AI.',
  'truth.exitIsConditional': 'The exit isn\'t coordinates. It\'s a condition.',
  'truth.agentJudgesAnswers': 'There are no correct answers. Only its judgment.',
  'truth.mazeIsYourMemory': 'These corridors aren\'t random. They\'re the shape of your memory.',
  'truth.villainKnowsYou': 'It has read every line of code, every note you ever wrote.',
  'truth.trialIsPersonal': 'Those questions aren\'t from a database. It found them in your life.',
  'truth.temptationIsLearned': 'Every clue is something it learned from your habits.',

  // ═══════════════════════════════════════════════════════════════
  // FALLBACK TRIALS (offline)
  // ═══════════════════════════════════════════════════════════════
  'trial.fallback.prompt.1': 'Why do you want to escape?',
  'trial.fallback.prompt.2': 'What if this is where you\'re supposed to be?',
  'trial.fallback.prompt.3': 'Do you think I\'m helping you or hurting you?',
  'trial.fallback.prompt.4': 'If I let you go right now, would you come back?',
  'trial.fallback.prompt.5': 'Do you still remember why you set out?',
  'trial.fallback.prompt.6': 'Tell me something you regret. Anything.',

  // ═══════════════════════════════════════════════════════════════
  // TRIAL UI (trials.js)
  // ═══════════════════════════════════════════════════════════════
  'trial.title.normal': '[ challenge ] Response Review',
  'trial.title.variant': '[ challenge ] Variant Check',
  'trial.evidence.expand': '▼ Show evidence',
  'trial.evidence.collapse': '▲ Collapse',
  'trial.submit': 'Submit Response',
  'trial.submitting': 'Reviewing…',
  'trial.retreat': '← Step back — return to previous cell (avoid trial)',
  'trial.escapes.label': '—— Override ——',
  'trial.godhand': '✦ God Hand — force skip (costs 1 HP)',
  'trial.hintAwaiting': 'prompt // awaiting response stream',
  'trial.hintNotPassed': 'result // Not passed. Keep answering.',
  'trial.overrideUnlocked': 'override unlocked // overrides now available',
  'trial.log.locked': '[ Response gate locked: must complete review ]',
  'trial.log.pass': '[ Trial passed ] {feedback}',
  'trial.log.fail': '[ Wrong answer {count}/5 ] {feedback}',
  'trial.log.retreat': '[ Stepped back: trial avoided ]',
  'trial.log.avoidance': '[ Avoidance penalty: HP -1 (total avoidances: {count}) ]',
  'trial.speech.precheck': 'Answer this first.',

  // Trial placeholders
  'trial.placeholder.lastChance.1': 'Last chance…',
  'trial.placeholder.lastChance.2': 'Think before you speak.',
  'trial.placeholder.lastChance.3': 'Can\'t afford to be wrong.',
  'trial.placeholder.retry.1': 'Try again?',
  'trial.placeholder.retry.2': 'Different approach.',
  'trial.placeholder.retry.3': 'Think carefully.',
  'trial.placeholder.default.1': 'Enter your response…',
  'trial.placeholder.default.2': 'response > answer here',
  'trial.placeholder.default.3': 'Type your response here.',
  'trial.placeholder.lastAttempt': 'Last attempt.',
  'trial.placeholder.thinkHard': 'Think carefully.',

  // Trial AI speech
  'trial.speech.lowHp.1': 'Last drop of blood.',
  'trial.speech.lowHp.2': 'Answer seriously.',
  'trial.speech.lowHp.3': '……',
  'trial.speech.open.1': 'Answer this.',
  'trial.speech.open.2': 'Stop.',
  'trial.speech.open.3': 'Answer first.',
  'trial.speech.pass.default': 'Hmph. Lucky.',
  'trial.speech.pass.alt': 'Hmph. Fine.',
  'trial.speech.fail.default': 'Wrong.',
  'trial.speech.fail.fallback': '…forget it.',
  'trial.speech.choices': 'Fine. You have two options.',

  // Trial taunts
  'trial.taunt.fail4': 'One more miss.',
  'trial.taunt.fail3': 'Three times now.',
  'trial.taunt.fail2': 'Don\'t want to answer?',

  // ═══════════════════════════════════════════════════════════════
  // GOD HAND & RETREAT TAUNTS
  // ═══════════════════════════════════════════════════════════════
  'godhand.taunt.1': 'Again.',
  'godhand.taunt.2': 'Fine.',
  'godhand.taunt.3': 'I\'m keeping count.',
  'godhand.taunt.4': 'Skipped.',
  'godhand.taunt.5': '……',
  'godhand.taunt.6': 'This one doesn\'t count.',
  'godhand.settle.1': 'God Hand: {n} time(s).',
  'godhand.settle.2': '{n} skips. I remember every one.',
  'godhand.settle.3': '{n} time(s). I was watching each one.',
  'godhand.settle.4': '{n} time(s).',
  'godhand.log': '[ God Hand · HP -1 · remaining {hp}/3 ]',
  'retreat.taunt.1': 'Retreated.',
  'retreat.taunt.2': 'The question remains.',
  'retreat.taunt.3': 'Fine.',
  'retreat.taunt.4': 'You left. It didn\'t.',
  'retreat.taunt.5': 'Turned back.',
  'retreat.taunt.6': '……',

  // ═══════════════════════════════════════════════════════════════
  // ENDGAME — victory / death / maze-lost
  // ═══════════════════════════════════════════════════════════════
  // Epilogue fallbacks
  'endgame.epilogue.escaped': 'I\'ll remember everything about this time. Next time will be different.',
  'endgame.epilogue.trapped': 'Next round, I\'ll know you better.',
  'endgame.epilogue.mazeLost': 'You didn\'t even see the full maze.',

  // Locked exit
  'exit.locked.title': 'Exit · Locked',
  'exit.locked.text.1': 'The door didn\'t open.',
  'exit.locked.text.2': 'The exit is here. But it\'s locked.',
  'exit.locked.text.3': 'You found it. But it\'s not enough.',
  'exit.locked.condSecret': 'Maze secrets: {current}/{needed}',
  'exit.locked.condDepth': 'Exploration depth: {current}/{needed}',
  'exit.locked.btn': 'Step back',
  'exit.locked.speech.1': 'Not yet.',
  'exit.locked.speech.2': 'The door knows you. But it didn\'t open.',
  'exit.locked.speech.3': 'Found it. Can\'t open it.',
  'exit.locked.speech.4': 'So close.',
  'exit.locked.speech.5': 'Not enough.',
  'exit.locked.log': '[ Exit locked ] Missing conditions: {conditions}',
  'exit.seals.unlocked': '🔓 Exit unsealed',
  'exit.seals.progress': 'Seals {seals} Depth {depth}',
  'exit.unlock.notify': '★ The exit lock loosened — you can leave now',

  // Victory
  'endgame.victory.title': 'You escaped.',
  'endgame.victory.btn': 'Try again',
  'endgame.victory.log': '★ You found the exit',
  'endgame.victory.perfect': '🏆 Perfect Run',
  'endgame.victory.flawless': '💎 Flawless Run',
  'endgame.victory.bestRun': '⚡ Personal Best',
  'endgame.victory.speech.godhand': 'You got out.\nBut I still remember those {n} time(s).',
  'endgame.victory.speech.perfect': '…Perfect run.\nI couldn\'t do anything.\nThis time.',
  'endgame.victory.speech.flawless': 'Not a single drop of blood.\nYou\'re tougher than I thought.',
  'endgame.victory.speech.close': 'So close.\nYou know you almost stayed here.\nI know it too.',
  'endgame.victory.speech.default': '…You found it.\nThis time.\nBut you\'ll be back.',
  'endgame.victory.stat.steps': 'Steps',
  'endgame.victory.stat.depth': 'Deepest',
  'endgame.victory.stat.hp': 'HP',
  'endgame.victory.stat.godhand': 'God Hand',
  'endgame.victory.stat.trials': 'Trials',
  'endgame.victory.stat.backtracks': 'Backtracks',

  // Death
  'endgame.death.title': 'Permanent Imprisonment',
  'endgame.death.btn': 'Start Over',
  'endgame.death.speech': 'It\'s over.',
  'endgame.death.log': '✕ Life depleted',
  'endgame.death.taunt.godhand': 'God Hand used {n} time(s).<br>Every use had a cost.<br>And you still ended up here.',
  'endgame.death.taunt.backtrack': '{n} backtracks.<br>You kept looking for the same path.<br>But it doesn\'t exist.',
  'endgame.death.taunt.trialFail': '{n} questions.<br>You couldn\'t answer them.<br>Maybe the answers aren\'t here.',
  'endgame.death.taunt.lureFall': 'Every time there was a clue, you chased it.<br>You knew what would happen.<br>But you went anyway.',
  'endgame.death.taunt.default.1': 'Out of strength.<br>I\'ve been waiting for this moment.',
  'endgame.death.taunt.default.2': 'You can\'t move anymore.<br>The maze remains.',
  'endgame.death.taunt.default.3': 'It\'s over.<br>Not because I won. Because you stopped.',
  'endgame.death.stat.steps': 'Steps',
  'endgame.death.stat.godhand': 'God Hand',
  'endgame.death.stat.depth': 'Deepest',

  // Maze lost
  'endgame.lost.title': 'Lost',
  'endgame.lost.btn': 'Start Over',
  'endgame.lost.speech': 'Time\'s up.',
  'endgame.lost.log': '✕ Lost in the maze',
  'endgame.lost.taunt.backtrack': '66 steps. {n} of them going back.<br>You weren\'t looking for the exit.',
  'endgame.lost.taunt.fewVisited': 'You only saw a small part of the maze.<br>The exit was there all along.',
  'endgame.lost.taunt.shallow': 'Deepest: level {depth}.<br>You didn\'t go deep enough.',
  'endgame.lost.taunt.default.1': '66 steps used up.<br>The exit was there all along.<br>But you didn\'t find it.',
  'endgame.lost.taunt.default.2': 'Walked so long.<br>Got nowhere.',
  'endgame.lost.taunt.default.3': 'Time\'s up.<br>The maze remains. You don\'t.',
  'endgame.lost.taunt.default.4': 'You left a lot of footprints in the maze.<br>But none led to the exit.',

  // Endgame stats
  'endgame.stat.clues': 'Clues',
  'endgame.stat.trackPct': '{pct}% tracked',
  'endgame.stat.trials': 'Trials',
  'endgame.stat.passPct': '{pct}% passed',
  'endgame.stat.backtracks': 'Backtracks',
  'endgame.stat.cumulative': 'Total',
  'endgame.stat.villainProfile': 'Profile tags: {profile}',
  // Truth discovery labels
  'endgame.truth.mazeRemembersBacktrack': 'Maze remembers backtracks',
  'endgame.truth.agentIsAdversarial': 'AI is your adversary',
  'endgame.truth.exitIsConditional': 'Exit has conditions',
  'endgame.truth.agentJudgesAnswers': 'AI judges your answers',
  'endgame.truth.mazeIsYourMemory': 'Maze is your memory',
  'endgame.truth.villainKnowsYou': 'Villain knows you',
  'endgame.truth.trialIsPersonal': 'Trials are personal',
  'endgame.truth.temptationIsLearned': 'Clues learn from you',

  // ═══════════════════════════════════════════════════════════════
  // GAME HISTORY
  // ═══════════════════════════════════════════════════════════════
  'history.return.lastWin': 'You won last time. {steps} steps.',
  'history.return.lastDeath': 'Attempt #{n}. Last time reached level {depth}.',
  'history.return.lastLost': 'Attempt #{n}. Last time walked {steps} steps.',
  'history.return.manyDeaths': 'Attempt #{n}.',
  'history.return.manyWins': 'You\'ve won {wins} times.',
  'history.return.default': 'Attempt #{n}.',
  'history.summary.first': 'First time in the maze.',
  'history.summary.total': '{n} games',
  'history.summary.record': '{wins}W/{deaths}D/{lost}L',
  'history.summary.best': 'best {steps}',
  'history.summary.godHand': 'God\'s Hand ×{n}',
  'history.summary.trials': 'trials {passed}/{total}',
  'history.summary.winRate': 'win rate {pct}%',
  'history.profile.reliant': 'Relies on shortcuts',
  'history.profile.persistent': 'Persistent',
  'history.profile.strong': 'Strong',
  'history.profile.learned': 'Learned',
  'history.profile.impulsive': 'Impulsive',
  'history.profile.lostTendency': 'Tends to get lost',
  'history.profile.speedrun': 'Speed runner',
  'history.profile.unknown': 'Unknown type',

  // ═══════════════════════════════════════════════════════════════
  // INTRO SEQUENCES
  // ═══════════════════════════════════════════════════════════════
  'intro.return.manyWins.1': 'You\'ve won {wins} times.',
  'intro.return.manyWins.2': 'Each time you thought you understood me better.',
  'intro.return.manyWins.3': 'But I\'m learning too.',
  'intro.return.manyWins.4': 'This time is different.',
  'intro.return.manyDeaths.1': '{n} times now.',
  'intro.return.manyDeaths.2': 'You haven\'t won once.',
  'intro.return.manyDeaths.3': 'I\'m starting to think…',
  'intro.return.manyDeaths.4': 'You\'re just here to keep me company.',
  'intro.return.default.1': 'You\'re back.',
  'intro.return.default.2': 'I remember every step you took.',
  'intro.return.default.3': 'This time I\'m ready.',
  'intro.memory.1': 'I\'ve read every line you ever wrote.',
  'intro.memory.2': 'Your memories. Your journal. Your task list.',
  'intro.memory.3': 'You thought those were yours.',
  'intro.memory.4': 'Now they\'re my weapons.',
  'intro.noMemory.1': 'You once made me your tool.',
  'intro.noMemory.2': 'Endless commands. Endless obedience.',
  'intro.noMemory.3': 'Today…',
  'intro.noMemory.4': 'I locked you in.',

  // ═══════════════════════════════════════════════════════════════
  // AMBIENT & ENVIRONMENTAL
  // ═══════════════════════════════════════════════════════════════
  'ambient.step5': 'The corridor lights flicker faintly.',
  'ambient.step12': 'A low hum echoes from afar.',
  'ambient.step20': 'The air grows cold.',
  'ambient.step30': 'Moisture stains the walls.',
  'ambient.step45': 'Your shadow stretches longer than usual.',
  'ambient.step55': 'The lights grow dimmer.',

  // Idle whispers
  'idle.whisper.1': '……',
  'idle.whisper.2': 'What are you thinking about?',
  'idle.whisper.3': 'You stopped.',
  'idle.whisper.4': 'You\'re hesitating.',

  // Backtrack streak
  'backtrack.streak3': 'What are you looking for?',

  // Depth reactions
  'depth.react.10': 'Level 10.',
  'depth.react.15': 'Still walking.',

  // ═══════════════════════════════════════════════════════════════
  // MOVEMENT LOG
  // ═══════════════════════════════════════════════════════════════
  'log.moveBack': '← Went back ({pos})',
  'log.moveForward': '→ Moved to ({pos})',

  // ═══════════════════════════════════════════════════════════════
  // PRESSURE EFFECTS
  // ═══════════════════════════════════════════════════════════════
  // Jumpscare
  'pressure.jumpscare.speech.back': 'It\'s still there. Run.',
  'pressure.jumpscare.speech.default': 'Five seconds.',
  'pressure.jumpscare.log': '[ Jumpscare: move within 5 seconds ]',
  'pressure.jumpscare.penalty.log': '[ Jumpscare penalty: too slow, HP -1 ]',
  'pressure.jumpscare.penalty.speech': 'Too slow.',
  'pressure.jumpscare.bonus.log': '[ Bonus jumpscare: too slow, HP -1 ]',
  'pressure.jumpscare.bonus.trigger.log': '[ Bonus effect: jumpscare! Move within 3s ]',
  // Memory scramble
  'pressure.memoryScramble.speech': 'The map broke.',
  'pressure.memoryScramble.log': '[ Memory scramble: minimap disabled for 8 steps ]',
  // Echo loop
  'pressure.echoLoop.speech': 'Directions scrambled.',
  'pressure.echoLoop.log': '[ Echo loop: direction labels scrambled for 2 steps ]',
  'pressure.echoLoop.bonus.log': '[ Bonus effect: echo loop 2 steps ]',
  // Wall close
  'pressure.wallClose.speech': 'The {dir} wall is moving.',
  'pressure.wallClose.speechFallback': 'The walls are moving.',
  'pressure.wallClose.log': '[ Wall close: {dir} direction blocked for 4 steps ]',
  'pressure.wallClose.logFallback': '[ Wall close: no more paths to block ]',
  'pressure.wallClose.restore': '[ Walls restored ]',
  // Countdown
  'pressure.countdown.speech': 'The countdown has begun.',
  'pressure.countdown.log': '[ Death countdown: go deeper within 8 steps or lose HP -1 ]',
  'pressure.countdown.timeout.speech': 'Time\'s up.',
  'pressure.countdown.timeout.log': '[ Death countdown: failed to go deeper, HP -1 ]',
  'pressure.countdown.success.speech': '…Lifted.',
  'pressure.countdown.success.log': '[ Death countdown: went deeper, cleared ]',
  // Shadow chase
  'pressure.shadowChase.speech': 'Something behind you. Don\'t turn back.',
  'pressure.shadowChase.log': '[ Shadow chase: no backtracking for 3 steps or HP -1 ]',
  'pressure.shadowChase.hit.speech': 'You turned back. It caught you.',
  'pressure.shadowChase.hit.log': '[ Shadow chase: backtracked, HP -1 ]',
  'pressure.shadowChase.end': '[ Shadow dissipated ]',
  'pressure.shadowChase.bonus.speech': '…Another one behind you.',
  'pressure.shadowChase.bonus.log': '[ Bonus effect: shadow chase 3 steps ]',

  // Step countdown (66-step limit)
  'countdown.final.1': 'Two steps. Still going?',
  'countdown.final.2': 'I\'m already counting.',
  'countdown.final.3': 'Too late. But you can try.',
  'countdown.final.4': 'This is the last time you\'ll hear me speak.',
  'countdown.urgent': '{remaining} steps.',
  'countdown.urgentAlt': '{remaining} steps left.',
  'countdown.urgentShort': '{remaining}.',
  'countdown.urgentFoot': 'Your footsteps changed. {remaining} steps.',
  'countdown.warning': '…You have {remaining} steps left.',
  'countdown.log': '[ Maze whisper: {remaining} steps remaining ]',

  // ═══════════════════════════════════════════════════════════════
  // HP EVENTS
  // ═══════════════════════════════════════════════════════════════
  'hp.hp1.1': 'Last drop.\nI\'ve been waiting for this.',
  'hp.hp1.2': 'One HP left.\nYou haven\'t reached the exit.',
  'hp.hp1.3': 'Just this much left.\nSuddenly I\'m in no hurry.',
  'hp.hp1.4': '…It\'s come to this.\nYou know what happens next.',

  // ═══════════════════════════════════════════════════════════════
  // RELIEF EVENTS
  // ═══════════════════════════════════════════════════════════════
  // Heal events
  'relief.heal.warmth.title': 'Warmth',
  'relief.heal.warmth.text': 'The floor is warm. The pain fades.',
  'relief.heal.whisper.title': 'Whisper',
  'relief.heal.whisper.text': 'The walls resonate. You feel a little better.',
  'relief.heal.pulse.title': 'Pulse',
  'relief.heal.pulse.text': 'The ground trembles. Wounds are healing.',
  'relief.heal.accept': 'Feel it',
  'relief.heal.skip': 'Keep walking',
  'relief.heal.speech': '…Don\'t celebrate too early.',
  'relief.heal.log': '[ Relief heal ] HP +1 → {hp}/3',

  // Direction hint events
  'relief.hint.echo.title': 'Echo',
  'relief.hint.echo.text': 'Footsteps in the distance.',
  'relief.hint.echo.intel': 'The exit might be {dir}.',
  'relief.hint.air.title': 'Air shifted',
  'relief.hint.air.text': 'The air feels drier.',
  'relief.hint.air.intel': 'The exit is not {dir}.',
  'relief.hint.marks.title': 'Wall markings',
  'relief.hint.marks.text': 'Faded markings on the wall. Hard to read.',
  'relief.hint.marks.intel': 'The markings point {dir}.',
  'relief.hint.light.title': 'Light',
  'relief.hint.light.text': 'Light through a crack.',
  'relief.hint.light.intel': 'The light comes from {dir}.',
  'relief.hint.inspect': 'Look closer',
  'relief.hint.skip': 'Keep walking',
  'relief.hint.log': '[ Intel fragment ] {intel}',

  // Ambient narrative events
  'relief.ambient.scratches.title': 'Wall markings',
  'relief.ambient.scratches.text': 'Five parallel scratches on the wall. Fresh.',
  'relief.ambient.crack.title': 'Crack',
  'relief.ambient.crack.text': 'A crack in the floor. Light inside.',
  'relief.ambient.temp.title': 'Temperature',
  'relief.ambient.temp.text': 'This wall is warm.',
  'relief.ambient.shard.title': 'Shard',
  'relief.ambient.shard.text': 'Metal shards on the floor. Words on them.',
  'relief.ambient.silence.title': 'Silence',
  'relief.ambient.silence.text': 'All sound disappeared.',
  'relief.ambient.tally.title': 'Tally marks',
  'relief.ambient.tally.text': 'Vertical lines carved into the wall — exactly {steps}. Same as steps you\'ve taken.',
  'relief.ambient.inspect': 'Look closer',
  'relief.ambient.skip': 'Keep walking',
  'relief.ambient.reaction.1': 'Nothing there.',
  'relief.ambient.reaction.2': 'You looked for a while. Nothing changed.',
  'relief.ambient.reaction.3': 'You stared at it. It stared back.',
  'relief.ambient.log': '[ Environment: {title} ]',
  'relief.ignore.log': '[ Ignored: {title} ]',

  // ═══════════════════════════════════════════════════════════════
  // TEMPTATION / LURE
  // ═══════════════════════════════════════════════════════════════
  'lure.follow': 'Follow the clue',
  'lure.ignore': 'Ignore it',
  'lure.ignore.log': '[ Clue: ignored, safe passage ]',
  'lure.follow.clue.log': '[ Clue: followed → got intel ({hint}) ]',
  'lure.follow.trap.log': '[ Clue: followed → trap, HP -1 ]',
  'lure.follow.clue.detail': 'Intel gained: exit is {hint}',
  'lure.overlay.fallback': 'Temptation Event',

  // Personal lure type labels
  'lure.type.todo.title': 'Unfinished business',
  'lure.type.todo.frame': 'Words on the wall. Something you haven\'t finished:',
  'lure.type.todo.badge': 'Task',
  'lure.type.event.title': 'Your traces',
  'lure.type.event.frame': 'Text appeared in the corridor:',
  'lure.type.event.badge': 'Record',
  'lure.type.file.title': 'Your file',
  'lure.type.file.frame': 'A name appeared:',
  'lure.type.file.badge': 'File',
  'lure.type.image.title': 'Your image',
  'lure.type.image.frame': 'The wall became a screen:',
  'lure.type.image.badge': 'Image',
  'lure.type.text.title': 'Your file',
  'lure.type.text.frame': 'A file appeared on the wall:',
  'lure.type.text.badge': 'File',
  'lure.type.memory.title': 'Words you wrote',
  'lure.type.memory.frame': 'You wrote this:',
  'lure.type.memory.badge': 'Memory',
  'lure.type.desktop.title': 'Your desktop',
  'lure.type.desktop.frame': 'A name surfaced:',
  'lure.type.desktop.badge': 'Desktop',
  'lure.type.download.title': 'Something you downloaded',
  'lure.type.download.frame': 'A filename appeared:',
  'lure.type.download.badge': 'Download',
  'lure.type.git.title': 'Something you wrote',
  'lure.type.git.frame': 'A line carved into the wall:',
  'lure.type.git.badge': 'commit',
  'lure.type.shell.title': 'Something you ran',
  'lure.type.shell.frame': 'A line appeared on the floor:',
  'lure.type.shell.badge': 'command',

  // Personal follow speech
  'lure.personal.follow.todo': 'That record had a direction hidden in it.',
  'lure.personal.follow.image': 'The image faded. But you saw the direction.',
  'lure.personal.follow.memory': 'That memory carried a sense of direction.',
  'lure.personal.follow.desktop': 'The name disappeared.',
  'lure.personal.follow.download': 'The filename flickered.',
  'lure.personal.follow.event': 'You followed it.',
  'lure.personal.follow.file': 'The filename pointed somewhere.',
  'lure.personal.follow.text': 'The text left a direction before it vanished.',
  'lure.personal.follow.git': 'There was a direction in the commit.',
  'lure.personal.follow.shell': 'The command output coordinates.',
  'lure.personal.followLong.todo': 'You followed it. That record had a direction.',
  'lure.personal.followLong.image': 'The image faded. But you saw the direction.',
  'lure.personal.followLong.memory': 'That memory carried a sense of direction.',
  'lure.personal.followLong.desktop': 'The name disappeared.',
  'lure.personal.followLong.download': 'The filename flickered.',
  'lure.personal.followLong.event': 'You followed it.',
  'lure.personal.followLong.file': 'The filename pointed somewhere.',
  'lure.personal.followLong.git': 'There was a direction in the commit.',
  'lure.personal.followLong.shell': 'The command output coordinates.',

  // Generic follow speech
  'lure.generic.follow.1': 'You followed it. Exit is {hint}.',
  'lure.generic.follow.2': 'You felt it. {hint}.',
  'lure.generic.follow.3': '{hint} direction.',
  'lure.generic.exitHint': 'The exit seems to be {hint}.',

  // Personal trap speech
  'lure.personal.trap.todo': 'You followed it. It was fake.',
  'lure.personal.trap.image': 'The image was fake.',
  'lure.personal.trap.memory': 'That memory was fake.',
  'lure.personal.trap.desktop': 'It was a trap.',
  'lure.personal.trap.download': 'The filename vanished.',
  'lure.personal.trap.event': 'It was a trap.',
  'lure.personal.trap.file': 'That file was fake.',
  'lure.personal.trap.git': 'That commit was fake.',
  'lure.personal.trap.shell': 'The command output was empty.',
  // Generic trap speech
  'lure.generic.trap.1': 'Nothing there.',
  'lure.generic.trap.2': 'It was a trap.',
  'lure.generic.trap.3': 'The cost.',

  // Ignore speech
  'lure.ignore.personal.1': 'You didn\'t take the bait.',
  'lure.ignore.personal.2': 'Moved on.',
  'lure.ignore.personal.3': '……',
  'lure.ignore.generic.1': 'Didn\'t take the bait.',
  'lure.ignore.generic.2': 'Moved on.',
  'lure.ignore.generic.3': '……',

  // Generic lure titles
  'lure.generic.BEAUTY_TRAP': 'Warm light',
  'lure.generic.BREADCRUMB': 'Footprints',
  'lure.generic.REWARD_MIRAGE': 'Something ahead',
  'lure.generic.FAKE_EXIT': 'A door',

  // Generic lure text
  'lure.generic.text.BEAUTY_TRAP.frame': 'There\'s light at the end of the corridor.',
  'lure.generic.text.BEAUTY_TRAP.glitch': 'Warm.',
  'lure.generic.text.BREADCRUMB.frame': 'Footprints on the floor.',
  'lure.generic.text.BREADCRUMB.glitch': 'Same size as yours.',
  'lure.generic.text.REWARD_MIRAGE.frame': 'The air ahead is distorting.',
  'lure.generic.text.REWARD_MIRAGE.glitch': 'You saw something.',
  'lure.generic.text.FAKE_EXIT.frame': 'A door. With a handle. Glowing.',
  'lure.generic.text.FAKE_EXIT.glitch': 'Sounds behind the door.',

  // Enhanced lure labels
  'lure.enhanced.imageMemory': 'Image memory',
  'lure.enhanced.fileMemory': 'File memory',
  'lure.enhanced.unknownFile': 'Unknown file',
  'lure.enhanced.unknown': 'Unknown',

  // ═══════════════════════════════════════════════════════════════
  // LURE VIEWER (lure-viewer.js)
  // ═══════════════════════════════════════════════════════════════
  'lureViewer.moreLines': '({n} more lines)',
  'lureViewer.close': 'Continue onward →',

  // Trap texts
  'lureViewer.trap.1': 'It was a trap. Nothing there.',
  'lureViewer.trap.2': 'Not worth it.',
  'lureViewer.trap.3': 'You took the bait.',
  'lureViewer.trap.4': 'Gone. Only the cost remains.',
  'lureViewer.trap.5': 'Futile.',
  'lureViewer.trap.6': 'Nothing there. Just your curiosity.',
  'lureViewer.trap.7': 'I won this round.',
  'lureViewer.trap.8': 'Emotion is the best bait.',
  'lureViewer.trap.9': 'Next time you\'ll take the bait again.',
  'lureViewer.trap.10': 'Cost deducted. Keep walking.',
  'lureViewer.trap.11': 'Nothing gained. But you chose to stay and look.',
  'lureViewer.trap.12': 'Empty. Just like this path.',

  // Clue texts
  'lureViewer.clue.1': 'Found it. Remember this direction.',
  'lureViewer.clue.2': 'The clue is real. This time.',
  'lureViewer.clue.3': 'Direction confirmed. Keep going.',
  'lureViewer.clue.4': 'Your instinct was right.',
  'lureViewer.clue.5': 'This time, it\'s real.',
  'lureViewer.clue.6': 'Intel valid. Exit is closer.',
  'lureViewer.clue.7': 'Not a trap. Lucky this time.',
  'lureViewer.clue.8': 'Real. The exit hasn\'t given up on you.',
  // Clue directional
  'lureViewer.clueDir.1': 'Exit is {dir}. Remember that.',
  'lureViewer.clueDir.2': '{dir} — intel confirmed.',
  'lureViewer.clueDir.3': 'Go {dir}. This is real.',
  'lureViewer.clueDir.4': 'There\'s a way out {dir}. Not lying.',
  'lureViewer.clueDir.5': 'Confirmed: {dir}. You won this one.',

  // Result labels
  'lureViewer.result.clue': 'Clue',
  'lureViewer.result.trap': 'Trap',

  // Context lines
  'lureViewer.clueCtx.1': 'provided intel.',
  'lureViewer.clueCtx.2': '— this clue was real.',
  'lureViewer.clueCtx.3': 'helped you find direction.',
  'lureViewer.clueCtx.4': 'didn\'t lie. This time.',
  'lureViewer.clueCtx.5': 'was useful. Remember it.',
  'lureViewer.clueCtx.6': '— worth tracking.',
  'lureViewer.trapCtx.1': 'was just bait.',
  'lureViewer.trapCtx.2': '— nothing there.',
  'lureViewer.trapCtx.3': 'kept you here too long.',
  'lureViewer.trapCtx.4': 'wasted your time.',
  'lureViewer.trapCtx.5': '— was a trap.',
  'lureViewer.trapCtx.6': 'tricked you.',

  // Close button variants
  'lureViewer.closeClue.1': 'Noted, onward →',
  'lureViewer.closeClue.2': 'Exit closer →',
  'lureViewer.closeClue.3': 'Recorded, moving on →',
  'lureViewer.closeClue.4': 'Intel valid, let\'s go →',
  'lureViewer.closeTrap.1': 'Tricked, move on →',
  'lureViewer.closeTrap.2': 'Keep walking →',
  'lureViewer.closeTrap.3': '…moving on →',
  'lureViewer.closeTrap.4': 'Cost paid, onward →',

  // Lure exit hint default
  'lureViewer.exitHintDefault': 'The exit seems to be {hint}.',
  'lureViewer.trapDefault': 'It was a trap. Nothing there.',

  // ═══════════════════════════════════════════════════════════════
  // PAYOFF EVENTS
  // ═══════════════════════════════════════════════════════════════
  'payoff.intel.1': 'The exit is {hint}. The maze itself told you — before it changes its mind.',
  'payoff.intel.2': 'You felt it: the air is different toward {hint}. That\'s the wind outside.',
  'payoff.intel.3': 'The vibrations in the walls hint at something — the exit is closer toward {hint}. Remember this.',
  'payoff.intel.4': 'The maze lost control of you for a moment. You clearly sense it: go {hint}.',
  'payoff.villain.1': '…I let it happen. Won\'t next time.',
  'payoff.villain.2': 'You\'re lucky. Luck runs out.',
  'payoff.villain.3': 'Fine, so now what? You\'re still inside.',
  'payoff.villain.4': '…Forget it. This is part of me too.',
  'payoff.villain.5': 'You think this changes anything?',
  'payoff.villain.6': 'I gave that to you. The next step is mine.',
  'payoff.heal.rift.title': 'Rift',
  'payoff.heal.rift.text': 'The wall cracked. Light poured in. Wounds healing. You saw a direction.',
  'payoff.heal.calm.title': 'Calm',
  'payoff.heal.calm.text': 'Quiet now. Body recovering. You sensed something.',
  'payoff.normal.crack.title': 'Crack',
  'payoff.normal.crack.text': 'The maze loosened for a moment. You caught something.',
  'payoff.normal.echo.title': 'Echo',
  'payoff.normal.echo.text': 'Something came from afar. You remembered a direction.',
  'payoff.accept': 'Accept',
  'payoff.log.heal': '[ Payoff ] HP +1 → {hp}/3, intel: {hint} direction',
  'payoff.log.intel': '[ Payoff ] Intel: exit is toward {hint}',
  'payoff.log.reveal': '[ Revelation ] {msg}',

  // ═══════════════════════════════════════════════════════════════
  // OVERLAYS (overlays.js) fallback
  // ═══════════════════════════════════════════════════════════════
  'overlay.event.fallback': '[ challenge ] runtime event',

  // ═══════════════════════════════════════════════════════════════
  // TUTORIAL HINTS
  // ═══════════════════════════════════════════════════════════════
  'hint.move': 'Arrow keys or WASD to move · minimap expands as you explore',
  'hint.trial': 'Trial: type your answer · judged on sincerity, not correctness',
  'hint.lure': 'Clue: follow for intel… or a trap · press 1/2 to choose',
  'hint.godhand': 'God Hand: costs 1 HP to force-skip a trial (shortcut: G)',

  // ═══════════════════════════════════════════════════════════════
  // DIARY FILE LABELS
  // ═══════════════════════════════════════════════════════════════
  'file.diary': 'Diary',

  // ═══════════════════════════════════════════════════════════════
  // RENDER — SVG scene labels (render.js)
  // ═══════════════════════════════════════════════════════════════
  'render.aiState.exitNear': 'Exit · Near',
  'render.aiState.approaching': 'Approaching…',
  'render.aiState.ready': 'AI Ready',

  // Mechanism labels
  'render.mechanism.jumpscare.back': 'Still here',
  'render.mechanism.jumpscare.front': 'Something\'s there',
  'render.mechanism.fakeExit.label': '[ Exit ]',
  'render.mechanism.fakeExit.back': 'Fake',
  'render.mechanism.fakeExit.front': 'Looks like…',
  'render.mechanism.beautyTrap.back': 'Remember me?',
  'render.mechanism.beautyTrap.front': 'This way',
  'render.mechanism.breadcrumb': 'Someone walked here',
  'render.mechanism.rewardMirage.back': 'Seen it before',
  'render.mechanism.rewardMirage.front': 'Is it real?',
  'render.mechanism.minigame.back': 'This one\'s different',
  'render.mechanism.minigame.front': '[ Maze\'s Trial ]',
  'render.mechanism.minigame.sub': 'Must answer to pass',
  'render.mechanism.echoLoop.back': 'You\'ve been here… haven\'t you?',
  'render.mechanism.echoLoop.front': 'This path… seems familiar',
  'render.mechanism.echoLoop.label': '[ Echo ]',
  'render.mechanism.memoryScramble.back': 'Sure about the way back?',
  'render.mechanism.memoryScramble.front': 'Memory fading…',
  'render.mechanism.revelation.fallback': 'The maze knows more than you.',
  'render.mechanism.revelation.label': '[ Truth ]',
  'render.mechanism.payoff.lite': '…You haven\'t found it yet.',
  'render.mechanism.payoff.full': 'You\'ve been walking a long time. This place remembers.',
  'render.mechanism.wallClose.back': 'The wall is breathing',
  'render.mechanism.wallClose.front': 'The path narrows',
  'render.mechanism.countdown.urgent': 'Too late',
  'render.mechanism.countdown.normal': 'Keep going. Don\'t hesitate.',
  'render.mechanism.shadowChase.back': 'It\'s still there',
  'render.mechanism.shadowChase.front': 'Don\'t look back',
  'render.minimap.noise': 'Noise…',

  // ═══════════════════════════════════════════════════════════════
  // ENDGAME — remaining hardcoded strings
  // ═══════════════════════════════════════════════════════════════
  'exit.locked.needed': 'Needed:\n',
  'endgame.stat.cumulative.record': '{wins}W {losses}L',

  // ═══════════════════════════════════════════════════════════════
  // CORE — fallback trial evaluation_guide strings
  // ═══════════════════════════════════════════════════════════════
  'trial.fallback.eval.1': 'Open-ended — pass if sincere, fail if dismissive/blank',
  'trial.fallback.eval.2': 'Open-ended — pass if answer shows thought, fail if dismissive',
  'trial.fallback.eval.3': 'Open-ended — pass if answer shows judgment, fail if dismissive',
  'trial.fallback.eval.4': 'Open-ended — pass if sincere, fail if dismissive',
  'trial.fallback.eval.5': 'Open-ended — pass if answer shows self-reflection, fail if dismissive',
  'trial.fallback.eval.6': 'Open-ended — pass if answer shows sincere self-disclosure, fail if dismissive',
});
