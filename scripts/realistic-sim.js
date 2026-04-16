'use strict';
// ═══════════════════════════════════════════════════════════════
// REALISTIC GAME SIMULATOR v2
// Fog-of-war movement, semantic trials, adaptive player behavior
// CQ costs 1 fragment (updated game rule)
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');

const GRID_W = 15, GRID_H = 19;
const CELL_WALL = 0, CELL_PATH = 1, CELL_EXIT = 2;
const MAX_FRAGMENTS = 5, MAX_WALL_PUSHES = 3, MAX_SUDDEN_EVENTS = 3;
const MAX_STEPS = 66;
const FRAGMENT_SPAWN_CHANCE = 0.20;
const SUDDEN_EVENT_CHANCE = 0.08;
const SUDDEN_EVENT_MIN_STEP = 10;

const NUM_GAMES = parseInt(process.argv[2], 10) || 10;

// ── Player profiles ──
const PLAYER_PROFILES = [
  { name: '谨慎型', baseCaution: 0.7, baseTemptFollow: 0.25, baseCqThreshold: 2, pushWhenStuck: 0.8, baseBacktrackRate: 0.3 },
  { name: '冒险型', baseCaution: 0.2, baseTemptFollow: 0.75, baseCqThreshold: 1, pushWhenStuck: 0.5, baseBacktrackRate: 0.1 },
  { name: '探索型', baseCaution: 0.4, baseTemptFollow: 0.50, baseCqThreshold: 3, pushWhenStuck: 0.95, baseBacktrackRate: 0.2 },
  { name: '速通型', baseCaution: 0.3, baseTemptFollow: 0.15, baseCqThreshold: 5, pushWhenStuck: 0.6, baseBacktrackRate: 0.05 },
  { name: '固执型', baseCaution: 0.3, baseTemptFollow: 0.60, baseCqThreshold: 1, pushWhenStuck: 0.3, baseBacktrackRate: 0.4 },
  { name: '资源囤积型', baseCaution: 0.5, baseTemptFollow: 0.45, baseCqThreshold: 4, pushWhenStuck: 0.2, baseBacktrackRate: 0.15 },
  { name: '反抗型', baseCaution: 0.4, baseTemptFollow: 0.35, baseCqThreshold: 1, pushWhenStuck: 0.7, baseBacktrackRate: 0.25 },
  { name: '随机型', baseCaution: 0.4, baseTemptFollow: 0.50, baseCqThreshold: 2, pushWhenStuck: 0.5, baseBacktrackRate: 0.2 },
  { name: '恐惧型', baseCaution: 0.8, baseTemptFollow: 0.10, baseCqThreshold: 3, pushWhenStuck: 0.9, baseBacktrackRate: 0.5 },
  { name: '贪婪型', baseCaution: 0.2, baseTemptFollow: 0.85, baseCqThreshold: 2, pushWhenStuck: 0.4, baseBacktrackRate: 0.15 },
];

// ── Director Deck (30 cards, exact from core.js) ──
const DIRECTOR_DECK = [
  // Cycle 1 (0-9): Tutorial
  { role:'relief',     dealer:'EMPTY' },
  { role:'temptation', dealer:'BREADCRUMB' },
  { role:'trial',      dealer:'MINIGAME', difficulty:'medium', anchor:true },
  { role:'pressure',   dealer:'JUMPSCARE' },
  { role:'truth',      dealer:'REVELATION', flag:'mazeRemembersBacktrack', anchor:true },
  { role:'trial',      dealer:'MINIGAME', difficulty:'medium' },
  { role:'temptation', dealer:'BEAUTY_TRAP' },
  { role:'trial',      dealer:'MINIGAME', difficulty:'medium', anchor:true },
  { role:'pressure',   dealer:'WALL_CLOSE' },
  { role:'relief',     dealer:'EMPTY', anchor:true },
  // Cycle 2 (10-19): Variation
  { role:'temptation', dealer:'REWARD_MIRAGE' },
  { role:'trial',      dealer:'MINIGAME', difficulty:'medium' },
  { role:'pressure',   dealer:'SHADOW_CHASE' },
  { role:'truth',      dealer:'REVELATION', flag:'agentIsAdversarial' },
  { role:'trial',      dealer:'MINIGAME', difficulty:'medium', anchor:true },
  { role:'relief',     dealer:'EMPTY' },
  { role:'temptation', dealer:'FAKE_EXIT' },
  { role:'trial',      dealer:'MINIGAME', difficulty:'medium' },
  { role:'pressure',   dealer:'COUNTDOWN' },
  { role:'payoff',     dealer:'PAYOFF', lite:true, anchor:true },
  // Cycle 3 (20-29): Oppression
  { role:'trial',      dealer:'MINIGAME', difficulty:'hard' },
  { role:'pressure',   dealer:'MEMORY_SCRAMBLE' },
  { role:'trial',      dealer:'MINIGAME', difficulty:'hard', anchor:true },
  { role:'truth',      dealer:'REVELATION', flag:'exitIsConditional' },
  { role:'temptation', dealer:'FAKE_EXIT' },
  { role:'trial',      dealer:'MINIGAME', difficulty:'hard' },
  { role:'pressure',   dealer:'SHADOW_CHASE' },
  { role:'trial',      dealer:'MINIGAME', difficulty:'hard', anchor:true },
  { role:'truth',      dealer:'REVELATION', flag:'agentJudgesAnswers' },
  { role:'relief',     dealer:'EMPTY', anchor:true },
];

// ── Semantic trial types ──
const TRIAL_TYPES = [
  { type: 'file_meaning',    basePass: 0.85, label: '这个文件对你意味着什么？' },
  { type: 'self_reflection', basePass: 0.70, label: '你为什么写了这段话？' },
  { type: 'personal_fear',   basePass: 0.60, label: '你最害怕失去什么？' },
];

