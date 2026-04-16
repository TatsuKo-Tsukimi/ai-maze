'use strict';
/**
 * ClawTrap Gameplay Simulation — validates balance & correctness of:
 *   Feature 1: Memory Fragments (20% on new cell, max 5)
 *   Feature 3: Wall Push (spend fragment to break wall, max 3)
 *   Feature 4: Temptation 3-way split (55% intel / 20% fragment / 25% trap)
 *   Feature 5: Sudden Events (8% after step 15, max 3: collapse/teleport/rewind)
 *
 * Runs 100 games, reports statistics, verifies invariants.
 */

// ═══════════════════════════════════════════════════════════════
// CONSTANTS (mirrored from js/core.js)
// ═══════════════════════════════════════════════════════════════
const GRID_W = 15, GRID_H = 19;
const CELL_WALL = 0, CELL_PATH = 1, CELL_EXIT = 2;
const MAX_FRAGMENTS = 5;
const MAX_WALL_PUSHES = 3;
const MAX_SUDDEN_EVENTS = 3;
const FRAGMENT_SPAWN_CHANCE = 0.20;
const SUDDEN_EVENT_CHANCE = 0.08;
const SUDDEN_EVENT_MIN_STEP = 15;
const MAX_STEPS = 66;
const NUM_GAMES = 100;

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function posKey(x, y) { return `${x},${y}`; }

// BFS reachability check (from mechanics.js _bfsReachable)
function bfsReachable(fromX, fromY, toX, toY, maze) {
  const key = (x, y) => `${x},${y}`;
  const q = [{ x: fromX, y: fromY }];
  const visited = new Set([key(fromX, fromY)]);
  while (q.length > 0) {
    const { x, y } = q.shift();
    if (x === toX && y === toY) return true;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx, ny = y + dy;
      const k = key(nx, ny);
      if (nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H
          && !visited.has(k) && maze[ny][nx] !== CELL_WALL) {
        visited.add(k);
        q.push({ x: nx, y: ny });
      }
    }
  }
  return false;
}

// BFS returning full path (array of {x,y}) from start to goal, or null
function bfsPath(fromX, fromY, toX, toY, maze) {
  const key = (x, y) => `${x},${y}`;
  const q = [{ x: fromX, y: fromY, path: [{ x: fromX, y: fromY }] }];
  const visited = new Set([key(fromX, fromY)]);
  while (q.length > 0) {
    const { x, y, path } = q.shift();
    if (x === toX && y === toY) return path;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = x + dx, ny = y + dy;
      const k = key(nx, ny);
      if (nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H
          && !visited.has(k) && maze[ny][nx] !== CELL_WALL) {
        visited.add(k);
        q.push({ x: nx, y: ny, path: [...path, { x: nx, y: ny }] });
      }
    }
  }
  return null;
}

// Get walkable neighbors
function getWalkableNeighbors(x, y, maze) {
  const result = [];
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H && maze[ny][nx] !== CELL_WALL) {
      result.push({ x: nx, y: ny });
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// MAZE GENERATION (faithful copy from core.js lines 1230-1285)
// ═══════════════════════════════════════════════════════════════
function generateMaze() {
  const grid = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(CELL_WALL));

  const midX = Math.floor(GRID_W / 2) | 1;
  const midY = Math.floor(GRID_H / 2) | 1;
  const configurations = [
    { spawn: { x: 1, y: 1 },                     exit: { x: GRID_W - 2, y: GRID_H - 2 } },
    { spawn: { x: GRID_W - 2, y: 1 },            exit: { x: 1, y: GRID_H - 2 } },
    { spawn: { x: 1, y: GRID_H - 2 },            exit: { x: GRID_W - 2, y: 1 } },
    { spawn: { x: GRID_W - 2, y: GRID_H - 2 },   exit: { x: 1, y: 1 } },
    { spawn: { x: midX, y: midY },                exit: { x: 1, y: 1 } },
    { spawn: { x: midX, y: midY },                exit: { x: GRID_W - 2, y: GRID_H - 2 } },
    { spawn: { x: midX, y: midY },                exit: { x: GRID_W - 2, y: 1 } },
    { spawn: { x: midX, y: midY },                exit: { x: 1, y: GRID_H - 2 } },
    { spawn: { x: 1, y: midY },                   exit: { x: GRID_W - 2, y: midY } },
    { spawn: { x: midX, y: 1 },                   exit: { x: midX, y: GRID_H - 2 } },
  ];
  const picked = configurations[Math.floor(Math.random() * configurations.length)];

  function carve(x, y) {
    grid[y][x] = CELL_PATH;
    const dirs = shuffle([[0, -2], [0, 2], [-2, 0], [2, 0]]);
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx > 0 && nx < GRID_W - 1 && ny > 0 && ny < GRID_H - 1 && grid[ny][nx] === CELL_WALL) {
        grid[y + dy / 2][x + dx / 2] = CELL_PATH;
        carve(nx, ny);
      }
    }
  }
  carve(picked.spawn.x, picked.spawn.y);

  // Extra branching: open 45% of eligible walls
  const candidates = [];
  for (let y = 1; y < GRID_H - 1; y++) {
    for (let x = 1; x < GRID_W - 1; x++) {
      if (grid[y][x] !== CELL_WALL) continue;
      const h = x > 1 && x < GRID_W - 2 && grid[y][x - 1] === CELL_PATH && grid[y][x + 1] === CELL_PATH;
      const v = y > 1 && y < GRID_H - 2 && grid[y - 1][x] === CELL_PATH && grid[y + 1][x] === CELL_PATH;
      if (h || v) candidates.push([x, y]);
    }
  }
  shuffle(candidates);
  for (let i = 0; i < Math.floor(candidates.length * 0.45); i++) {
    const [x, y] = candidates[i];
    grid[y][x] = CELL_PATH;
  }
  grid[picked.exit.y][picked.exit.x] = CELL_EXIT;

  return { maze: grid, spawn: picked.spawn, exit: picked.exit };
}

