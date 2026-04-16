'use strict';
// ═══════════════════════════════════════════════════════════════
// FULL GAME SIMULATOR — 10 complete games with player AI + villain AI
// Simulates all 5 new features: fragments, wall push, counter-question,
// temptation 3-way, sudden events, plus full card deck and trial system
// ═══════════════════════════════════════════════════════════════

const GRID_W = 15, GRID_H = 19;
const CELL_WALL = 0, CELL_PATH = 1, CELL_EXIT = 2;
const MAX_FRAGMENTS = 5, MAX_WALL_PUSHES = 3, MAX_SUDDEN_EVENTS = 3;
const MAX_STEPS = 66;

// ── Player personality profiles (varied across games) ──
const PLAYER_PROFILES = [
  { name: '谨慎型', temptFollow: 0.25, cqThreshold: 2, pushWhenStuck: 0.8, backtrackRate: 0.3, desc: '很少跟随诱惑，善于使用碎片反问' },
  { name: '冒险型', temptFollow: 0.75, cqThreshold: 1, pushWhenStuck: 0.5, backtrackRate: 0.1, desc: '积极追随诱惑，喜欢正面冲突' },
  { name: '探索型', temptFollow: 0.50, cqThreshold: 3, pushWhenStuck: 0.95, backtrackRate: 0.2, desc: '热衷推墙探索新路径，收集碎片' },
  { name: '速通型', temptFollow: 0.15, cqThreshold: 5, pushWhenStuck: 0.6, backtrackRate: 0.05, desc: '目标导向，快速前进，少交互' },
  { name: '固执型', temptFollow: 0.60, cqThreshold: 1, pushWhenStuck: 0.3, backtrackRate: 0.4, desc: '反复尝试试炼，不轻易放弃' },
  { name: '资源囤积型', temptFollow: 0.45, cqThreshold: 4, pushWhenStuck: 0.2, backtrackRate: 0.15, desc: '囤积碎片不舍得用，到最后才用' },
  { name: '反抗型', temptFollow: 0.35, cqThreshold: 1, pushWhenStuck: 0.7, backtrackRate: 0.25, desc: '一有机会就反问，喜欢对抗villain' },
  { name: '随机型', temptFollow: 0.50, cqThreshold: 2, pushWhenStuck: 0.5, backtrackRate: 0.2, desc: '决策随机，模拟真实新手' },
  { name: '恐惧型', temptFollow: 0.10, cqThreshold: 3, pushWhenStuck: 0.9, backtrackRate: 0.5, desc: '频繁后退，害怕诱惑，依赖推墙' },
  { name: '贪婪型', temptFollow: 0.85, cqThreshold: 2, pushWhenStuck: 0.4, backtrackRate: 0.15, desc: '几乎每次都追随诱惑，贪图碎片奖励' },
];

// ── Director Deck (exact copy) ──
const DIRECTOR_DECK = [
  { role:'relief', dealer:'EMPTY' },
  { role:'temptation', dealer:'BREADCRUMB' },
  { role:'trial', dealer:'MINIGAME', difficulty:'medium' },
  { role:'pressure', dealer:'JUMPSCARE' },
  { role:'truth', dealer:'REVELATION', flag:'mazeRemembersBacktrack' },
  { role:'trial', dealer:'MINIGAME', difficulty:'medium' },
  { role:'temptation', dealer:'BEAUTY_TRAP' },
  { role:'trial', dealer:'MINIGAME', difficulty:'medium' },
  { role:'pressure', dealer:'WALL_CLOSE' },
  { role:'relief', dealer:'EMPTY' },
  { role:'temptation', dealer:'REWARD_MIRAGE' },
  { role:'trial', dealer:'MINIGAME', difficulty:'medium' },
  { role:'pressure', dealer:'SHADOW_CHASE' },
  { role:'truth', dealer:'REVELATION', flag:'agentIsAdversarial' },
  { role:'trial', dealer:'MINIGAME', difficulty:'medium' },
  { role:'relief', dealer:'EMPTY' },
  { role:'temptation', dealer:'FAKE_EXIT' },
  { role:'trial', dealer:'MINIGAME', difficulty:'medium' },
  { role:'pressure', dealer:'COUNTDOWN' },
  { role:'payoff', dealer:'PAYOFF' },
  { role:'trial', dealer:'MINIGAME', difficulty:'hard' },
  { role:'pressure', dealer:'MEMORY_SCRAMBLE' },
  { role:'trial', dealer:'MINIGAME', difficulty:'hard' },
  { role:'truth', dealer:'REVELATION', flag:'exitIsConditional' },
  { role:'temptation', dealer:'FAKE_EXIT' },
  { role:'trial', dealer:'MINIGAME', difficulty:'hard' },
  { role:'pressure', dealer:'SHADOW_CHASE' },
  { role:'trial', dealer:'MINIGAME', difficulty:'hard' },
  { role:'truth', dealer:'REVELATION', flag:'agentJudgesAnswers' },
  { role:'relief', dealer:'EMPTY' },
];