// ── Helpers ──
function rng() { return Math.random(); }
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function shuffle(arr) { for (let i=arr.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
function posKey(x,y) { return `${x},${y}`; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Maze generation (matches core.js exactly) ──
function generateMaze() {
  const grid = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(CELL_WALL));
  const midX = Math.floor(GRID_W / 2) | 1;
  const midY = Math.floor(GRID_H / 2) | 1;
  const configurations = [
    { spawn: {x:1, y:1},             exit: {x:GRID_W-2, y:GRID_H-2} },
    { spawn: {x:GRID_W-2, y:1},      exit: {x:1, y:GRID_H-2} },
    { spawn: {x:1, y:GRID_H-2},      exit: {x:GRID_W-2, y:1} },
    { spawn: {x:GRID_W-2, y:GRID_H-2}, exit: {x:1, y:1} },
    { spawn: {x:midX, y:midY},       exit: {x:1, y:1} },
    { spawn: {x:midX, y:midY},       exit: {x:GRID_W-2, y:GRID_H-2} },
    { spawn: {x:midX, y:midY},       exit: {x:GRID_W-2, y:1} },
    { spawn: {x:midX, y:midY},       exit: {x:1, y:GRID_H-2} },
    { spawn: {x:1, y:midY},          exit: {x:GRID_W-2, y:midY} },
    { spawn: {x:midX, y:1},          exit: {x:midX, y:GRID_H-2} },
  ];
  const picked = configurations[Math.floor(rng() * configurations.length)];

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

  // 45% extra openings
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
    grid[candidates[i][1]][candidates[i][0]] = CELL_PATH;
  }
  grid[picked.exit.y][picked.exit.x] = CELL_EXIT;
  return { maze: grid, spawn: picked.spawn, exit: picked.exit };
}

function getNeighbors(maze, x, y) {
  return [[0,-1,'N'],[0,1,'S'],[-1,0,'W'],[1,0,'E']]
    .map(([dx,dy,dir]) => ({x:x+dx, y:y+dy, dx, dy, dir}))
    .filter(n => n.x>=0 && n.x<GRID_W && n.y>=0 && n.y<GRID_H && maze[n.y][n.x]!==CELL_WALL);
}

function bfs(maze, from, to) {
  const q = [{ ...from, dist: 0 }];
  const visited = new Set([posKey(from.x, from.y)]);
  while (q.length > 0) {
    const { x, y, dist } = q.shift();
    if (x === to.x && y === to.y) return dist;
    for (const n of getNeighbors(maze, x, y)) {
      const k = posKey(n.x, n.y);
      if (!visited.has(k)) { visited.add(k); q.push({ x:n.x, y:n.y, dist: dist+1 }); }
    }
  }
  return null;
}

function bfsPath(maze, from, to) {
  const q = [{ ...from, path: [from] }];
  const visited = new Set([posKey(from.x, from.y)]);
  while (q.length > 0) {
    const { x, y, path: p } = q.shift();
    if (x === to.x && y === to.y) return p;
    for (const n of getNeighbors(maze, x, y)) {
      const k = posKey(n.x, n.y);
      if (!visited.has(k)) { visited.add(k); q.push({ x:n.x, y:n.y, path: [...p, {x:n.x,y:n.y}] }); }
    }
  }
  return null;
}

function getAdjacentWalls(maze, x, y) {
  return [[0,-1,'N'],[0,1,'S'],[-1,0,'W'],[1,0,'E']]
    .filter(([dx,dy]) => {
      const wx=x+dx, wy=y+dy, bx=x+dx*2, by=y+dy*2;
      return wx>0 && wy>0 && wx<GRID_W-1 && wy<GRID_H-1 && maze[wy][wx]===CELL_WALL
        && bx>0 && by>0 && bx<GRID_W-1 && by<GRID_H-1;
    })
    .map(([dx,dy,dir]) => ({wx:x+dx, wy:y+dy, bx:x+dx*2, by:y+dy*2, dir}));
}

// ── HP cost (matches judge.js exactly) ──
function computeHpCost(trialNumber, failCount) {
  if (trialNumber <= 1) return 0;
  if (trialNumber <= 3) return (failCount === 1) ? 1 : 0; // first fail only
  return 1; // every fail
}

// ── Pick trial type (weighted by cycle) ──
function pickTrialType(deckIdx) {
  if (deckIdx < 20) {
    // Cycle 1-2: weight toward easier
    const weights = [0.55, 0.30, 0.15];
    const r = rng();
    if (r < weights[0]) return TRIAL_TYPES[0];
    if (r < weights[0] + weights[1]) return TRIAL_TYPES[1];
    return TRIAL_TYPES[2];
  } else {
    // Cycle 3: weight toward harder
    const weights = [0.15, 0.35, 0.50];
    const r = rng();
    if (r < weights[0]) return TRIAL_TYPES[0];
    if (r < weights[0] + weights[1]) return TRIAL_TYPES[1];
    return TRIAL_TYPES[2];
  }
}

// ═══════════════════════════════════════════════════════════════
// FOG-OF-WAR MOVEMENT
// Player only sees adjacent cells. No BFS pathfinding.
// ═══════════════════════════════════════════════════════════════
function fogOfWarChooseDirection(neighbors, state, exit, profile) {
  const { pos, visited, lastDir } = state;
  const inShadowChase = state.effects.shadowChaseSteps > 0;
  const prev = state.history.length > 0 ? state.history[state.history.length-1] : null;

  // Score each neighbor
  const scored = neighbors.map(n => {
    let weight = 1.0;
    const isExplored = visited.has(posKey(n.x, n.y));
    const isBacktrack = prev && n.x === prev.x && n.y === prev.y;
    const isExit = state.maze[n.y][n.x] === CELL_EXIT;

    // Exit always wins if conditions met
    if (isExit) return { ...n, weight: 100 };

    // Unexplored preference
    if (!isExplored) weight *= 3.0;

    // Exit quadrant preference (vague sense of direction)
    const dxToExit = exit.x - pos.x;
    const dyToExit = exit.y - pos.y;
    const movesTowardExitX = (n.dx > 0 && dxToExit > 0) || (n.dx < 0 && dxToExit < 0);
    const movesTowardExitY = (n.dy > 0 && dyToExit > 0) || (n.dy < 0 && dyToExit < 0);
    if (movesTowardExitX || movesTowardExitY) weight *= 1.5;

    // Momentum: continue same direction
    if (state.lastDir && n.dir === state.lastDir) weight *= 1.3;

    // Backtrack avoidance
    if (isBacktrack) {
      if (inShadowChase) weight = 0; // NEVER backtrack during shadow chase
      else weight *= 0.3;
    }

    // Memory scramble: partially randomize
    if (state.effects.memoryScrambleSteps > 0) {
      weight *= (0.5 + rng()); // add noise
    }

    return { ...n, weight };
  });

  // Filter out zero-weight options unless they're the only ones
  const nonZero = scored.filter(s => s.weight > 0);
  const pool = nonZero.length > 0 ? nonZero : scored;

  // If all explored and player is stuck, allow backtrack
  if (pool.every(s => visited.has(posKey(s.x, s.y))) && !inShadowChase) {
    pool.forEach(s => { if (s.weight < 1) s.weight = 1; });
  }

  // Weighted random selection
  const totalWeight = pool.reduce((s, n) => s + n.weight, 0);
  if (totalWeight <= 0) return pick(neighbors);
  let r = rng() * totalWeight;
  for (const n of pool) {
    r -= n.weight;
    if (r <= 0) return n;
  }
  return pool[pool.length - 1];
}

// ═══════════════════════════════════════════════════════════════
// GAME ENGINE
// ═══════════════════════════════════════════════════════════════
function simulateGame(gameNum, profile) {
  const { maze, spawn, exit } = generateMaze();
  const bfsOptimal = bfs(maze, spawn, exit);

  const state = {
    maze,
    pos: { ...spawn }, exit: { ...exit },
    steps: 0, depth: 0, hp: 3, fragments: 0,
    wallPushCount: 0, suddenEventCount: 0,
    history: [], visited: new Set([posKey(spawn.x, spawn.y)]),
    deckIdx: 0, stepsSinceLastTrial: 99, trialCount: 0,
    knowledgeFlags: { mazeRemembersBacktrack: false, agentIsAdversarial: false, exitIsConditional: false, agentJudgesAnswers: false },
    effects: { wallCloseSteps: 0, shadowChaseSteps: 0, countdownSteps: 0, countdownStartDepth: 0, memoryScrambleSteps: 0 },
    lastDir: null,
    // ── Adaptive stats ──
    caution: profile.baseCaution,
    desperation: 0,
    confidence: 0.5,
    resourceAwareness: 0,
    // ── Tracking ──
    trialFailsThisGame: 0, trialPassesThisGame: 0,
    fragmentsEarned: 0, fragmentsFromMovement: 0, fragmentsFromTemptation: 0,
    fragmentsSpentCQ: 0, fragmentsSpentWall: 0, fragmentsWasted: 0,
    temptFollowed: 0, temptIgnored: 0,
    counterQuestionsUsed: 0, counterQuestionsWon: 0,
    suddenCollapses: 0, suddenTeleports: 0, suddenRewinds: 0,
    totalBacktracks: 0, consecutiveBacktracks: 0,
    hpTimeline: [3],
    trialTypeBreakdown: { file_meaning: {pass:0,fail:0}, self_reflection: {pass:0,fail:0}, personal_fear: {pass:0,fail:0} },
    retreatCount: 0, godHandCount: 0,
    wallPushSteps: [], // steps at which wall pushes happened
    shadowChaseBacktrackDmg: 0,
    exitReachCount: 0,
  };
  let outcome = 'trapped';

  function drawCard() {
    let card = DIRECTOR_DECK[state.deckIdx];
    state.deckIdx++;
    if (state.deckIdx >= DIRECTOR_DECK.length) state.deckIdx = 20; // loop cycle 3
    if (card.role === 'truth' && card.flag && state.knowledgeFlags[card.flag]) return drawCard();
    if (card.role === 'trial' && state.stepsSinceLastTrial < 4) { state.stepsSinceLastTrial++; return drawCard(); }
    return card;
  }

  // ── Adaptive behavior updates ──
  function updateAdaptive(event) {
    switch (event) {
      case 'damage':
        state.caution = clamp(state.caution + 0.12, 0, 1);
        state.confidence = clamp(state.confidence - 0.1, 0, 1);
        break;
      case 'trial_pass':
        state.confidence = clamp(state.confidence + 0.1, 0, 1);
        break;
      case 'trial_fail':
        state.confidence = clamp(state.confidence - 0.05, 0, 1);
        state.caution = clamp(state.caution + 0.05, 0, 1);
        break;
      case 'fragment_found':
        state.resourceAwareness = clamp(state.resourceAwareness + 0.25, 0, 1);
        break;
      case 'step':
        state.desperation = clamp((state.steps / MAX_STEPS) * 1.2, 0, 1);
        break;
    }
  }

  // ── Effective tempt follow rate ──
  function effectiveTemptFollow() {
    const base = profile.baseTemptFollow;
    return base * (1 - state.caution * 0.5) * (1 + state.desperation * 0.3);
  }

  // ── Retreat threshold ──
  function retreatThreshold() {
    return Math.max(1, 3 - Math.floor(state.caution * 2));
  }

  // ── Should use CQ? ──
  function shouldUseCQ(failsThisTrial) {
    // CQ costs only 1 fragment now, so more accessible
    // Players with any resource awareness and at least 1 fail will try
    const cqThresholdMet = failsThisTrial >= Math.max(1, Math.floor(profile.baseCqThreshold * (1 - state.desperation * 0.5)));
    return state.resourceAwareness > 0.2 && state.fragments >= 1 && cqThresholdMet;
  }

  // ── Should wall push? ──
  function shouldWallPush() {
    // Trigger: player has resource awareness, has fragment, and
    // either stuck (consecutive backtracks) or no unexplored neighbors visible
    const neighbors = getNeighbors(maze, state.pos.x, state.pos.y);
    const hasUnexplored = neighbors.some(n => !state.visited.has(posKey(n.x, n.y)));
    const stuckCondition = state.consecutiveBacktracks >= 2 || (!hasUnexplored && state.steps > 10);
    return state.resourceAwareness > 0.3 && stuckCondition
      && state.fragments >= 1 && state.wallPushCount < MAX_WALL_PUSHES;
  }

  // ── Main game loop ──
  while (state.steps < MAX_STEPS && state.hp > 0) {
    const neighbors = getNeighbors(maze, state.pos.x, state.pos.y);
    if (neighbors.length === 0) { break; }

    // Wall push consideration (adaptive)
    if (shouldWallPush() && rng() < profile.pushWhenStuck) {
      const walls = getAdjacentWalls(maze, state.pos.x, state.pos.y);
      if (walls.length > 0) {
        const w = pick(walls);
        maze[w.wy][w.wx] = CELL_PATH;
        if (maze[w.by][w.bx] === CELL_WALL) maze[w.by][w.bx] = CELL_PATH;
        state.fragments--;
        state.fragmentsSpentWall++;
        state.wallPushCount++;
        state.wallPushSteps.push(state.steps);
        state.consecutiveBacktracks = 0;
      }
    }

    // ── Fog-of-war movement ──
    const chosen = fogOfWarChooseDirection(neighbors, state, exit, profile);
    const prev = state.history.length > 0 ? state.history[state.history.length-1] : null;
    const isBack = prev && chosen.x === prev.x && chosen.y === prev.y;
    const isNewCell = !state.visited.has(posKey(chosen.x, chosen.y));

    if (!isBack) {
      state.history.push({ x: state.pos.x, y: state.pos.y });
      state.consecutiveBacktracks = 0;
    } else {
      if (state.history.length > 0) state.history.pop();
      state.totalBacktracks++;
      state.consecutiveBacktracks++;
    }
    state.pos = { x: chosen.x, y: chosen.y };
    state.steps++;
    state.depth = state.history.length;
    state.visited.add(posKey(chosen.x, chosen.y));
    state.stepsSinceLastTrial++;
    state.lastDir = chosen.dir;
    updateAdaptive('step');

    // ── Pressure effects tick ──
    if (state.effects.shadowChaseSteps > 0) {
      if (isBack) {
        state.hp--;
        state.shadowChaseBacktrackDmg++;
        updateAdaptive('damage');
        state.hpTimeline.push(state.hp);
        if (state.hp <= 0) { outcome = 'death'; break; }
      }
      state.effects.shadowChaseSteps--;
    }
    if (state.effects.wallCloseSteps > 0) state.effects.wallCloseSteps--;
    if (state.effects.countdownSteps > 0) {
      state.effects.countdownSteps--;
      if (state.effects.countdownSteps <= 0) {
        if (state.depth <= state.effects.countdownStartDepth) {
          state.hp--;
          updateAdaptive('damage');
          state.hpTimeline.push(state.hp);
          if (state.hp <= 0) { outcome = 'death'; break; }
        }
      }
    }
    if (state.effects.memoryScrambleSteps > 0) state.effects.memoryScrambleSteps--;

    // ── Check exit ──
    if (maze[chosen.y][chosen.x] === CELL_EXIT) {
      state.exitReachCount++;
      const flagCount = Object.values(state.knowledgeFlags).filter(v=>v).length;
      if (flagCount >= 2 && state.depth >= 6) {
        outcome = 'escape';
        break;
      }
      // else: locked, keep going
    }

    // ── Draw card ──
    const card = drawCard();
    const hasMechanism = card.role !== 'relief' && card.dealer !== 'EMPTY';

    // ── Fragment spawning ──
    if (!isBack && isNewCell && !hasMechanism && state.fragments < MAX_FRAGMENTS && rng() < FRAGMENT_SPAWN_CHANCE) {
      state.fragments++;
      state.fragmentsEarned++;
      state.fragmentsFromMovement++;
      updateAdaptive('fragment_found');
    }

    // ── Sudden Events ──
    if (state.steps >= SUDDEN_EVENT_MIN_STEP && state.suddenEventCount < MAX_SUDDEN_EVENTS && !hasMechanism && rng() < SUDDEN_EVENT_CHANCE) {
      state.suddenEventCount++;
      const eventRoll = rng();
      if (eventRoll < 0.40) {
        // Maze Collapse
        const collapseCandidates = [];
        for (let y=1;y<GRID_H-1;y++) for (let x=1;x<GRID_W-1;x++) {
          if (maze[y][x]!==CELL_PATH) continue;
          if (x===state.pos.x && y===state.pos.y) continue;
          if (x===exit.x && y===exit.y) continue;
          const pc = [[0,-1],[0,1],[-1,0],[1,0]].filter(([dx,dy])=>{
            const nx=x+dx,ny=y+dy; return nx>=0&&ny>=0&&nx<GRID_W&&ny<GRID_H&&maze[ny][nx]!==CELL_WALL;
          }).length;
          if (pc > 1) collapseCandidates.push({x,y});
        }
        shuffle(collapseCandidates);
        let collapsed = 0;
        for (let i=0; i<Math.min(4, collapseCandidates.length); i++) {
          const c = collapseCandidates[i];
          maze[c.y][c.x] = CELL_WALL;
          if (!bfsPath(maze, state.pos, exit)) { maze[c.y][c.x] = CELL_PATH; continue; }
          collapsed++;
        }
        if (collapsed > 0) state.suddenCollapses++;
        else state.suddenEventCount--;
      } else if (eventRoll < 0.75) {
        // Teleport
        const cells = [...state.visited].map(k=>{const[x,y]=k.split(',').map(Number);return{x,y};})
          .filter(c=>!(c.x===state.pos.x&&c.y===state.pos.y)&&maze[c.y]&&maze[c.y][c.x]!==CELL_WALL);
        if (cells.length > 0) {
          const target = pick(cells);
          state.pos = target;
          state.history = [];
          state.depth = 0;
          state.suddenTeleports++;
        } else { state.suddenEventCount--; }
      } else {
        // Rewind
        if (state.history.length >= 5) {
          const target = state.history[state.history.length - 5];
          state.history = state.history.slice(0, state.history.length - 5);
          state.pos = target;
          state.depth = state.history.length;
          state.suddenRewinds++;
        } else { state.suddenEventCount--; }
      }
    }

    // ── Process card ──
    if (card.role === 'truth' && card.flag) {
      state.knowledgeFlags[card.flag] = true;
    } else if (card.role === 'temptation') {
      const effectiveRate = effectiveTemptFollow();
      const adjustedRate = state.hp <= 1 ? effectiveRate * 0.3 : effectiveRate;
      if (rng() < adjustedRate) {
        state.temptFollowed++;
        const roll = rng();
        if (roll < 0.55) {
          // Intel (no cost/benefit besides info)
        } else if (roll < 0.75 && state.fragments < MAX_FRAGMENTS) {
          state.fragments++;
          state.fragmentsEarned++;
          state.fragmentsFromTemptation++;
          updateAdaptive('fragment_found');
        } else {
          state.hp--;
          updateAdaptive('damage');
          state.hpTimeline.push(state.hp);
          if (state.hp <= 0) { outcome = 'death'; break; }
        }
      } else {
        state.temptIgnored++;
      }
    } else if (card.role === 'trial') {
      state.trialCount++;
      state.stepsSinceLastTrial = 0;
      let trialResolved = false;
      let failsThisTrial = 0;
      const trialType = pickTrialType(state.deckIdx);

      while (!trialResolved && state.hp > 0) {
        // Compute pass rate
        let passRate = trialType.basePass;
        if (card.difficulty === 'hard') passRate -= 0.15;
        // Retry bonus
        passRate += failsThisTrial * 0.15;
        // Low HP panic penalty
        if (state.hp === 1) passRate -= 0.10;
        // Confidence modifier
        passRate += (state.confidence - 0.5) * 0.1;
        passRate = clamp(passRate, 0.05, 0.97);

        if (rng() < passRate) {
          state.trialPassesThisGame++;
          state.trialTypeBreakdown[trialType.type].pass++;
          trialResolved = true;
          updateAdaptive('trial_pass');
        } else {
          failsThisTrial++;
          state.trialFailsThisGame++;
          state.trialTypeBreakdown[trialType.type].fail++;
          updateAdaptive('trial_fail');

          // Counter-question attempt? (costs 1 fragment now)
          if (shouldUseCQ(failsThisTrial) && rng() < 0.7) {
            state.fragments--;
            state.fragmentsSpentCQ++;
            state.counterQuestionsUsed++;
            const cqWin = rng() < 0.40;
            if (cqWin) {
              state.counterQuestionsWon++;
              trialResolved = true;
              continue;
            }
            // CQ failed, continue trial loop
          } else {
            // HP cost (judge.js logic)
            const hpCost = computeHpCost(state.trialCount, failsThisTrial);
            if (hpCost > 0) {
              state.hp -= hpCost;
              updateAdaptive('damage');
              state.hpTimeline.push(state.hp);
              if (state.hp <= 0) { outcome = 'death'; trialResolved = true; break; }
            }
          }

          // Retreat check
          const threshold = retreatThreshold();
          if (!trialResolved && failsThisTrial >= threshold) {
            if (rng() < 0.6) {
              trialResolved = true;
              state.retreatCount++;
            } else if (state.hp > 1 && rng() < 0.4) {
              state.hp--;
              state.godHandCount++;
              updateAdaptive('damage');
              state.hpTimeline.push(state.hp);
              trialResolved = true;
              if (state.hp <= 0) { outcome = 'death'; break; }
            } else {
              trialResolved = true;
              state.retreatCount++;
            }
          }
        }
      }
    } else if (card.role === 'pressure') {
      switch (card.dealer) {
        case 'JUMPSCARE':
          if (rng() < 0.15) {
            state.hp--;
            updateAdaptive('damage');
            state.hpTimeline.push(state.hp);
            if (state.hp <= 0) { outcome = 'death'; }
          }
          break;
        case 'WALL_CLOSE':
          state.effects.wallCloseSteps = 4;
          break;
        case 'SHADOW_CHASE':
          state.effects.shadowChaseSteps = 5;
          break;
        case 'COUNTDOWN':
          state.effects.countdownSteps = 8;
          state.effects.countdownStartDepth = state.depth;
          break;
        case 'MEMORY_SCRAMBLE':
          state.effects.memoryScrambleSteps = 4;
          break;
      }
    } else if (card.role === 'relief') {
      if (state.hp < 3 && rng() < 0.15) {
        state.hp++;
        state.hpTimeline.push(state.hp);
      }
    }

    // Record HP at each step
    if (state.hpTimeline.length <= state.steps) {
      state.hpTimeline.push(state.hp);
    }

    if (outcome !== 'trapped') break;
  }

  if (state.steps >= MAX_STEPS && outcome === 'trapped') {
    outcome = 'trapped';
  }

  // Movement efficiency
  const movementEfficiency = bfsOptimal ? state.steps / bfsOptimal : null;
  const flagCount = Object.values(state.knowledgeFlags).filter(v=>v).length;

  return {
    gameNum,
    profile: profile.name,
    outcome,
    steps: state.steps,
    hp: state.hp,
    hpFinal: state.hp,
    fragments: state.fragments,
    bfsOptimal,
    movementEfficiency,
    flagCount,
    depth: state.depth,
    trialCount: state.trialCount,
    trialPasses: state.trialPassesThisGame,
    trialFails: state.trialFailsThisGame,
    trialTypeBreakdown: state.trialTypeBreakdown,
    counterQuestionsUsed: state.counterQuestionsUsed,
    counterQuestionsWon: state.counterQuestionsWon,
    wallPushes: state.wallPushCount,
    wallPushSteps: state.wallPushSteps,
    temptFollowed: state.temptFollowed,
    temptIgnored: state.temptIgnored,
    fragmentsEarned: state.fragmentsEarned,
    fragmentsFromMovement: state.fragmentsFromMovement,
    fragmentsFromTemptation: state.fragmentsFromTemptation,
    fragmentsSpentCQ: state.fragmentsSpentCQ,
    fragmentsSpentWall: state.fragmentsSpentWall,
    suddenCollapses: state.suddenCollapses,
    suddenTeleports: state.suddenTeleports,
    suddenRewinds: state.suddenRewinds,
    totalBacktracks: state.totalBacktracks,
    retreatCount: state.retreatCount,
    godHandCount: state.godHandCount,
    exitReachCount: state.exitReachCount,
    hpTimeline: state.hpTimeline,
    // Adaptive final state
    finalCaution: state.caution,
    finalDesperation: state.desperation,
    finalConfidence: state.confidence,
    finalResourceAwareness: state.resourceAwareness,
  };
}

// ═══════════════════════════════════════════════════════════════
// RUN SIMULATION
// ═══════════════════════════════════════════════════════════════
function runBatch(n, label) {
  const results = [];
  for (let i = 0; i < n; i++) {
    const profile = PLAYER_PROFILES[i % PLAYER_PROFILES.length];
    results.push(simulateGame(i + 1, profile));
  }

  // ── Aggregate stats ──
  const escapes = results.filter(r => r.outcome === 'escape');
  const deaths = results.filter(r => r.outcome === 'death');
  const trapped = results.filter(r => r.outcome === 'trapped');

  const avg = (arr, key) => arr.length === 0 ? 0 : arr.reduce((s, r) => s + (typeof key === 'function' ? key(r) : r[key]), 0) / arr.length;
  const sum = (arr, key) => arr.reduce((s, r) => s + (typeof key === 'function' ? key(r) : r[key]), 0);

  const stats = {
    label,
    totalGames: n,
    escapeRate: (escapes.length / n * 100).toFixed(1) + '%',
    deathRate: (deaths.length / n * 100).toFixed(1) + '%',
    trappedRate: (trapped.length / n * 100).toFixed(1) + '%',
    escapeCount: escapes.length,
    deathCount: deaths.length,
    trappedCount: trapped.length,
    avgSteps: avg(results, 'steps').toFixed(1),
    avgStepsEscape: escapes.length > 0 ? avg(escapes, 'steps').toFixed(1) : 'N/A',
    avgBfsOptimal: avg(results, 'bfsOptimal').toFixed(1),
    avgMovementEfficiency: avg(results.filter(r => r.movementEfficiency), 'movementEfficiency').toFixed(2) + 'x',
    avgMovementEfficiencyEscape: escapes.length > 0 ? avg(escapes.filter(r => r.movementEfficiency), 'movementEfficiency').toFixed(2) + 'x' : 'N/A',
    avgHpFinal: avg(results, 'hpFinal').toFixed(2),
    avgFragmentsEarned: avg(results, 'fragmentsEarned').toFixed(2),
    avgFragmentsFromMovement: avg(results, 'fragmentsFromMovement').toFixed(2),
    avgFragmentsFromTemptation: avg(results, 'fragmentsFromTemptation').toFixed(2),
    avgFragmentsSpentCQ: avg(results, 'fragmentsSpentCQ').toFixed(2),
    avgFragmentsSpentWall: avg(results, 'fragmentsSpentWall').toFixed(2),
    avgFragmentsLeftover: avg(results, 'fragments').toFixed(2),
    avgFlagCount: avg(results, 'flagCount').toFixed(2),
    avgTrialCount: avg(results, 'trialCount').toFixed(2),
    avgTrialPasses: avg(results, 'trialPasses').toFixed(2),
    avgTrialFails: avg(results, 'trialFails').toFixed(2),
    trialPassRate: sum(results, 'trialPasses') > 0 ? (sum(results, 'trialPasses') / (sum(results, 'trialPasses') + sum(results, 'trialFails')) * 100).toFixed(1) + '%' : '0%',
    avgCounterQuestionsUsed: avg(results, 'counterQuestionsUsed').toFixed(2),
    avgCounterQuestionsWon: avg(results, 'counterQuestionsWon').toFixed(2),
    cqWinRate: sum(results, 'counterQuestionsUsed') > 0 ? (sum(results, 'counterQuestionsWon') / sum(results, 'counterQuestionsUsed') * 100).toFixed(1) + '%' : 'N/A',
    avgWallPushes: avg(results, 'wallPushes').toFixed(2),
    avgTemptFollowed: avg(results, 'temptFollowed').toFixed(2),
    avgTemptIgnored: avg(results, 'temptIgnored').toFixed(2),
    temptFollowRate: (sum(results, 'temptFollowed') + sum(results, 'temptIgnored')) > 0 ? (sum(results, 'temptFollowed') / (sum(results, 'temptFollowed') + sum(results, 'temptIgnored')) * 100).toFixed(1) + '%' : '0%',
    avgBacktracks: avg(results, 'totalBacktracks').toFixed(2),
    avgRetreats: avg(results, 'retreatCount').toFixed(2),
    avgGodHands: avg(results, 'godHandCount').toFixed(2),
    avgExitReachCount: avg(results, 'exitReachCount').toFixed(2),
    // Sudden events
    avgSuddenCollapses: avg(results, 'suddenCollapses').toFixed(2),
    avgSuddenTeleports: avg(results, 'suddenTeleports').toFixed(2),
    avgSuddenRewinds: avg(results, 'suddenRewinds').toFixed(2),
    // Trial type breakdown
    trialTypeBreakdown: {
      file_meaning: {
        pass: sum(results, r => r.trialTypeBreakdown.file_meaning.pass),
        fail: sum(results, r => r.trialTypeBreakdown.file_meaning.fail),
      },
      self_reflection: {
        pass: sum(results, r => r.trialTypeBreakdown.self_reflection.pass),
        fail: sum(results, r => r.trialTypeBreakdown.self_reflection.fail),
      },
      personal_fear: {
        pass: sum(results, r => r.trialTypeBreakdown.personal_fear.pass),
        fail: sum(results, r => r.trialTypeBreakdown.personal_fear.fail),
      },
    },
    // Per-profile breakdown
    profileBreakdown: {},
    // Adaptive averages
    avgFinalCaution: avg(results, 'finalCaution').toFixed(3),
    avgFinalDesperation: avg(results, 'finalDesperation').toFixed(3),
    avgFinalConfidence: avg(results, 'finalConfidence').toFixed(3),
    avgFinalResourceAwareness: avg(results, 'finalResourceAwareness').toFixed(3),
  };

  // Per-profile
  for (const p of PLAYER_PROFILES) {
    const pGames = results.filter(r => r.profile === p.name);
    if (pGames.length === 0) continue;
    const pEscapes = pGames.filter(r => r.outcome === 'escape');
    const pDeaths = pGames.filter(r => r.outcome === 'death');
    stats.profileBreakdown[p.name] = {
      games: pGames.length,
      escapeRate: (pEscapes.length / pGames.length * 100).toFixed(0) + '%',
      deathRate: (pDeaths.length / pGames.length * 100).toFixed(0) + '%',
      avgSteps: avg(pGames, 'steps').toFixed(1),
      avgCQ: avg(pGames, 'counterQuestionsUsed').toFixed(1),
      avgWallPush: avg(pGames, 'wallPushes').toFixed(1),
    };
  }

  return { results, stats };
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
function printStats(s) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${s.label} | ${s.totalGames} games`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Outcomes:    Escape ${s.escapeRate} (${s.escapeCount}) | Death ${s.deathRate} (${s.deathCount}) | Trapped ${s.trappedRate} (${s.trappedCount})`);
  console.log(`  Steps:       Avg ${s.avgSteps} | Escape avg ${s.avgStepsEscape} | BFS optimal avg ${s.avgBfsOptimal}`);
  console.log(`  Movement:    Efficiency ${s.avgMovementEfficiency} (escape: ${s.avgMovementEfficiencyEscape}) | Backtracks ${s.avgBacktracks}`);
  console.log(`  HP:          Final avg ${s.avgHpFinal}`);
  console.log(`  Fragments:   Earned ${s.avgFragmentsEarned} (move:${s.avgFragmentsFromMovement} tempt:${s.avgFragmentsFromTemptation}) | Spent CQ:${s.avgFragmentsSpentCQ} Wall:${s.avgFragmentsSpentWall} | Leftover:${s.avgFragmentsLeftover}`);
  console.log(`  Trials:      Count ${s.avgTrialCount} | Pass ${s.avgTrialPasses} | Fail ${s.avgTrialFails} | Rate ${s.trialPassRate}`);
  console.log(`  Counter-Q:   Used ${s.avgCounterQuestionsUsed} | Won ${s.avgCounterQuestionsWon} | Win rate ${s.cqWinRate}`);
  console.log(`  Wall Push:   ${s.avgWallPushes} avg`);
  console.log(`  Temptation:  Follow ${s.avgTemptFollowed} / Ignore ${s.avgTemptIgnored} | Follow rate ${s.temptFollowRate}`);
  console.log(`  Retreat/God: Retreat ${s.avgRetreats} | God Hand ${s.avgGodHands}`);
  console.log(`  Exit reach:  ${s.avgExitReachCount} (times arrived at exit cell)`);
  console.log(`  Flags:       ${s.avgFlagCount} avg knowledge flags`);
  console.log(`  Sudden:      Collapse ${s.avgSuddenCollapses} | Teleport ${s.avgSuddenTeleports} | Rewind ${s.avgSuddenRewinds}`);
  console.log(`  Adaptive:    Caution ${s.avgFinalCaution} | Desperation ${s.avgFinalDesperation} | Confidence ${s.avgFinalConfidence} | ResourceAware ${s.avgFinalResourceAwareness}`);
  console.log(`\n  Trial Type Breakdown:`);
  for (const [type, data] of Object.entries(s.trialTypeBreakdown)) {
    const total = data.pass + data.fail;
    const rate = total > 0 ? (data.pass / total * 100).toFixed(1) : '0';
    console.log(`    ${type}: ${data.pass}P/${data.fail}F (${rate}%)`);
  }
  console.log(`\n  Per-Profile Breakdown:`);
  console.log(`    ${'Profile'.padEnd(14)} ${'Esc%'.padStart(5)} ${'Die%'.padStart(5)} ${'Steps'.padStart(6)} ${'CQ'.padStart(5)} ${'WPush'.padStart(6)}`);
  for (const [name, data] of Object.entries(s.profileBreakdown)) {
    console.log(`    ${name.padEnd(14)} ${data.escapeRate.padStart(5)} ${data.deathRate.padStart(5)} ${data.avgSteps.padStart(6)} ${data.avgCQ.padStart(5)} ${data.avgWallPush.padStart(6)}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════
console.log(`=== ClawTrap Realistic Simulator v2 (${NUM_GAMES} games) ===`);
console.log(`  SUDDEN_EVENT_MIN_STEP = ${SUDDEN_EVENT_MIN_STEP}, CQ cost = 1 fragment\n`);

const { results: allResults, stats: s1 } = runBatch(NUM_GAMES, `Batch (${NUM_GAMES} games)`);

// ── Per-game detail output ──
console.log('--- Per-Game Details ---\n');
for (const r of allResults) {
  const outcomeTag = r.outcome === 'escape' ? 'ESCAPE' : r.outcome === 'death' ? 'DEATH' : 'TRAPPED';
  const suddenTotal = (r.suddenCollapses||0) + (r.suddenTeleports||0) + (r.suddenRewinds||0);
  console.log(`Game #${String(r.gameNum).padStart(2)} [${r.profile}] => ${outcomeTag}`);
  console.log(`  Steps: ${r.steps}/${MAX_STEPS} | HP: ${r.hpFinal}/3 | Fragments: earned ${r.fragmentsEarned}, left ${r.fragments}`);
  console.log(`  Trials: ${r.trialPasses}P/${r.trialFails}F | CQ: used ${r.counterQuestionsUsed}, won ${r.counterQuestionsWon} (spent ${r.fragmentsSpentCQ} frags)`);
  console.log(`  WallPush: ${r.wallPushes} (spent ${r.fragmentsSpentWall} frags) | Tempt: follow ${r.temptFollowed} / ignore ${r.temptIgnored}`);
  console.log(`  Sudden events: ${suddenTotal} (collapse ${r.suddenCollapses||0}, teleport ${r.suddenTeleports||0}, rewind ${r.suddenRewinds||0})`);
  console.log(`  Retreat: ${r.retreatCount} | GodHand: ${r.godHandCount} | ExitReach: ${r.exitReachCount} | Flags: ${r.flagCount}`);
  console.log(`  Adaptive: caution=${r.finalCaution.toFixed(2)} desp=${r.finalDesperation.toFixed(2)} conf=${r.finalConfidence.toFixed(2)} res=${r.finalResourceAwareness.toFixed(2)}`);
  console.log('');
}

// ── Aggregate stats ──
printStats(s1);

// ── Combined summary ──
const total = allResults.length;
const allEscapes = allResults.filter(r => r.outcome === 'escape').length;
const allDeaths = allResults.filter(r => r.outcome === 'death').length;
const allTrapped = allResults.filter(r => r.outcome === 'trapped').length;

console.log(`\n${'='.repeat(60)}`);
console.log(`  SUMMARY (${total} games)`);
console.log(`${'='.repeat(60)}`);
console.log(`  Escape: ${(allEscapes/total*100).toFixed(1)}% (${allEscapes}) | Death: ${(allDeaths/total*100).toFixed(1)}% (${allDeaths}) | Trapped: ${(allTrapped/total*100).toFixed(1)}% (${allTrapped})`);

// Death cause analysis
const deathGames = allResults.filter(r => r.outcome === 'death');
const deathEarly = deathGames.filter(r => r.steps < 20).length;
const deathMid = deathGames.filter(r => r.steps >= 20 && r.steps < 40).length;
const deathLate = deathGames.filter(r => r.steps >= 40).length;
console.log(`  Death timing: Early(<20) ${deathEarly} | Mid(20-39) ${deathMid} | Late(40+) ${deathLate}`);

// Feature usage rates
const cqUsers = allResults.filter(r => r.counterQuestionsUsed > 0).length;
const wallUsers = allResults.filter(r => r.wallPushes > 0).length;
const retreaters = allResults.filter(r => r.retreatCount > 0).length;
console.log(`  Feature usage: CQ ${(cqUsers/total*100).toFixed(0)}% | WallPush ${(wallUsers/total*100).toFixed(0)}% | Retreat ${(retreaters/total*100).toFixed(0)}%`);

// Villain behavior line checks
const fragHighGames = allResults.filter(r => r.fragmentsEarned >= 3).length;
const wallPushGames = wallUsers;
console.log(`\n  Villain line triggers:`);
console.log(`    fragments >= 3: ${fragHighGames}/${total} games`);
console.log(`    wallPushes > 0: ${wallPushGames}/${total} games`);

// Save
const outputPath = 'C:/Users/tatsuya/Documents/ClawTrap/scripts/sim-results-v2.json';
fs.writeFileSync(outputPath, JSON.stringify({
  config: { NUM_GAMES, SUDDEN_EVENT_MIN_STEP, CQ_COST: 1 },
  games: allResults,
  stats: s1,
  combined: {
    total, escapes: allEscapes, deaths: allDeaths, trapped: allTrapped,
    escapeRate: (allEscapes/total*100).toFixed(1),
    deathRate: (allDeaths/total*100).toFixed(1),
    trappedRate: (allTrapped/total*100).toFixed(1),
  }
}, null, 2));
console.log(`\nResults saved to ${outputPath}`);