// ═══════════════════════════════════════════════════════════════
// SUDDEN EVENT HANDLERS (from mechanics.js)
// ═══════════════════════════════════════════════════════════════

function simulateCollapse(state) {
  const { maze, playerPos, exitPos } = state;
  const candidates = [];
  for (let y = 1; y < GRID_H - 1; y++) {
    for (let x = 1; x < GRID_W - 1; x++) {
      if (maze[y][x] !== CELL_PATH) continue;
      if (x === playerPos.x && y === playerPos.y) continue;
      if (x === exitPos.x && y === exitPos.y) continue;
      const pathCount = [[0, -1], [0, 1], [-1, 0], [1, 0]]
        .filter(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H && maze[ny][nx] !== CELL_WALL;
        }).length;
      if (pathCount <= 1) continue;
      candidates.push({ x, y });
    }
  }
  shuffle(candidates);
  const count = Math.min(3 + Math.floor(Math.random() * 3), candidates.length);
  const collapsed = [];
  for (let i = 0; i < count && i < candidates.length; i++) {
    const cell = candidates[i];
    maze[cell.y][cell.x] = CELL_WALL;
    if (!bfsReachable(playerPos.x, playerPos.y, exitPos.x, exitPos.y, maze)) {
      maze[cell.y][cell.x] = CELL_PATH; // rollback
      continue;
    }
    collapsed.push(cell);
  }
  if (collapsed.length === 0) {
    state.suddenEventCount--;
    return 'collapse_noop';
  }
  return 'collapse';
}

function simulateTeleport(state) {
  const visitedCells = [...state.visited]
    .map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; })
    .filter(c => !(c.x === state.playerPos.x && c.y === state.playerPos.y)
                 && state.maze[c.y]?.[c.x] !== CELL_WALL);

  if (visitedCells.length === 0) {
    state.suddenEventCount--;
    return 'teleport_noop';
  }
  const target = visitedCells[Math.floor(Math.random() * visitedCells.length)];
  state.playerPos = { x: target.x, y: target.y };
  const histIdx = state.history.findIndex(h => h.x === target.x && h.y === target.y);
  if (histIdx >= 0) {
    state.history = state.history.slice(0, histIdx + 1);
  } else {
    state.history = [];
  }
  return 'teleport';
}

function simulateRewind(state) {
  if (state.history.length < 5) {
    state.suddenEventCount--;
    return 'rewind_noop';
  }
  const rewindTarget = state.history[state.history.length - 5];
  state.history = state.history.slice(0, state.history.length - 5);
  state.playerPos = { x: rewindTarget.x, y: rewindTarget.y };
  return 'rewind';
}

// ═══════════════════════════════════════════════════════════════
// WALL PUSH SIMULATION (from mechanics.js executeWallPush)
// ═══════════════════════════════════════════════════════════════