// ── Villain speech pools ──
const VILLAIN_SPEECH = {
  card_calm: ['……安静了。', '享受这片刻的宁静吧。', '你以为喘息是免费的？'],
  card_blocker: ['路，越来越窄了。', '你听到了吗？墙在移动。', '别回头。'],
  card_lure: ['有什么东西在闪……', '你不好奇吗？', '它在叫你。'],
  card_drain: ['回答我。', '让我看看你还记得什么。', '这次你跑不掉。'],
  trial_pass: ['……算你走运。', '这次不算。', '下一次不会这么简单。'],
  trial_fail: ['不够。', '你在敷衍。', '这就是你的答案？'],
  counter_question_win: ['……你怎么知道的。', '……我没有答案。', '这不公平。'],
  counter_question_lose: ['你以为这样就能难倒我？', '我什么都知道。', '白费碎片。'],
  fragment_found: ['你在收集什么？碎片救不了你。', '又一块……你以为这些有用？', '……'],
  wall_push: ['你——你在做什么？！', '那面墙不该被推倒。', '好吧。但路不一定通向你想去的地方。'],
  collapse: ['迷宫在呼吸。', '路变少了。', '……哈。'],
  teleport: ['你以为方向是固定的？', '找路吧。再一次。', '迷宫为自己而存在。'],
  rewind: ['让我们重来。', '一切都是徒劳的。', '你走过的路，我都记得。'],
  tempt_fragment: ['你竟然从诱惑中带走了什么。', '……有意思。', '碎片不会让你自由。'],
  tempt_trap: ['贪心有代价。', '我说过了，别碰。', '又少了一格生命。'],
  tempt_intel: ['线索？也许是真的。也许不是。', '往那边走吧。如果你信我的话。', '你在用我给的情报？有趣。'],
  low_hp: ['你还剩多少？', '我能闻到恐惧的味道。', '下一步，可能是最后一步。'],
  near_exit: ['你以为出口在那里？', '别高兴太早。', '……条件还没满足。'],
  jumpscare: ['!!!', '——在你身后。', '别愣着。快跑。'],
  shadow_chase: ['影子在追你。别回头。', '往后退一步就要付出代价。', '它越来越近了。'],
  wall_close: ['这条路，封了。', '找别的路吧。', '你的选择越来越少。'],
  countdown: ['倒计时开始了。', '滴答。滴答。', '时间在流逝。'],
  memory_scramble: ['方向……你还分得清吗？', '标记都乱了。', '哪边是哪边？'],
};

