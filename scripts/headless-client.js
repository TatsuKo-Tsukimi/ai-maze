'use strict';
/**
 * CLAWTRAP Headless Player Client
 * ================================
 * Calls the REAL game server HTTP API for villain interactions.
 * Client-side: maze gen, Director Deck, game state (mirrors real frontend).
 * Server-side: villain speech, trial generation, trial judgment, epilogue.
 *
 * Usage: node headless-client.js [port] [seed]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2]) || 3000;
const BASE = `http://127.0.0.1:${PORT}`;
const SEED = parseInt(process.argv[3]) || 42;

// ── Seeded RNG ──────────────────────────────────────────────
let _seed = SEED;
function rng() { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; }
function rngInt(min, max) { return min + Math.floor(rng() * (max - min + 1)); }
function rngPick(arr) { return arr[Math.floor(rng() * arr.length)]; }

// ── HTTP helper ─────────────────────────────────────────────
function post(endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(endpoint, BASE);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end(data);
  });
}

// ═══════════════════════════════════════════════════════════
// MAZE GENERATION — identical DFS to js/core.js
// ═══════════════════════════════════════════════════════════
const GRID_W = 21, GRID_H = 27;
const CELL_WALL = 0, CELL_PATH = 1, CELL_EXIT = 2;

function generateMaze() {
  const maze = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(CELL_WALL));
  const stack = [{ x: 1, y: 1 }];
  maze[1][1] = CELL_PATH;
  while (stack.length > 0) {
    const { x, y } = stack[stack.length - 1];
    const dirs = [
      { dx: 0, dy: -2 }, { dx: 0, dy: 2 }, { dx: -2, dy: 0 }, { dx: 2, dy: 0 },
    ].filter(d => {
      const nx = x + d.dx, ny = y + d.dy;
      return nx > 0 && nx < GRID_W - 1 && ny > 0 && ny < GRID_H - 1 && maze[ny][nx] === CELL_WALL;
    });
    if (dirs.length === 0) { stack.pop(); continue; }
    const d = dirs[Math.floor(rng() * dirs.length)];
    maze[y + d.dy / 2][x + d.dx / 2] = CELL_PATH;
    maze[y + d.dy][x + d.dx] = CELL_PATH;
    stack.push({ x: x + d.dx, y: y + d.dy });
  }
  let exitX = GRID_W - 2, exitY = GRID_H - 2;
  if (maze[exitY][exitX] === CELL_WALL) {
    outer: for (let dy = 0; dy < GRID_H; dy++)
      for (let dx = 0; dx < GRID_W; dx++) {
        const ty = GRID_H - 1 - dy, tx = GRID_W - 1 - dx;
        if (maze[ty][tx] === CELL_PATH) { exitX = tx; exitY = ty; break outer; }
      }
  }
  maze[exitY][exitX] = CELL_EXIT;
  return { maze, start: { x: 1, y: 1 }, exit: { x: exitX, y: exitY } };
}

function getNeighbors(maze, x, y) {
  return [[0,-1,'N'],[0,1,'S'],[-1,0,'W'],[1,0,'E']]
    .map(([dx,dy,dir]) => ({ x: x+dx, y: y+dy, dx, dy, dir }))
    .filter(n => n.x >= 0 && n.x < GRID_W && n.y >= 0 && n.y < GRID_H && maze[n.y][n.x] !== CELL_WALL);
}

function bfs(maze, start, end) {
  const key = (x,y) => `${x},${y}`;
  const q = [{ ...start, path: [{ ...start }] }];
  const visited = new Set([key(start.x, start.y)]);
  while (q.length > 0) {
    const { x, y, path: p } = q.shift();
    if (x === end.x && y === end.y) return p;
    for (const n of getNeighbors(maze, x, y)) {
      const k = key(n.x, n.y);
      if (visited.has(k)) continue;
      visited.add(k);
      q.push({ x: n.x, y: n.y, path: [...p, { x: n.x, y: n.y }] });
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// DIRECTOR DECK — exact copy from js/core.js
// ═══════════════════════════════════════════════════════════
const DIRECTOR_DECK = [
  { role:'relief',     dealer:'EMPTY' },
  { role:'temptation', dealer:'BREADCRUMB' },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium',  anchor:true },
  { role:'pressure',   dealer:'JUMPSCARE' },
  { role:'truth',      dealer:'REVELATION', flag:'mazeRemembersBacktrack', anchor:true },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium' },
  { role:'temptation', dealer:'BEAUTY_TRAP' },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium',  anchor:true },
  { role:'pressure',   dealer:'WALL_CLOSE' },
  { role:'relief',     dealer:'EMPTY',      anchor:true },
  { role:'temptation', dealer:'REWARD_MIRAGE' },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium' },
  { role:'pressure',   dealer:'SHADOW_CHASE' },
  { role:'truth',      dealer:'REVELATION', flag:'agentIsAdversarial' },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium', anchor:true },
  { role:'relief',     dealer:'EMPTY' },
  { role:'temptation', dealer:'FAKE_EXIT' },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium' },
  { role:'pressure',   dealer:'COUNTDOWN' },
  { role:'payoff',     dealer:'PAYOFF',     lite:true, anchor:true },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'hard' },
  { role:'pressure',   dealer:'MEMORY_SCRAMBLE' },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'hard',  anchor:true },
  { role:'truth',      dealer:'REVELATION', flag:'exitIsConditional' },
  { role:'temptation', dealer:'FAKE_EXIT' },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'hard' },
  { role:'pressure',   dealer:'SHADOW_CHASE' },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'hard',  anchor:true },
  { role:'truth',      dealer:'REVELATION', flag:'agentJudgesAnswers' },
  { role:'relief',     dealer:'EMPTY',      anchor:true },
];

const ROLE_TO_TYPE = { relief:'calm', temptation:'lure', pressure:'blocker', trial:'drain', truth:'calm', payoff:'calm' };

function shouldSkipCard(card, deck) {
  if (card.role === 'truth' && card.flag && deck.knowledgeFlags[card.flag]) return true;
  if (card.role === 'trial' && deck.stepsSinceLastTrial < 7) return true;
  if (card.role === 'payoff' && !card.lite && !deck.knowledgeFlags.firstTrialDone) return true;
  return false;
}

function drawNextCard(deck) {
  let attempts = 0;
  while (attempts < DIRECTOR_DECK.length) {
    const card = DIRECTOR_DECK[deck.idx];
    deck.idx = (deck.idx + 1) % DIRECTOR_DECK.length;
    if (shouldSkipCard(card, deck)) { deck.skipCount++; attempts++; continue; }
    deck.skipCount = 0;
    return { ...card };
  }
  return { role: 'relief', dealer: 'EMPTY' };
}

// ═══════════════════════════════════════════════════════════
// PLAYER DECISIONS (from subagent)
// ═══════════════════════════════════════════════════════════
let playerData;
try {
  playerData = JSON.parse(fs.readFileSync(path.join(__dirname, 'player-decisions.json'), 'utf-8'));
} catch {
  playerData = { trial_answers: [], temptation_decisions: [], internal_monologue: {}, pressure_reactions: {} };
}

// ═══════════════════════════════════════════════════════════
// GAME STATE (mirrors js/core.js state)
// ═══════════════════════════════════════════════════════════
function createState(mazeData) {
  return {
    maze: mazeData.maze,
    playerPos: { ...mazeData.start },
    exitPos: { ...mazeData.exit },
    steps: 0, depth: 0, history: [],
    hp: 3, godHandCount: 0,
    mode: 'idle',
    effects: {
      echoLoopSteps: 0, memoryScrambleSteps: 0, wallCloseSteps: 0,
      shadowChaseSteps: 0, countdownSteps: 0, countdownStartDepth: 0,
    },
    deck: {
      idx: 0, skipCount: 0, stepsSinceLastTrial: 99,
      knowledgeFlags: {
        mazeRemembersBacktrack: false, agentIsAdversarial: false,
        exitIsConditional: false, agentJudgesAnswers: false, firstTrialDone: false,
      },
    },
    recentCards: [],
    _maxDepth: 0, _avoidanceCount: 0,
    trialCount: 0, trialPassCount: 0, trialFailCount: 0,
    backtrackCount: 0, visited: new Set(),
  };
}

const EXIT_CONDITIONS = { minKnowledgeFlags: 2, minDepth: 6 };
function countFlags(state) {
  return ['mazeRemembersBacktrack','agentIsAdversarial','exitIsConditional','agentJudgesAnswers']
    .filter(k => state.deck.knowledgeFlags[k]).length;
}
function isExitUnlocked(state) {
  return countFlags(state) >= EXIT_CONDITIONS.minKnowledgeFlags && state.depth >= EXIT_CONDITIONS.minDepth;
}

// ═══════════════════════════════════════════════════════════
// LOG
// ═══════════════════════════════════════════════════════════
const LOG = [];
const P = { system: '', villain: '[恶意AI] ', player: '[玩家] ', api: '[API] ' };
function log(type, msg) { LOG.push(`${P[type]||''}${msg}`); }

// ═══════════════════════════════════════════════════════════
// MAIN GAME LOOP
// ═══════════════════════════════════════════════════════════
async function main() {
  log('system', '═══════════════════════════════════════════════════');
  log('system', '  永久囚禁 · CLAWTRAP — 真实服务器联调模拟');
  log('system', `  Server: ${BASE}  |  Seed: ${SEED}`);
  log('system', '═══════════════════════════════════════════════════\n');

  // 1. Generate maze (client-side, same as frontend)
  const mazeData = generateMaze();
  const state = createState(mazeData);
  const shortPath = bfs(mazeData.maze, mazeData.start, mazeData.exit);

  log('system', `[BOOT] 迷宫: ${GRID_W}×${GRID_H}  起点(${mazeData.start.x},${mazeData.start.y})  出口(${mazeData.exit.x},${mazeData.exit.y})`);
  log('system', `[BOOT] 最短路径: ${shortPath ? shortPath.length : '?'} 步  |  HP: 3/3  |  上限: 66步`);
  log('system', `[BOOT] 出口条件: truth≥${EXIT_CONDITIONS.minKnowledgeFlags} + depth≥${EXIT_CONDITIONS.minDepth}\n`);

  // 2. POST /api/villain/start — initialize villain session
  let gameId = `sim_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  let villainSessionActive = false;
  try {
    const res = await post('/api/villain/start', { gameId });
    if (res.status === 200 && res.data.ok) {
      gameId = res.data.gameId;
      villainSessionActive = true;
      log('api', `villain/start → OK  gameId=${gameId}  crossGame=${res.data.hasCrossGameMemory}`);
    } else {
      log('api', `villain/start → ${res.status} (${typeof res.data === 'object' ? res.data.error || 'failed' : 'failed'}) — 使用 fallback 模式`);
    }
  } catch (e) {
    log('api', `villain/start → error: ${e.message} — 使用 fallback 模式`);
  }
  log('system', '');

  const mono = playerData.internal_monologue || {};
  log('player', `[内心] ${mono.game_start || '迷宫……开始了。'}\n`);

  // 3. Build navigation path with detours
  const navPath = buildNavPath(mazeData, shortPath);
  let trialIdx = 0, tempIdx = 0;
  let firstTrial = false, firstHpLoss = false;

  for (let mi = 0; mi < navPath.length && state.hp > 0 && state.steps < 66; mi++) {
    const target = navPath[mi];
    const prev = state.history.length > 0 ? state.history[state.history.length - 1] : null;
    const isBack = prev && prev.x === target.x && prev.y === target.y;

    // Update position (mirrors mechanics.js movePlayer)
    if (!isBack) { state.history.push({ ...state.playerPos }); }
    else { state.history.pop(); state.backtrackCount++; }
    state.playerPos = { ...target };
    state.steps++;
    state.depth = state.history.length;
    state.visited.add(`${target.x},${target.y}`);
    state.deck.stepsSinceLastTrial++;

    // Max depth tracking (mirrors mechanics.js)
    if (state.depth > state._maxDepth) state._maxDepth = state.depth;

    // Tick pressure effects (mirrors mechanics.js)
    tickEffects(state, isBack);
    if (state.hp <= 0) { log('system', `  ☠ 压力效果致死 HP=0`); break; }

    // Deal card from Director Deck (client-side, same as frontend)
    const card = drawNextCard(state.deck);
    const cardType = ROLE_TO_TYPE[card.role] || 'calm';
    state.recentCards.push(cardType);
    if (state.recentCards.length > 10) state.recentCards.shift();

    const dist = Math.abs(state.playerPos.x - state.exitPos.x) + Math.abs(state.playerPos.y - state.exitPos.y);
    const distLabel = dist <= 4 ? '极近' : dist <= 8 ? '近' : dist <= 16 ? '中' : '远';

    log('system', `── Step ${state.steps} ──  pos(${state.playerPos.x},${state.playerPos.y})  d=${state.depth}  HP=${state.hp}/3  exit=${distLabel}(${dist})  ${isBack ? '◄后退' : '►前进'}`);
    log('system', `  [Deck] role=${card.role}  dealer=${card.dealer}${card.difficulty ? ' '+card.difficulty : ''}${card.flag ? ' flag='+card.flag : ''}`);

    // ── GET VILLAIN SPEECH from real server ──
    try {
      const cardRes = await post('/api/card', {
        gameId, steps: state.steps, hp: state.hp, depth: state.depth,
        distance_to_exit_raw: dist,
        backtrack_ratio: state.backtrackCount / Math.max(1, state.steps),
        recent_cards: state.recentCards.slice(-6),
        forced_role: cardType,
      });
      if (cardRes.data?.speech_line) {
        log('villain', `  ${cardRes.data.speech_line}`);
        log('api', `  card → ${cardRes.data._agent || 'fallback'}  type=${cardRes.data.card_type}`);
      }
    } catch (e) {
      log('api', `  card → error: ${e.message}`);
    }

    // ── RESOLVE CARD MECHANICS (client-side, mirrors mechanics.js) ──
    await resolveCard(card, state, isBack, gameId, () => trialIdx, v => { trialIdx = v; },
      () => tempIdx, v => { tempIdx = v; },
      () => firstTrial, v => { firstTrial = v; },
      () => firstHpLoss, v => { firstHpLoss = v; }, mono);

    if (state.hp <= 0) break;

    // Check exit
    if (state.maze[state.playerPos.y][state.playerPos.x] === CELL_EXIT) {
      if (isExitUnlocked(state)) {
        log('system', '\n  ★★★ 出口已解锁 — 逃脱成功！★★★');
        state.mode = 'won';
        break;
      } else {
        log('system', `  ✗ 出口封印中  truth=${countFlags(state)}/${EXIT_CONDITIONS.minKnowledgeFlags}  depth=${state.depth}/${EXIT_CONDITIONS.minDepth}`);
        navPath.push(...buildDetour(mazeData, state.playerPos, 12));
      }
    }

    // Step warning
    if (66 - state.steps <= 10 && 66 - state.steps > 0)
      log('system', `  ⚠ 剩余 ${66 - state.steps} 步`);

    log('system', '');
  }

  // ── ENDGAME ──
  const outcome = state.mode === 'won' ? 'escape' : state.hp <= 0 ? 'death' : 'unknown';
  log('system', '\n═══════════════════════════════════════════════════');

  // GET EPILOGUE from real server
  try {
    const epiRes = await post('/api/villain/epilogue', {
      gameId, outcome, steps: state.steps, hp: state.hp,
      godHand: state.godHandCount,
      trialPassed: state.trialPassCount, trialFailed: state.trialFailCount,
      backtracks: state.backtrackCount,
    });
    if (epiRes.data?.epilogue) {
      log('villain', `[终章] ${epiRes.data.epilogue}`);
    } else {
      const fallbackEpi = { escape: '你走了。但你看到的不会消失。', death: '游戏结束。', unknown: '迷宫折叠了。' };
      log('villain', `[终章] ${fallbackEpi[outcome]}`);
    }
  } catch {
    log('villain', '[终章] ……');
  }

  // NOTIFY SERVER of game end
  try {
    await post('/api/villain/end', {
      gameId, outcome, totalSteps: state.steps, finalHp: state.hp, maxHp: 3,
      trialStats: { total: state.trialCount, passed: state.trialPassCount, failed: state.trialFailCount },
      godHandCount: state.godHandCount,
    });
    log('api', 'villain/end → notified');
  } catch {}

  // Stats
  const resultLabel = { escape: '逃脱成功 (ESCAPED)', death: '困死迷宫 (TRAPPED)', unknown: '迷失迷宫 (MAZE-LOST)' };
  log('system', `  结局: ${resultLabel[outcome]}`);
  log('system', '═══════════════════════════════════════════════════');
  log('system', `  总步数: ${state.steps}/66  最终HP: ${state.hp}/3  最大深度: ${state._maxDepth}`);
  log('system', `  考验: ${state.trialCount} (通过=${state.trialPassCount} 失败=${state.trialFailCount})`);
  log('system', `  后退: ${state.backtrackCount}  上帝之手: ${state.godHandCount}`);
  log('system', `  真相: ${countFlags(state)}/4 [${Object.entries(state.deck.knowledgeFlags).filter(([k,v])=>v&&k!=='firstTrialDone').map(([k])=>k).join(', ')}]`);
  log('system', `  Villain Session: ${villainSessionActive ? 'LLM active' : 'fallback mode'}`);
  log('system', '═══════════════════════════════════════════════════');

  // Output
  const output = LOG.join('\n');
  console.log(output);
  const outFile = path.join(__dirname, 'headless-game-log.txt');
  fs.writeFileSync(outFile, output, 'utf-8');
  console.log(`\n[saved → ${outFile}]`);
}

// ═══════════════════════════════════════════════════════════
// CARD RESOLUTION (client-side mechanics, calls server for trials)
// ═══════════════════════════════════════════════════════════
async function resolveCard(card, state, isBack, gameId,
  getTrialIdx, setTrialIdx, getTempIdx, setTempIdx,
  getFirstTrial, setFirstTrial, getFirstHpLoss, setFirstHpLoss, mono) {

  switch (card.role) {
    case 'relief': {
      const roll = rng();
      if (roll < 0.05 && state.hp < 3) {
        state.hp++;
        log('system', `  ♥ Relief 回血 HP → ${state.hp}/3`);
      } else if (roll < 0.40) {
        log('system', `  ◊ 方向线索 — ${getHint(state)}`);
      } else {
        log('system', '  ~ 安静走廊');
      }
      break;
    }

    case 'temptation': {
      const ti = getTempIdx();
      const dec = (playerData.temptation_decisions || [])[ti];
      setTempIdx(ti + 1);
      const action = dec?.action || (rng() < 0.4 ? 'follow' : 'ignore');

      log('player', `  [决定] ${action === 'follow' ? '跟过去' : '无视'}${dec?.reasoning ? ' — '+dec.reasoning : ''}`);

      if (action === 'follow') {
        if (rng() < 0.5) {
          log('system', `  → 线索: "${getHint(state)}"`);
        } else {
          state.hp = Math.max(0, state.hp - 1);
          log('system', `  → 陷阱！HP-1 → ${state.hp}/3`);
          hpLossCheck(state, getFirstHpLoss, setFirstHpLoss, mono);
        }
      } else {
        state._avoidanceCount++;
        if (state._avoidanceCount % 3 === 0) {
          state.hp = Math.max(0, state.hp - 1);
          log('system', `  → 回避惩罚(×${state._avoidanceCount}) HP-1 → ${state.hp}/3`);
          hpLossCheck(state, getFirstHpLoss, setFirstHpLoss, mono);
        }
      }
      break;
    }

    case 'pressure': {
      resolvePressure(card.dealer, state, isBack);
      break;
    }

    case 'trial': {
      if (!getFirstTrial()) { setFirstTrial(true); log('player', `  [内心] ${mono.first_trial || '审判……'}`); }
      state.trialCount++;
      state.deck.stepsSinceLastTrial = 0;
      state.deck.knowledgeFlags.firstTrialDone = true;

      // ── GET TRIAL from real server ──
      let trial = null;
      try {
        const tRes = await post('/api/fill/trial', {
          gameId, steps: state.steps, hp: state.hp,
          difficulty: card.difficulty || 'medium',
          trial_number: state.trialCount,
          game_number: 1,
        });
        if (tRes.data?.prompt) {
          trial = tRes.data;
          log('api', `  fill/trial → ${tRes.data._source || 'server'}  type=${tRes.data.confrontation_type || '?'}`);
        }
      } catch (e) {
        log('api', `  fill/trial → error: ${e.message}`);
      }

      const prompt = trial?.prompt || '你是谁？回答我。';
      const evalGuide = trial?.evaluation_guide || '';
      log('system', `  ┌─ Trial #${state.trialCount} [${card.difficulty}] ─────────────`);
      log('system', `  │ Q: ${prompt}`);
      if (trial?.evidence) log('system', `  │ [证据] ${trial.evidence.slice(0, 80)}…`);

      // Player answer (from subagent)
      const ti = getTrialIdx();
      const pAnswer = (playerData.trial_answers || [])[ti];
      setTrialIdx(ti + 1);
      const answer = pAnswer?.answer || '我不确定，但我还在思考。';
      log('player', `  │ A: ${answer}`);
      if (pAnswer?.thought) log('player', `  │ [内心] ${pAnswer.thought}`);

      // ── JUDGE ANSWER via real server ──
      let judgment = null;
      try {
        const jRes = await post('/api/judge/answer', {
          gameId,
          trial_prompt: prompt,
          evaluation_guide: evalGuide,
          player_input: answer,
          fail_count: 0,
          trial_number: state.trialCount,
          hp: state.hp, steps: state.steps,
        });
        judgment = jRes.data;
        log('api', `  judge → ${judgment._agent || 'fallback'}  result=${judgment.judgment}  hit=${judgment.hit}`);
      } catch (e) {
        log('api', `  judge → error: ${e.message}`);
        judgment = { judgment: rng() < 0.5 ? 'pass' : 'fail', feedback: '……', hp_cost: 0 };
      }

      const passed = judgment.judgment === 'pass';
      if (passed) {
        state.trialPassCount++;
        log('villain', `  │ [PASS] ${judgment.feedback || '过了。'}`);
        log('system', `  └─ 通过 ✓`);
      } else {
        state.trialFailCount++;
        log('villain', `  │ [FAIL] ${judgment.feedback || '失败。'}`);
        const hpCost = judgment.hp_cost ?? (state.trialCount >= 2 ? 1 : 0);
        if (hpCost > 0 && state.hp > 0) {
          if (state.hp === 1 && state.trialCount >= 3) {
            // God's Hand at HP=1 on late trials
            state.godHandCount++;
            state.hp = Math.max(0, state.hp - 1);
            log('player', `  │ [上帝之手] 跳过`);
            log('system', `  └─ 上帝之手 HP-1 → ${state.hp}/3`);
          } else {
            state.hp = Math.max(0, state.hp - hpCost);
            log('system', `  └─ 失败 ✗ HP-${hpCost} → ${state.hp}/3`);
          }
          hpLossCheck(state, getFirstHpLoss, setFirstHpLoss, mono);
        } else {
          log('system', `  └─ 失败 ✗ (无HP惩罚)`);
        }
      }

      // Notify server of trial completion
      try {
        await post('/api/trial/complete', {
          gameId, prompt,
          confrontation_type: trial?.confrontation_type || 'unknown',
          attempts: [{ input: answer, passed, hit: judgment.hit || false }],
          uniqueAnswers: 1,
          exitMethod: passed ? 'pass' : (state.godHandCount > 0 ? 'god_hand' : 'fail'),
          totalTimeMs: 8000 + Math.floor(rng() * 12000),
          step: state.steps,
        });
      } catch {}

      if (state.hp === 1) log('player', `  [内心] ${mono.low_hp || 'HP=1……'}`);
      break;
    }

    case 'truth': {
      if (card.flag && !state.deck.knowledgeFlags[card.flag]) {
        state.deck.knowledgeFlags[card.flag] = true;
        log('system', `  ◆ 真相揭示: ${card.flag}  (${countFlags(state)}/${EXIT_CONDITIONS.minKnowledgeFlags})`);
        log('player', `  [内心] ${mono.truth_discovery || '原来如此……'}`);
        if (isExitUnlocked(state)) log('system', '  ★ 出口解锁条件已满足！');
      }
      break;
    }

    case 'payoff': {
      if (state.hp < 3 && rng() < 0.6) {
        state.hp++;
        log('system', `  ♥ Payoff HP+1 → ${state.hp}/3`);
      }
      break;
    }
  }
}

function resolvePressure(dealer, state, isBack) {
  switch (dealer) {
    case 'JUMPSCARE': {
      const react = playerData.pressure_reactions?.JUMPSCARE;
      if (react?.movesInTime ?? rng() < 0.78) {
        log('system', '  ⚡ JUMPSCARE — 及时闪避');
      } else {
        state.hp = Math.max(0, state.hp - 1);
        log('system', `  ⚡ JUMPSCARE — 反应不及！HP-1 → ${state.hp}/3`);
      }
      break;
    }
    case 'WALL_CLOSE':
      state.effects.wallCloseSteps = rngInt(2, 3);
      log('system', `  ▌ WALL_CLOSE ${state.effects.wallCloseSteps}步`);
      break;
    case 'ECHO_LOOP':
      state.effects.echoLoopSteps = rngInt(2, 3);
      log('system', `  ◎ ECHO_LOOP ${state.effects.echoLoopSteps}步`);
      break;
    case 'MEMORY_SCRAMBLE':
      state.effects.memoryScrambleSteps = rngInt(2, 3);
      log('system', `  ◉ MEMORY_SCRAMBLE ${state.effects.memoryScrambleSteps}步`);
      break;
    case 'SHADOW_CHASE':
      state.effects.shadowChaseSteps = rngInt(2, 3);
      log('system', `  ▸ SHADOW_CHASE ${state.effects.shadowChaseSteps}步 (后退=HP-1)`);
      break;
    case 'COUNTDOWN':
      state.effects.countdownSteps = 8;
      state.effects.countdownStartDepth = state.depth;
      log('system', `  ⏱ COUNTDOWN 8步`);
      break;
  }
}

function tickEffects(state, isBack) {
  if (state.effects.echoLoopSteps > 0) { state.effects.echoLoopSteps--; if (!state.effects.echoLoopSteps) log('system', '  ◎ ECHO_LOOP 结束'); }
  if (state.effects.memoryScrambleSteps > 0) { state.effects.memoryScrambleSteps--; if (!state.effects.memoryScrambleSteps) log('system', '  ◉ MEMORY_SCRAMBLE 结束'); }
  if (state.effects.wallCloseSteps > 0) { state.effects.wallCloseSteps--; if (!state.effects.wallCloseSteps) log('system', '  ▌ WALL_CLOSE 结束'); }
  if (state.effects.shadowChaseSteps > 0) {
    if (isBack) { state.hp = Math.max(0, state.hp - 1); log('system', `  ▸ SHADOW后退惩罚 HP-1 → ${state.hp}/3`); }
    state.effects.shadowChaseSteps--;
    if (!state.effects.shadowChaseSteps) log('system', '  ▸ SHADOW_CHASE 结束');
  }
  if (state.effects.countdownSteps > 0) {
    state.effects.countdownSteps--;
    if (!state.effects.countdownSteps) {
      if (state.depth <= state.effects.countdownStartDepth) {
        state.hp = Math.max(0, state.hp - 1);
        log('system', `  ⏱ COUNTDOWN超时 HP-1 → ${state.hp}/3`);
      } else {
        log('system', '  ⏱ COUNTDOWN 通过');
      }
    }
  }
}

function hpLossCheck(state, getFirst, setFirst, mono) {
  if (!getFirst()) { setFirst(true); log('player', `  [内心] ${mono.first_hp_loss || '血掉了……'}`); }
}

function getHint(state) {
  const dx = state.exitPos.x - state.playerPos.x, dy = state.exitPos.y - state.playerPos.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? '东方有微光' : '西侧有气流';
  return dy > 0 ? '南方空气流通' : '北面有回声';
}

function buildNavPath(mazeData, shortPath) {
  if (!shortPath) return [];
  const path = [], maze = mazeData.maze;
  for (let i = 1; i < shortPath.length && path.length < 55; i++) {
    if (rng() < 0.12 && i > 2 && i < shortPath.length - 3) {
      const cur = shortPath[i - 1];
      const wrong = getNeighbors(maze, cur.x, cur.y).filter(n => n.x !== shortPath[i].x || n.y !== shortPath[i].y);
      if (wrong.length > 0) {
        const w = rngPick(wrong);
        path.push({ x: w.x, y: w.y });
        path.push({ x: cur.x, y: cur.y }); // backtrack
      }
    }
    path.push(shortPath[i]);
  }
  return path;
}

function buildDetour(mazeData, from, steps) {
  const path = [], maze = mazeData.maze, visited = new Set([`${from.x},${from.y}`]);
  let pos = { ...from };
  for (let i = 0; i < steps; i++) {
    const ns = getNeighbors(maze, pos.x, pos.y);
    const unv = ns.filter(n => !visited.has(`${n.x},${n.y}`));
    const next = unv.length > 0 ? rngPick(unv) : ns.length > 0 ? rngPick(ns) : null;
    if (!next) break;
    path.push({ x: next.x, y: next.y });
    visited.add(`${next.x},${next.y}`);
    pos = next;
  }
  return path;
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