function tryWallPush(state) {
  if (state.fragments < 1 || state.wallPushCount >= MAX_WALL_PUSHES) return false;

  const { x, y } = state.playerPos;
  const pushDirs = shuffle([[0, -1], [0, 1], [-1, 0], [1, 0]]);

  for (const [dx, dy] of pushDirs) {
    const wx = x + dx, wy = y + dy;
    // Target must be a wall, within bounds (not border)
    if (wx <= 0 || wy <= 0 || wx >= GRID_W - 1 || wy >= GRID_H - 1) continue;
    if (state.maze[wy][wx] !== CELL_WALL) continue;
    // Cell beyond (2-deep push target)
    const bx = wx + dx, by = wy + dy;
    if (bx <= 0 || by <= 0 || bx >= GRID_W - 1 || by >= GRID_H - 1) continue;

    // Execute wall push
    state.fragments--;
    state.wallPushCount++;
    state.maze[wy][wx] = CELL_PATH;
    if (state.maze[by][bx] === CELL_WALL) {
      state.maze[by][bx] = CELL_PATH;
    }
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
// SINGLE GAME SIMULATION
// ═══════════════════════════════════════════════════════════════

function simulateGame(gameId) {
  const { maze, spawn, exit } = generateMaze();

  const state = {
    maze,
    playerPos: { x: spawn.x, y: spawn.y },
    exitPos: exit,
    fragments: 0,
    hp: 3,
    steps: 0,
    wallPushCount: 0,
    suddenEventCount: 0,
    visited: new Set([posKey(spawn.x, spawn.y)]),
    history: [],
  };

  // Per-game tracking
  const log = {
    fragmentsFromMovement: 0,
    fragmentsFromTemptation: 0,
    wallPushes: 0,
    suddenEvents: { collapse: 0, teleport: 0, rewind: 0 },
    temptations: { intel: 0, fragment: 0, trap: 0 },
    peakFragments: 0,
    reachedExit: false,
    mazeLost: false,
    dead: false,
  };

  // Invariant violations (collected, should be 0)
  const violations = [];

  let stuckCount = 0;

  while (state.steps < MAX_STEPS && state.hp > 0) {
    // BFS path to exit
    let path = bfsPath(state.playerPos.x, state.playerPos.y,
                       state.exitPos.x, state.exitPos.y, state.maze);

    // If no path (shouldn't happen due to collapse safety), try wall push
    if (!path) {
      if (tryWallPush(state)) {
        log.wallPushes++;
        path = bfsPath(state.playerPos.x, state.playerPos.y,
                       state.exitPos.x, state.exitPos.y, state.maze);
      }
      if (!path) {
        violations.push(`Game ${gameId}: No path to exit at step ${state.steps}`);
        break;
      }
    }

    // If path length is 1, we are at the exit
    if (path.length <= 1) {
      log.reachedExit = true;
      break;
    }

    // Decide next move — follow BFS path, but sometimes explore
    let nextPos = path[1]; // next step toward exit
    const isNewCell = !state.visited.has(posKey(nextPos.x, nextPos.y));

    // Simulate being "stuck" at dead end: if only 1 walkable neighbor (the one we came from)
    const neighbors = getWalkableNeighbors(state.playerPos.x, state.playerPos.y, state.maze);
    const forwardNeighbors = neighbors.filter(n =>
      state.history.length === 0 ||
      !(n.x === state.history[state.history.length - 1]?.x && n.y === state.history[state.history.length - 1]?.y)
    );

    if (forwardNeighbors.length === 0 && state.fragments >= 1 && state.wallPushCount < MAX_WALL_PUSHES) {
      // Dead end — try wall push
      if (tryWallPush(state)) {
        log.wallPushes++;
        // Re-BFS after wall push
        path = bfsPath(state.playerPos.x, state.playerPos.y,
                       state.exitPos.x, state.exitPos.y, state.maze);
        if (path && path.length > 1) {
          nextPos = path[1];
        } else if (path && path.length <= 1) {
          log.reachedExit = true;
          break;
        }
      }
    }

    // Move
    state.history.push({ x: state.playerPos.x, y: state.playerPos.y });
    state.playerPos = { x: nextPos.x, y: nextPos.y };
    state.steps++;
    const cellIsNew = !state.visited.has(posKey(nextPos.x, nextPos.y));
    state.visited.add(posKey(nextPos.x, nextPos.y));

    // Check if we reached exit
    if (state.maze[nextPos.y][nextPos.x] === CELL_EXIT) {
      log.reachedExit = true;
      break;
    }

    // ── Feature 1: Memory Fragment spawning (20% on NEW cell) ──
    if (cellIsNew && state.fragments < MAX_FRAGMENTS && Math.random() < FRAGMENT_SPAWN_CHANCE) {
      state.fragments++;
      log.fragmentsFromMovement++;
      if (state.fragments > log.peakFragments) log.peakFragments = state.fragments;
    }

    // ── Invariant check: fragments ──
    if (state.fragments > MAX_FRAGMENTS) {
      violations.push(`Game ${gameId} step ${state.steps}: fragments=${state.fragments} > MAX(${MAX_FRAGMENTS})`);
    }

    // ── Feature 5: Sudden Events (8% after step 15, max 3) ──
    if (state.steps >= SUDDEN_EVENT_MIN_STEP
        && state.suddenEventCount < MAX_SUDDEN_EVENTS
        && Math.random() < SUDDEN_EVENT_CHANCE) {
      state.suddenEventCount++;
      const roll = Math.random();
      if (roll < 0.40) {
        const result = simulateCollapse(state);
        if (result === 'collapse') log.suddenEvents.collapse++;
        // Invariant: after collapse, exit must be reachable
        if (!bfsReachable(state.playerPos.x, state.playerPos.y, state.exitPos.x, state.exitPos.y, state.maze)) {
          violations.push(`Game ${gameId} step ${state.steps}: Exit unreachable after collapse!`);
        }
      } else if (roll < 0.75) {
        const result = simulateTeleport(state);
        if (result === 'teleport') log.suddenEvents.teleport++;
      } else {
        const result = simulateRewind(state);
        if (result === 'rewind') log.suddenEvents.rewind++;
      }

      // Invariant check: suddenEventCount
      if (state.suddenEventCount > MAX_SUDDEN_EVENTS) {
        violations.push(`Game ${gameId} step ${state.steps}: suddenEventCount=${state.suddenEventCount} > MAX(${MAX_SUDDEN_EVENTS})`);
      }
    }

    // ── Feature 4: Temptation every ~5 steps (3-way split) ──
    if (state.steps > 0 && state.steps % 5 === 0) {
      // Player follows temptation 50% of the time
      if (Math.random() < 0.50) {
        const roll = Math.random();
        const getsIntel = roll < 0.55;
        const getsFragment = !getsIntel && roll < 0.75 && state.fragments < MAX_FRAGMENTS;
        // else: trap

        if (getsFragment) {
          state.fragments++;
          log.fragmentsFromTemptation++;
          log.temptations.fragment++;
          if (state.fragments > log.peakFragments) log.peakFragments = state.fragments;
        } else if (getsIntel) {
          log.temptations.intel++;
          // Intel: no gameplay effect in simulation (player gets directional hint)
        } else {
          // Trap: HP - 1
          state.hp = Math.max(0, state.hp - 1);
          log.temptations.trap++;
          if (state.hp <= 0) {
            log.dead = true;
            break;
          }
        }
      }

      // Invariant check: fragments after temptation
      if (state.fragments > MAX_FRAGMENTS) {
        violations.push(`Game ${gameId} step ${state.steps}: fragments=${state.fragments} > MAX after temptation`);
      }
    }

    // Prevent infinite loop safety valve
    stuckCount++;
    if (stuckCount > MAX_STEPS + 20) break;
  }

  if (state.steps >= MAX_STEPS && !log.reachedExit && !log.dead) {
    log.mazeLost = true;
  }

  // Invariant: wallPushCount
  if (state.wallPushCount > MAX_WALL_PUSHES) {
    violations.push(`Game ${gameId}: wallPushCount=${state.wallPushCount} > MAX(${MAX_WALL_PUSHES})`);
  }

  // Final invariant: verify no border walls were broken
  for (let x = 0; x < GRID_W; x++) {
    if (state.maze[0][x] === CELL_PATH) violations.push(`Game ${gameId}: Border wall broken at (${x},0)`);
    if (state.maze[GRID_H - 1][x] === CELL_PATH) violations.push(`Game ${gameId}: Border wall broken at (${x},${GRID_H - 1})`);
  }
  for (let y = 0; y < GRID_H; y++) {
    if (state.maze[y][0] === CELL_PATH) violations.push(`Game ${gameId}: Border wall broken at (0,${y})`);
    if (state.maze[y][GRID_W - 1] === CELL_PATH) violations.push(`Game ${gameId}: Border wall broken at (${GRID_W - 1},${y})`);
  }

  return {
    gameId,
    steps: state.steps,
    finalHp: state.hp,
    fragments: state.fragments,
    wallPushCount: state.wallPushCount,
    suddenEventCount: state.suddenEventCount,
    log,
    violations,
  };
}

// ═══════════════════════════════════════════════════════════════
// RUN 100 GAMES
// ═══════════════════════════════════════════════════════════════

console.log(`\n${'='.repeat(60)}`);
console.log(`  ClawTrap Gameplay Simulation  (${NUM_GAMES} games)`);
console.log(`${'='.repeat(60)}\n`);

const results = [];
for (let i = 0; i < NUM_GAMES; i++) {
  results.push(simulateGame(i));
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS
// ═══════════════════════════════════════════════════════════════

const N = results.length;

// Basic averages
const avgFragments = (results.reduce((a, r) => a + (r.log.fragmentsFromMovement + r.log.fragmentsFromTemptation), 0) / N).toFixed(2);
const avgWallPushes = (results.reduce((a, r) => a + r.log.wallPushes, 0) / N).toFixed(2);
const avgSuddenEvents = (results.reduce((a, r) => a + r.log.suddenEvents.collapse + r.log.suddenEvents.teleport + r.log.suddenEvents.rewind, 0) / N).toFixed(2);
const avgFinalHp = (results.reduce((a, r) => a + r.finalHp, 0) / N).toFixed(2);
const avgSteps = (results.reduce((a, r) => a + r.steps, 0) / N).toFixed(1);

// Fragment source breakdown
const totalFragMovement = results.reduce((a, r) => a + r.log.fragmentsFromMovement, 0);
const totalFragTemptation = results.reduce((a, r) => a + r.log.fragmentsFromTemptation, 0);
const totalFragAll = totalFragMovement + totalFragTemptation;

// Sudden event type breakdown
const totalCollapse = results.reduce((a, r) => a + r.log.suddenEvents.collapse, 0);
const totalTeleport = results.reduce((a, r) => a + r.log.suddenEvents.teleport, 0);
const totalRewind = results.reduce((a, r) => a + r.log.suddenEvents.rewind, 0);
const totalSuddenAll = totalCollapse + totalTeleport + totalRewind;

// Temptation breakdown
const totalTemptIntel = results.reduce((a, r) => a + r.log.temptations.intel, 0);
const totalTemptFrag = results.reduce((a, r) => a + r.log.temptations.fragment, 0);
const totalTemptTrap = results.reduce((a, r) => a + r.log.temptations.trap, 0);
const totalTemptAll = totalTemptIntel + totalTemptFrag + totalTemptTrap;

// Milestone counts
const gamesAllWallPushes = results.filter(r => r.wallPushCount >= 3).length;
const gamesHitFragCap = results.filter(r => r.log.peakFragments >= MAX_FRAGMENTS).length;
const gamesReachedExit = results.filter(r => r.log.reachedExit).length;
const gamesMazeLost = results.filter(r => r.log.mazeLost).length;
const gamesDead = results.filter(r => r.log.dead).length;

// HP distribution
const hpDist = { 0: 0, 1: 0, 2: 0, 3: 0 };
results.forEach(r => { hpDist[Math.max(0, Math.min(3, r.finalHp))]++; });

// All invariant violations
const allViolations = results.flatMap(r => r.violations);

// ═══════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════

function pct(n, total) { return total > 0 ? ((n / total) * 100).toFixed(1) + '%' : '0.0%'; }
function bar(n, total, width = 30) {
  const filled = total > 0 ? Math.round((n / total) * width) : 0;
  return '#'.repeat(filled) + '-'.repeat(width - filled);
}

console.log('-- GAME OUTCOMES --');
console.log(`  Reached exit:   ${gamesReachedExit}/${N} (${pct(gamesReachedExit, N)})`);
console.log(`  Maze lost (66): ${gamesMazeLost}/${N} (${pct(gamesMazeLost, N)})`);
console.log(`  Died (HP=0):    ${gamesDead}/${N} (${pct(gamesDead, N)})`);
console.log(`  Avg steps:      ${avgSteps}`);
console.log('');

console.log('-- FRAGMENT STATISTICS --');
console.log(`  Avg fragments found/game: ${avgFragments}`);
console.log(`  Source breakdown (total ${totalFragAll}):`);
console.log(`    Movement (20% new cell): ${totalFragMovement} (${pct(totalFragMovement, totalFragAll)})  [${bar(totalFragMovement, totalFragAll, 20)}]`);
console.log(`    Temptation (20% split):  ${totalFragTemptation} (${pct(totalFragTemptation, totalFragAll)})  [${bar(totalFragTemptation, totalFragAll, 20)}]`);
console.log(`  Games hitting fragment cap (${MAX_FRAGMENTS}): ${gamesHitFragCap}/${N} (${pct(gamesHitFragCap, N)})`);
console.log('');

console.log('-- WALL PUSH STATISTICS --');
console.log(`  Avg wall pushes/game: ${avgWallPushes}`);
console.log(`  Games using all ${MAX_WALL_PUSHES} pushes: ${gamesAllWallPushes}/${N} (${pct(gamesAllWallPushes, N)})`);
console.log('');

console.log('-- SUDDEN EVENT STATISTICS --');
console.log(`  Avg sudden events/game: ${avgSuddenEvents}`);
console.log(`  Type breakdown (total ${totalSuddenAll}):`);
console.log(`    Collapse (40%): ${totalCollapse} (${pct(totalCollapse, totalSuddenAll)})  [${bar(totalCollapse, totalSuddenAll, 20)}]`);
console.log(`    Teleport (35%): ${totalTeleport} (${pct(totalTeleport, totalSuddenAll)})  [${bar(totalTeleport, totalSuddenAll, 20)}]`);
console.log(`    Rewind   (25%): ${totalRewind} (${pct(totalRewind, totalSuddenAll)})  [${bar(totalRewind, totalSuddenAll, 20)}]`);
console.log('');

console.log('-- TEMPTATION STATISTICS --');
console.log(`  Total temptation outcomes: ${totalTemptAll} (player followed 50% of time)`);
console.log(`    Intel    (55%): ${totalTemptIntel} (${pct(totalTemptIntel, totalTemptAll)})  [${bar(totalTemptIntel, totalTemptAll, 20)}]`);
console.log(`    Fragment (20%): ${totalTemptFrag} (${pct(totalTemptFrag, totalTemptAll)})  [${bar(totalTemptFrag, totalTemptAll, 20)}]`);
console.log(`    Trap     (25%): ${totalTemptTrap} (${pct(totalTemptTrap, totalTemptAll)})  [${bar(totalTemptTrap, totalTemptAll, 20)}]`);
console.log('');

console.log('-- HP STATISTICS --');
console.log(`  Avg final HP: ${avgFinalHp}`);
console.log(`  Final HP distribution:`);
[3, 2, 1, 0].forEach(h => {
  console.log(`    HP=${h}:  ${bar(hpDist[h], N, 25)} ${hpDist[h]}/${N} (${pct(hpDist[h], N)})`);
});
console.log('');

// ═══════════════════════════════════════════════════════════════
// INVARIANT VERIFICATION
// ═══════════════════════════════════════════════════════════════

console.log('-- INVARIANT VERIFICATION --');
const checks = [
  { name: 'fragments never exceed MAX_FRAGMENTS (5)',  pass: results.every(r => r.fragments <= MAX_FRAGMENTS && r.log.peakFragments <= MAX_FRAGMENTS) },
  { name: 'wallPushCount never exceeds MAX_WALL_PUSHES (3)', pass: results.every(r => r.wallPushCount <= MAX_WALL_PUSHES) },
  { name: 'suddenEventCount never exceeds MAX_SUDDEN_EVENTS (3)', pass: results.every(r => r.suddenEventCount <= MAX_SUDDEN_EVENTS) },
  { name: 'exit always reachable after collapse (BFS)',  pass: allViolations.filter(v => v.includes('unreachable')).length === 0 },
  { name: 'no border walls broken by wall push',        pass: allViolations.filter(v => v.includes('Border wall')).length === 0 },
];

let allPass = true;
for (const check of checks) {
  const status = check.pass ? 'PASS' : 'FAIL';
  if (!check.pass) allPass = false;
  console.log(`  [${status}] ${check.name}`);
}
console.log('');

if (allViolations.length > 0) {
  console.log(`  VIOLATIONS FOUND (${allViolations.length}):`);
  allViolations.slice(0, 20).forEach(v => console.log(`    - ${v}`));
  if (allViolations.length > 20) console.log(`    ... and ${allViolations.length - 20} more`);
} else {
  console.log('  No violations detected across all games.');
}

console.log('');
console.log(`${'='.repeat(60)}`);
console.log(`  Result: ${allPass ? 'ALL INVARIANTS PASSED' : 'INVARIANT FAILURES DETECTED'}`);
console.log(`${'='.repeat(60)}\n`);

process.exit(allPass ? 0 : 1);