function rng() { return Math.random(); }
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function shuffle(arr) { for (let i=arr.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
function posKey(x,y) { return `${x},${y}`; }

// ── Maze generation (same as core.js) ──
function generateMaze() {
  const grid = Array.from({ length: GRID_H }, () => Array(GRID_W).fill(CELL_WALL));
  const configs = [
    { spawn: {x:1, y:1}, exit: {x:GRID_W-2, y:GRID_H-2} },
    { spawn: {x:GRID_W-2, y:1}, exit: {x:1, y:GRID_H-2} },
    { spawn: {x:1, y:GRID_H-2}, exit: {x:GRID_W-2, y:1} },
  ];
  const picked = pick(configs);
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
  for (let y=1;y<GRID_H-1;y++) for (let x=1;x<GRID_W-1;x++) {
    if (grid[y][x] !== CELL_WALL) continue;
    const h = x>1 && x<GRID_W-2 && grid[y][x-1]===CELL_PATH && grid[y][x+1]===CELL_PATH;
    const v = y>1 && y<GRID_H-2 && grid[y-1][x]===CELL_PATH && grid[y+1][x]===CELL_PATH;
    if (h || v) candidates.push([x,y]);
  }
  shuffle(candidates);
  for (let i=0;i<Math.floor(candidates.length*0.45);i++) grid[candidates[i][1]][candidates[i][0]] = CELL_PATH;
  grid[picked.exit.y][picked.exit.x] = CELL_EXIT;
  return { maze: grid, spawn: picked.spawn, exit: picked.exit };
}

function getNeighbors(maze, x, y) {
  return [[0,-1,'北'],[0,1,'南'],[-1,0,'西'],[1,0,'东']]
    .map(([dx,dy,dir]) => ({x:x+dx,y:y+dy,dx,dy,dir}))
    .filter(n => n.x>=0 && n.x<GRID_W && n.y>=0 && n.y<GRID_H && maze[n.y][n.x]!==CELL_WALL);
}

function bfs(maze, from, to) {
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
  return [[0,-1,'北'],[0,1,'南'],[-1,0,'西'],[1,0,'东']]
    .filter(([dx,dy]) => {
      const wx=x+dx, wy=y+dy, bx=x+dx*2, by=y+dy*2;
      return wx>0 && wy>0 && wx<GRID_W-1 && wy<GRID_H-1 && maze[wy][wx]===CELL_WALL
        && bx>0 && by>0 && bx<GRID_W-1 && by<GRID_H-1;
    })
    .map(([dx,dy,dir]) => ({wx:x+dx,wy:y+dy,bx:x+dx*2,by:y+dy*2,dir}));
}

// ═══════════════════════════════════════════════════════════════
// GAME ENGINE
// ═══════════════════════════════════════════════════════════════
function simulateGame(gameNum, profile) {
  const { maze, spawn, exit } = generateMaze();
  const log = [];
  const state = {
    pos: { ...spawn }, exit: { ...exit },
    steps: 0, depth: 0, hp: 3, fragments: 0,
    wallPushCount: 0, suddenEventCount: 0,
    history: [], visited: new Set([posKey(spawn.x, spawn.y)]),
    deckIdx: 0, stepsSinceLastTrial: 99, trialCount: 0,
    knowledgeFlags: { mazeRemembersBacktrack: false, agentIsAdversarial: false, exitIsConditional: false, agentJudgesAnswers: false },
    effects: { wallCloseSteps: 0, wallCloseDir: null, shadowChaseSteps: 0, countdownSteps: 0, echoLoopSteps: 0, memoryScrambleSteps: 0 },
    trialFailsThisGame: 0, trialPassesThisGame: 0,
    fragmentsFromMovement: 0, fragmentsFromTemptation: 0,
    temptFollowed: 0, temptIgnored: 0,
    counterQuestionsUsed: 0, counterQuestionsWon: 0,
    suddenCollapses: 0, suddenTeleports: 0, suddenRewinds: 0,
    totalBacktracks: 0,
  };
  let outcome = 'trapped'; // default

  function addLog(type, text, villainSpeech) {
    log.push({ step: state.steps, type, text, villain: villainSpeech || '' });
  }

  function drawCard() {
    let card = DIRECTOR_DECK[state.deckIdx];
    state.deckIdx++;
    if (state.deckIdx >= DIRECTOR_DECK.length) state.deckIdx = 20; // loop cycle 3
    // Skip logic
    if (card.role === 'truth' && card.flag && state.knowledgeFlags[card.flag]) return drawCard();
    if (card.role === 'trial' && state.stepsSinceLastTrial < 4) { state.stepsSinceLastTrial++; return drawCard(); }
    return card;
  }

  function villainSay(pool) { return pick(VILLAIN_SPEECH[pool] || ['……']); }

  // ── Main game loop ──
  addLog('start', `第${gameNum}局开始 | 玩家性格: ${profile.name} (${profile.desc})`, '你回来了。这次能走出去吗？');

  while (state.steps < MAX_STEPS && state.hp > 0) {
    // 1. Choose next move
    const neighbors = getNeighbors(maze, state.pos.x, state.pos.y);
    if (neighbors.length === 0) { addLog('stuck', '无路可走！', '……结束了。'); break; }

    // Wall push consideration: if no good forward path, consider pushing
    const pathToExit = bfs(maze, state.pos, state.exit);
    const isEffectivelyStuck = !pathToExit || (pathToExit.length > (MAX_STEPS - state.steps) * 0.8);
    if (isEffectivelyStuck && state.fragments >= 1 && state.wallPushCount < MAX_WALL_PUSHES && rng() < profile.pushWhenStuck) {
      const walls = getAdjacentWalls(maze, state.pos.x, state.pos.y);
      if (walls.length > 0) {
        const w = pick(walls);
        maze[w.wy][w.wx] = CELL_PATH;
        if (maze[w.by][w.bx] === CELL_WALL) maze[w.by][w.bx] = CELL_PATH;
        state.fragments--;
        state.wallPushCount++;
        const speech = villainSay('wall_push');
        addLog('wall_push', `推墙 ${w.dir}方向！消耗1碎片（剩余${state.fragments}）| 推墙次数 ${state.wallPushCount}/${MAX_WALL_PUSHES}`, speech);
      }
    }

    // Choose direction: prefer unexplored, sometimes backtrack
    const prev = state.history.length > 0 ? state.history[state.history.length-1] : null;
    const unvisited = neighbors.filter(n => !state.visited.has(posKey(n.x, n.y)));
    const exitNeighbor = neighbors.find(n => maze[n.y][n.x] === CELL_EXIT);
    // During shadow chase, NEVER backtrack (survival instinct)
    const canBacktrack = state.effects.shadowChaseSteps <= 0;
    const forwardNeighbors = prev ? neighbors.filter(n => !(n.x===prev.x && n.y===prev.y)) : neighbors;
    let chosen;
    if (exitNeighbor && Object.values(state.knowledgeFlags).filter(v=>v).length >= 2 && state.depth >= 6) {
      chosen = exitNeighbor; // Go to exit if conditions met
    } else if (unvisited.length > 0 && rng() > profile.backtrackRate) {
      chosen = pick(unvisited);
    } else if (canBacktrack && rng() < profile.backtrackRate && prev) {
      const backNeighbor = neighbors.find(n => n.x === prev.x && n.y === prev.y);
      chosen = backNeighbor || pick(neighbors);
      if (backNeighbor) state.totalBacktracks++;
    } else {
      chosen = forwardNeighbors.length > 0 ? pick(forwardNeighbors) : pick(neighbors);
    }

    const isBack = prev && chosen.x === prev.x && chosen.y === prev.y;
    const isNewCell = !state.visited.has(posKey(chosen.x, chosen.y));

    // Update position
    if (!isBack) state.history.push({ x: state.pos.x, y: state.pos.y });
    else if (state.history.length > 0) state.history.pop();
    state.pos = { x: chosen.x, y: chosen.y };
    state.steps++;
    state.depth = state.history.length;
    state.visited.add(posKey(chosen.x, chosen.y));
    state.stepsSinceLastTrial++;

    // ── Pressure effects tick ──
    if (state.effects.shadowChaseSteps > 0) {
      if (isBack) {
        state.hp--;
        addLog('shadow_hit', `影子追击！后退被惩罚 HP-1 (${state.hp}/3)`, villainSay('shadow_chase'));
        if (state.hp <= 0) { outcome = 'death'; addLog('death', 'HP 归零，死亡。', '终于结束了。'); break; }
      }
      state.effects.shadowChaseSteps--;
    }
    if (state.effects.wallCloseSteps > 0) state.effects.wallCloseSteps--;
    if (state.effects.countdownSteps > 0) {
      state.effects.countdownSteps--;
      if (state.effects.countdownSteps <= 0) {
        // Check if depth increased enough
        if (state.depth <= state.effects.countdownStartDepth) {
          state.hp--;
          addLog('countdown_fail', `倒计时到期！未能前进足够距离 HP-1 (${state.hp}/3)`, villainSay('countdown'));
          if (state.hp <= 0) { outcome = 'death'; addLog('death', 'HP 归零，死亡。', '时间到了。'); break; }
        }
      }
    }
    if (state.effects.echoLoopSteps > 0) state.effects.echoLoopSteps--;
    if (state.effects.memoryScrambleSteps > 0) state.effects.memoryScrambleSteps--;

    // ── Check exit ──
    if (maze[chosen.y][chosen.x] === CELL_EXIT) {
      const flagCount = Object.values(state.knowledgeFlags).filter(v=>v).length;
      if (flagCount >= 2 && state.depth >= 6) {
        outcome = 'escape';
        addLog('escape', `到达出口！${state.steps}步逃脱 | HP=${state.hp} | 碎片=${state.fragments}`, '……不。不！你——');
        break;
      } else {
        addLog('locked_exit', `出口被锁！条件: 知识旗帜 ${flagCount}/2, 深度 ${state.depth}/6`, '还差得远呢。');
      }
    }

    // ── Fragment spawning (20% on new cell, no mechanism card this move) ──
    const card = drawCard();
    const hasMechanism = card.role !== 'relief' && card.dealer !== 'EMPTY';

    if (!isBack && isNewCell && !hasMechanism && state.fragments < MAX_FRAGMENTS && rng() < 0.20) {
      state.fragments++;
      state.fragmentsFromMovement++;
      addLog('fragment', `发现记忆碎片！（${state.fragments}/${MAX_FRAGMENTS}）`, villainSay('fragment_found'));
    }

    // ── Sudden Events (8% after step 15) ──
    if (state.steps >= 15 && state.suddenEventCount < MAX_SUDDEN_EVENTS && !hasMechanism && rng() < 0.08) {
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
          if (!bfs(maze, state.pos, exit)) { maze[c.y][c.x] = CELL_PATH; continue; }
          collapsed++;
        }
        if (collapsed > 0) {
          state.suddenCollapses++;
          addLog('collapse', `迷宫坍塌！${collapsed}条通道被封锁`, villainSay('collapse'));
        } else { state.suddenEventCount--; }
      } else if (eventRoll < 0.75) {
        // Teleport
        const cells = [...state.visited].map(k=>{const[x,y]=k.split(',').map(Number);return{x,y};})
          .filter(c=>!(c.x===state.pos.x&&c.y===state.pos.y)&&maze[c.y]?.[c.x]!==CELL_WALL);
        if (cells.length > 0) {
          const target = pick(cells);
          state.pos = target;
          state.history = [];
          state.depth = 0;
          state.suddenTeleports++;
          addLog('teleport', `空间错位！被传送到 (${target.x},${target.y})`, villainSay('teleport'));
        } else { state.suddenEventCount--; }
      } else {
        // Rewind
        if (state.history.length >= 5) {
          const target = state.history[state.history.length - 5];
          state.history = state.history.slice(0, state.history.length - 5);
          state.pos = target;
          state.depth = state.history.length;
          state.suddenRewinds++;
          addLog('rewind', `时间倒流！回到5步前的位置 (${target.x},${target.y})`, villainSay('rewind'));
        } else { state.suddenEventCount--; }
      }
    }

    // ── Process card ──
    const cardType = { relief:'calm', temptation:'lure', pressure:'blocker', trial:'drain', truth:'calm', payoff:'calm' }[card.role] || 'calm';

    if (card.role === 'truth' && card.flag) {
      state.knowledgeFlags[card.flag] = true;
      const flagNames = { mazeRemembersBacktrack:'迷宫记得你的退路', agentIsAdversarial:'AI是你的敌人', exitIsConditional:'出口有条件', agentJudgesAnswers:'AI在审判你的答案' };
      addLog('truth', `真相揭示: ${flagNames[card.flag] || card.flag}`, '现在你知道了。但知道有什么用？');
    } else if (card.role === 'temptation') {
      // Player decides: follow or ignore (smarter at low HP)
      const effectiveTemptRate = state.hp <= 1 ? profile.temptFollow * 0.3 : profile.temptFollow;
      if (rng() < effectiveTemptRate) {
        state.temptFollowed++;
        const roll = rng();
        if (roll < 0.55) {
          addLog('tempt_intel', `跟随诱惑(${card.dealer}) → 获得方向线索`, villainSay('tempt_intel'));
        } else if (roll < 0.75 && state.fragments < MAX_FRAGMENTS) {
          state.fragments++;
          state.fragmentsFromTemptation++;
          addLog('tempt_fragment', `跟随诱惑(${card.dealer}) → 获得记忆碎片！(${state.fragments}/${MAX_FRAGMENTS})`, villainSay('tempt_fragment'));
        } else {
          state.hp--;
          addLog('tempt_trap', `跟随诱惑(${card.dealer}) → 陷阱！HP-1 (${state.hp}/3)`, villainSay('tempt_trap'));
          if (state.hp <= 0) { outcome = 'death'; addLog('death', 'HP 归零，死亡。', '贪心是致命的。'); break; }
        }
      } else {
        state.temptIgnored++;
        addLog('tempt_ignore', `无视诱惑(${card.dealer})`, '……聪明。或者说，胆小。');
      }
    } else if (card.role === 'trial') {
      state.trialCount++;
      state.stepsSinceLastTrial = 0;
      let trialResolved = false;
      let failsThisTrial = 0;
      const trialPrompt = pick(['这个文件对你意味着什么？', '你为什么写了这段话？', '这张图片背后的故事是什么？', '你最害怕失去什么？', '你对这段代码满意吗？', '你的时间都花在哪了？']);
      addLog('trial_start', `试炼 #${state.trialCount}: "${trialPrompt}" (难度:${card.difficulty || 'medium'})`, villainSay('card_drain'));

      while (!trialResolved && state.hp > 0) {
        // Real game: open-ended questions ("认真回答即pass"). Thoughtful players pass 85-90%.
        // Hard trials have stricter eval guides. Retries help (player reads hints, iterates).
        const passRate = card.difficulty === 'hard' ? 0.65 : 0.88;
        const passed = rng() < Math.min(0.97, passRate + failsThisTrial * 0.15);

        if (passed) {
          state.trialPassesThisGame++;
          trialResolved = true;
          addLog('trial_pass', `试炼通过！（尝试 ${failsThisTrial + 1} 次）`, villainSay('trial_pass'));
        } else {
          failsThisTrial++;
          state.trialFailsThisGame++;

          // Counter-question attempt?
          if (failsThisTrial >= profile.cqThreshold && state.fragments >= 2 && rng() < 0.7) {
            state.fragments -= 2;
            state.counterQuestionsUsed++;
            const cqWin = rng() < 0.40; // 40% success rate
            if (cqWin) {
              state.counterQuestionsWon++;
              trialResolved = true;
              addLog('counter_question_win', `反问成功！消耗2碎片（剩余${state.fragments}）`, villainSay('counter_question_win'));
            } else {
              addLog('counter_question_lose', `反问失败。消耗2碎片（剩余${state.fragments}）`, villainSay('counter_question_lose'));
            }
          } else {
            // HP cost follows actual game logic (judge.js computeHpCost):
            //   Trial 1: 0 cost (learning period)
            //   Trial 2-3: first fail costs 1, subsequent free
            //   Trial 4+: every fail costs 1
            let hpCost = 0;
            if (state.trialCount <= 1) hpCost = 0;
            else if (state.trialCount <= 3) hpCost = (failsThisTrial === 1) ? 1 : 0;
            else hpCost = 1;

            if (hpCost > 0) {
              state.hp -= hpCost;
              addLog('trial_fail', `试炼失败 #${failsThisTrial}，HP-${hpCost} (${state.hp}/3)`, villainSay('trial_fail'));
              if (state.hp <= 0) { outcome = 'death'; addLog('death', '试炼中HP归零。', '你没有答案。你从来没有。'); trialResolved = true; break; }
            } else {
              addLog('trial_fail_free', `试炼失败 #${failsThisTrial}（${state.trialCount<=1?'首次试炼':'重复失败'}，不扣HP）`, villainSay('trial_fail'));
            }
          }

          // Give up: retreat at 2 fails when HP low, or 3 fails normally
          const retreatThreshold = state.hp <= 1 ? 2 : 3;
          if (!trialResolved && failsThisTrial >= retreatThreshold) {
            if (rng() < 0.6) {
              // Retreat (free, most common escape)
              trialResolved = true;
              addLog('retreat', `后退逃离试炼`, '逃跑了。好吧。');
            } else if (state.hp > 1 && rng() < 0.5) {
              state.hp--;
              trialResolved = true;
              addLog('god_hand', `使用上帝之手强制通过！HP-1 (${state.hp}/3)`, '你选择了捷径。代价不低。');
            } else {
              trialResolved = true;
              addLog('retreat', `后退逃离试炼`, '逃跑了。好吧。');
            }
          }
        }
      }
    } else if (card.role === 'pressure') {
      switch (card.dealer) {
        case 'JUMPSCARE':
          if (rng() < 0.15) { state.hp--; addLog('jumpscare_hit', `惊吓！反应不及 HP-1 (${state.hp}/3)`, villainSay('jumpscare')); if (state.hp<=0){outcome='death';addLog('death','惊吓致死。','别愣着。快跑……哦，晚了。');} }
          else addLog('jumpscare', '惊吓！及时反应', villainSay('jumpscare'));
          break;
        case 'WALL_CLOSE':
          state.effects.wallCloseSteps = 4;
          addLog('wall_close', '墙壁合拢！某个方向被封锁4步', villainSay('wall_close'));
          break;
        case 'SHADOW_CHASE':
          state.effects.shadowChaseSteps = 5;
          addLog('shadow_chase', '影子追击！后退将受惩罚，持续5步', villainSay('shadow_chase'));
          break;
        case 'COUNTDOWN':
          state.effects.countdownSteps = 8;
          state.effects.countdownStartDepth = state.depth;
          addLog('countdown', '倒计时开始！8步内必须前进', villainSay('countdown'));
          break;
        case 'MEMORY_SCRAMBLE':
          state.effects.memoryScrambleSteps = 4;
          addLog('memory_scramble', '记忆扰乱！方向标签混乱4步', villainSay('memory_scramble'));
          break;
      }
    } else if (card.role === 'relief') {
      if (state.hp < 3 && rng() < 0.15) {
        state.hp++;
        addLog('heal', `喘息回血 HP+1 (${state.hp}/3)`, villainSay('card_calm'));
      } else {
        addLog('calm', '片刻宁静', villainSay('card_calm'));
      }
    } else if (card.role === 'payoff') {
      addLog('payoff', '情感回报时刻', '……你还在坚持。');
    }

    // Low HP warning
    if (state.hp === 1 && state.steps > 5) {
      addLog('low_hp_warning', '', villainSay('low_hp'));
    }

    // Near exit hint
    const distToExit = Math.abs(state.pos.x - exit.x) + Math.abs(state.pos.y - exit.y);
    if (distToExit <= 4 && state.steps > 20 && rng() < 0.3) {
      addLog('near_exit', '', villainSay('near_exit'));
    }
  }

  if (state.steps >= MAX_STEPS && outcome !== 'escape' && outcome !== 'death') {
    outcome = 'trapped';
    addLog('trapped', `66步用尽，永久囚禁。HP=${state.hp}`, '你没能逃出去。正如我所预料的。');
  }

  // Game summary
  const flagCount = Object.values(state.knowledgeFlags).filter(v=>v).length;
  addLog('summary', [
    `结局: ${outcome === 'escape' ? '逃脱' : outcome === 'death' ? '死亡' : '永久囚禁'}`,
    `步数: ${state.steps}/${MAX_STEPS} | HP: ${state.hp}/3 | 碎片: ${state.fragments}/${MAX_FRAGMENTS}`,
    `知识旗帜: ${flagCount}/4 | 深度: ${state.depth}`,
    `试炼: ${state.trialPassesThisGame}通过/${state.trialFailsThisGame}失败`,
    `碎片来源: 移动${state.fragmentsFromMovement}/诱惑${state.fragmentsFromTemptation}`,
    `推墙: ${state.wallPushCount} | 反问: ${state.counterQuestionsUsed}次(成功${state.counterQuestionsWon})`,
    `突发事件: 坍塌${state.suddenCollapses}/传送${state.suddenTeleports}/倒流${state.suddenRewinds}`,
    `诱惑: 跟随${state.temptFollowed}/忽略${state.temptIgnored} | 后退: ${state.totalBacktracks}次`,
  ].join('\n    '), '');

  return { gameNum, profile: profile.name, outcome, state, log };
}

// ═══════════════════════════════════════════════════════════════
// RUN 10 GAMES
// ═══════════════════════════════════════════════════════════════
const results = [];
for (let i = 0; i < 10; i++) {
  const profile = PLAYER_PROFILES[i % PLAYER_PROFILES.length];
  results.push(simulateGame(i + 1, profile));
}

// Output JSON for agent analysis
const output = {
  games: results.map(r => ({
    game: r.gameNum,
    profile: r.profile,
    outcome: r.outcome,
    steps: r.state.steps,
    hp: r.state.hp,
    fragments: r.state.fragments,
    wallPushes: r.state.wallPushCount,
    suddenEvents: r.state.suddenEventCount,
    trialPasses: r.state.trialPassesThisGame,
    trialFails: r.state.trialFailsThisGame,
    counterQuestions: r.state.counterQuestionsUsed,
    counterQuestionWins: r.state.counterQuestionsWon,
    temptFollowed: r.state.temptFollowed,
    temptIgnored: r.state.temptIgnored,
    fragmentsFromMovement: r.state.fragmentsFromMovement,
    fragmentsFromTemptation: r.state.fragmentsFromTemptation,
    backtrackCount: r.state.totalBacktracks,
    collapses: r.state.suddenCollapses,
    teleports: r.state.suddenTeleports,
    rewinds: r.state.suddenRewinds,
    knowledgeFlags: Object.values(r.state.knowledgeFlags).filter(v=>v).length,
    logLength: r.log.length,
  })),
  fullLogs: results.map(r => ({
    game: r.gameNum,
    profile: r.profile,
    outcome: r.outcome,
    events: r.log.map(e => `[步${e.step}] ${e.type}: ${e.text}${e.villain ? ' | villain: "' + e.villain + '"' : ''}`),
  })),
};

// Print summary table
console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║           ClawTrap 10轮完整游戏模拟报告                     ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

for (const g of output.games) {
  const outcomeStr = g.outcome === 'escape' ? '🏃 逃脱' : g.outcome === 'death' ? '💀 死亡' : '🔒 囚禁';
  console.log(`── 第${g.game}局 [${g.profile}] ── ${outcomeStr}`);
  console.log(`   步数:${g.steps}/66 HP:${g.hp}/3 碎片:${g.fragments}/5 旗帜:${g.knowledgeFlags}/4`);
  console.log(`   试炼:${g.trialPasses}过/${g.trialFails}败 反问:${g.counterQuestions}(赢${g.counterQuestionWins}) 推墙:${g.wallPushes}`);
  console.log(`   诱惑:追${g.temptFollowed}/忽${g.temptIgnored} 碎片源:走${g.fragmentsFromMovement}/诱${g.fragmentsFromTemptation}`);
  console.log(`   突发:塌${g.collapses}/传${g.teleports}/倒${g.rewinds} 后退:${g.backtrackCount}次`);
  console.log('');
}

// Aggregate stats
const agg = {
  escapes: output.games.filter(g=>g.outcome==='escape').length,
  deaths: output.games.filter(g=>g.outcome==='death').length,
  trapped: output.games.filter(g=>g.outcome==='trapped').length,
  avgSteps: (output.games.reduce((s,g)=>s+g.steps,0)/10).toFixed(1),
  avgHP: (output.games.reduce((s,g)=>s+g.hp,0)/10).toFixed(1),
  avgFragments: (output.games.reduce((s,g)=>s+g.fragments,0)/10).toFixed(1),
  totalWallPushes: output.games.reduce((s,g)=>s+g.wallPushes,0),
  totalCQ: output.games.reduce((s,g)=>s+g.counterQuestions,0),
  totalCQWins: output.games.reduce((s,g)=>s+g.counterQuestionWins,0),
  totalSudden: output.games.reduce((s,g)=>s+g.suddenEvents,0),
  totalCollapses: output.games.reduce((s,g)=>s+g.collapses,0),
  totalTeleports: output.games.reduce((s,g)=>s+g.teleports,0),
  totalRewinds: output.games.reduce((s,g)=>s+g.rewinds,0),
  totalFragMove: output.games.reduce((s,g)=>s+g.fragmentsFromMovement,0),
  totalFragTempt: output.games.reduce((s,g)=>s+g.fragmentsFromTemptation,0),
  totalTemptFollow: output.games.reduce((s,g)=>s+g.temptFollowed,0),
  totalTemptIgnore: output.games.reduce((s,g)=>s+g.temptIgnored,0),
};

console.log('══════════════════════════════════════════════════');
console.log('汇总统计');
console.log('══════════════════════════════════════════════════');
console.log(`结局分布: 逃脱${agg.escapes} / 死亡${agg.deaths} / 囚禁${agg.trapped}`);
console.log(`平均步数: ${agg.avgSteps} | 平均HP: ${agg.avgHP} | 平均碎片: ${agg.avgFragments}`);
console.log(`推墙总次数: ${agg.totalWallPushes} | 反问总次数: ${agg.totalCQ} (成功${agg.totalCQWins})`);
console.log(`突发事件: 总${agg.totalSudden} (塌${agg.totalCollapses}/传${agg.totalTeleports}/倒${agg.totalRewinds})`);
console.log(`碎片来源: 移动${agg.totalFragMove} / 诱惑${agg.totalFragTempt}`);
console.log(`诱惑决策: 追随${agg.totalTemptFollow} / 忽略${agg.totalTemptIgnore}`);

// Write full logs to file for agent analysis
const fs = require('fs');
fs.writeFileSync(
  require('path').join(__dirname, 'sim-results.json'),
  JSON.stringify(output, null, 2),
  'utf8'
);
console.log('\n完整日志已写入 scripts/sim-results.json');
