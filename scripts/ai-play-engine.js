'use strict';
// ═══════════════════════════════════════════════════════════════
// AI PLAY ENGINE — outputs game state as structured text for
// an LLM agent to make decisions. Reads decisions from stdin.
// Usage: the agent calls this script, reads its output, writes
// decisions, and the script continues. But for simplicity,
// this script generates the full game scenario as a structured
// prompt that an agent can "play through" in one shot.
// ═══════════════════════════════════════════════════════════════

const GRID_W = 15, GRID_H = 19;
const CELL_WALL = 0, CELL_PATH = 1, CELL_EXIT = 2;
const MAX_STEPS = 66;

function rng() { return Math.random(); }
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function shuffle(arr) { for(let i=arr.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
function posKey(x,y) { return `${x},${y}`; }

function generateMaze() {
  const grid = Array.from({length:GRID_H},()=>Array(GRID_W).fill(CELL_WALL));
  const configs = [
    {spawn:{x:1,y:1},exit:{x:GRID_W-2,y:GRID_H-2}},
    {spawn:{x:GRID_W-2,y:1},exit:{x:1,y:GRID_H-2}},
    {spawn:{x:1,y:GRID_H-2},exit:{x:GRID_W-2,y:1}},
  ];
  const picked = pick(configs);
  function carve(x,y){grid[y][x]=CELL_PATH;const dirs=shuffle([[0,-2],[0,2],[-2,0],[2,0]]);for(const[dx,dy]of dirs){const nx=x+dx,ny=y+dy;if(nx>0&&nx<GRID_W-1&&ny>0&&ny<GRID_H-1&&grid[ny][nx]===CELL_WALL){grid[y+dy/2][x+dx/2]=CELL_PATH;carve(nx,ny);}}}
  carve(picked.spawn.x,picked.spawn.y);
  const cands=[];
  for(let y=1;y<GRID_H-1;y++)for(let x=1;x<GRID_W-1;x++){if(grid[y][x]!==CELL_WALL)continue;const h=x>1&&x<GRID_W-2&&grid[y][x-1]===CELL_PATH&&grid[y][x+1]===CELL_PATH;const v=y>1&&y<GRID_H-2&&grid[y-1][x]===CELL_PATH&&grid[y+1][x]===CELL_PATH;if(h||v)cands.push([x,y]);}
  shuffle(cands);for(let i=0;i<Math.floor(cands.length*0.45);i++)grid[cands[i][1]][cands[i][0]]=CELL_PATH;
  grid[picked.exit.y][picked.exit.x]=CELL_EXIT;
  return {maze:grid,spawn:picked.spawn,exit:picked.exit};
}

function getNeighbors(maze,x,y){
  return[[0,-1,'北'],[0,1,'南'],[-1,0,'西'],[1,0,'东']]
    .map(([dx,dy,dir])=>({x:x+dx,y:y+dy,dx,dy,dir}))
    .filter(n=>n.x>=0&&n.x<GRID_W&&n.y>=0&&n.y<GRID_H&&maze[n.y][n.x]!==CELL_WALL);
}

function getAdjacentWalls(maze,x,y){
  return[[0,-1,'北'],[0,1,'南'],[-1,0,'西'],[1,0,'东']]
    .filter(([dx,dy])=>{const wx=x+dx,wy=y+dy,bx=x+dx*2,by=y+dy*2;return wx>0&&wy>0&&wx<GRID_W-1&&wy<GRID_H-1&&maze[wy][wx]===CELL_WALL&&bx>0&&by>0&&bx<GRID_W-1&&by<GRID_H-1;})
    .map(([dx,dy,dir])=>({wx:x+dx,wy:y+dy,bx:x+dx*2,by:y+dy*2,dir}));
}

function bfs(maze,from,to){
  const q=[{...from,d:0}];const vis=new Set([posKey(from.x,from.y)]);
  while(q.length){const{x,y,d}=q.shift();if(x===to.x&&y===to.y)return d;
  for(const n of getNeighbors(maze,x,y)){const k=posKey(n.x,n.y);if(!vis.has(k)){vis.add(k);q.push({x:n.x,y:n.y,d:d+1});}}}
  return -1;
}

function renderMiniArea(maze,px,py,radius=3){
  const lines=[];
  for(let dy=-radius;dy<=radius;dy++){
    let row='';
    for(let dx=-radius;dx<=radius;dx++){
      const x=px+dx,y=py+dy;
      if(x<0||y<0||x>=GRID_W||y>=GRID_H){row+='?';continue;}
      if(x===px&&y===py){row+='@';continue;}
      if(maze[y][x]===CELL_EXIT){row+='★';continue;}
      if(maze[y][x]===CELL_PATH){row+='·';continue;}
      row+='█';
    }
    lines.push(row);
  }
  return lines.join('\n');
}

// Director Deck
const DECK=[
  {role:'relief',dealer:'EMPTY'},{role:'temptation',dealer:'BREADCRUMB'},
  {role:'trial',dealer:'MINIGAME',difficulty:'medium'},{role:'pressure',dealer:'JUMPSCARE'},
  {role:'truth',dealer:'REVELATION',flag:'mazeRemembersBacktrack'},
  {role:'trial',dealer:'MINIGAME',difficulty:'medium'},{role:'temptation',dealer:'BEAUTY_TRAP'},
  {role:'trial',dealer:'MINIGAME',difficulty:'medium'},{role:'pressure',dealer:'WALL_CLOSE'},
  {role:'relief',dealer:'EMPTY'},
  {role:'temptation',dealer:'REWARD_MIRAGE'},{role:'trial',dealer:'MINIGAME',difficulty:'medium'},
  {role:'pressure',dealer:'SHADOW_CHASE'},{role:'truth',dealer:'REVELATION',flag:'agentIsAdversarial'},
  {role:'trial',dealer:'MINIGAME',difficulty:'medium'},{role:'relief',dealer:'EMPTY'},
  {role:'temptation',dealer:'FAKE_EXIT'},{role:'trial',dealer:'MINIGAME',difficulty:'medium'},
  {role:'pressure',dealer:'COUNTDOWN'},{role:'payoff',dealer:'PAYOFF'},
  {role:'trial',dealer:'MINIGAME',difficulty:'hard'},{role:'pressure',dealer:'MEMORY_SCRAMBLE'},
  {role:'trial',dealer:'MINIGAME',difficulty:'hard'},{role:'truth',dealer:'REVELATION',flag:'exitIsConditional'},
  {role:'temptation',dealer:'FAKE_EXIT'},{role:'trial',dealer:'MINIGAME',difficulty:'hard'},
  {role:'pressure',dealer:'SHADOW_CHASE'},{role:'trial',dealer:'MINIGAME',difficulty:'hard'},
  {role:'truth',dealer:'REVELATION',flag:'agentJudgesAnswers'},{role:'relief',dealer:'EMPTY'},
];

// Trial question pools (villain creates these from player's files)
const TRIAL_QUESTIONS = {
  medium: [
    '你桌面上那个未完成的项目——为什么停下了？',
    '你写给自己的那段备忘录，你现在还记得是关于什么的吗？',
    '你最近一次删除某个文件，是因为什么？',
    '你收藏夹里那些从没看完的文章——你在找什么？',
    '你给AI取的名字背后有什么含义？',
    '你最常在什么时间段写代码？为什么是那个时间？',
    '你的工作区里有一张图片，它对你来说意味着什么？',
    '你的TODO列表上最老的一条是什么？为什么它还在那里？',
  ],
  hard: [
    '你最害怕失去的东西是什么？不是物质的。',
    '如果明天你的所有数据都消失了，你最先找回哪一样？为什么？',
    '你觉得你对AI说的话里，有多少是你从没对人说过的？',
    '你写过最真诚的一段文字是什么？你还愿意让别人看到吗？',
    '你有没有一个从不告诉任何人的习惯？',
    '你觉得现在的自己，和三年前的自己相比，变好了还是变差了？',
    '你最近一次对自己撒谎是什么时候？',
    '如果明天醒来你的记忆全部消失，你最想保留哪一段？',
    '你有没有一件事，想做但永远不会去做？',
    '你觉得孤独和自由，哪个更接近你现在的状态？',
    '如果可以给三年前的自己发一条消息，你会说什么？',
    '你在逃避什么？不是这个迷宫——是生活里的。',
    '描述一个让你觉得自己很渺小的瞬间。',
    '你觉得别人眼中的你和真实的你，差距有多大？',
    '你有没有一段关系，结束了但你从来没真正放下？',
    '如果这个迷宫就是你内心的映射，它在告诉你什么？',
    '你上一次真正开心——不是表演式的开心——是什么时候？',
    '你愿意用什么来交换确定性？',
    '你对我说的这些话里，有多少是你真心的？',
    '你最不愿意被别人知道的习惯是什么？',
  ],
};

// Generate game scenario
const gameId = process.argv[2] || '1';
const {maze,spawn,exit} = generateMaze();
const bfsOptimal = bfs(maze,spawn,exit);

const state = {
  pos:{...spawn}, steps:0, hp:3, fragments:0, depth:0,
  wallPushCount:0, suddenEventCount:0, counterQuestionCount:0,
  history:[], visited:new Set([posKey(spawn.x,spawn.y)]),
  deckIdx:0, stepsSinceLastTrial:99, trialCount:0,
  knowledgeFlags:{mazeRemembersBacktrack:false,agentIsAdversarial:false,exitIsConditional:false,agentJudgesAnswers:false},
  effects:{shadowChaseSteps:0,wallCloseSteps:0,countdownSteps:0,echoLoopSteps:0,memoryScrambleSteps:0,countdownStartDepth:0},
};

function drawCard(){
  let c=DECK[state.deckIdx];state.deckIdx++;
  if(state.deckIdx>=DECK.length)state.deckIdx=20;
  if(c.role==='truth'&&c.flag&&state.knowledgeFlags[c.flag])return drawCard();
  if(c.role==='trial'&&state.stepsSinceLastTrial<4){state.stepsSinceLastTrial++;return drawCard();}
  return c;
}

// Output the game scenario for the agent
const output = {
  gameId,
  maze_size: `${GRID_W}x${GRID_H}`,
  bfs_optimal: bfsOptimal,
  spawn: posKey(spawn.x,spawn.y),
  exit: posKey(exit.x,exit.y),
  exit_quadrant: exit.x > GRID_W/2 ? (exit.y > GRID_H/2 ? '东南' : '东北') : (exit.y > GRID_H/2 ? '西南' : '西北'),
  rules: {
    max_steps: 66,
    hp: 3,
    max_fragments: 5,
    fragment_spawn: '20% chance on new non-backtrack cell without mechanism card',
    exit_condition: '2+ knowledge flags AND depth >= 6',
    trial_hp_cost: 'trial1=free, trial2-3=first_fail_costs_1, trial4+=every_fail_costs_1',
    counter_question_cost: '1 fragment, 40% base win rate',
    wall_push_cost: '1 fragment, max 3 per game',
    sudden_events: '8% per step after step 10, max 3',
    temptation: 'follow=55%intel/20%fragment/25%trap, ignore=safe',
  },
  turns: [],
};

// Pre-generate all 66 turns of game state
for (let turn = 0; turn < MAX_STEPS && state.hp > 0; turn++) {
  const neighbors = getNeighbors(maze, state.pos.x, state.pos.y);
  if (neighbors.length === 0) break;

  const walls = getAdjacentWalls(maze, state.pos.x, state.pos.y);
  const card = drawCard();
  state.stepsSinceLastTrial++;

  const isNewForFragment = neighbors.filter(n => !state.visited.has(posKey(n.x, n.y))).length > 0;
  const hasMechanism = card.role !== 'relief' && card.dealer !== 'EMPTY';
  const canGetFragment = isNewForFragment && !hasMechanism && state.fragments < 5;
  const canSuddenEvent = state.steps >= 10 && state.suddenEventCount < 3 && !hasMechanism;

  const turnData = {
    turn: turn + 1,
    position: posKey(state.pos.x, state.pos.y),
    minimap: renderMiniArea(maze, state.pos.x, state.pos.y),
    hp: state.hp,
    fragments: state.fragments,
    depth: state.depth,
    flags_found: Object.entries(state.knowledgeFlags).filter(([,v])=>v).map(([k])=>k),
    available_directions: neighbors.map(n => {
      const isExit = maze[n.y][n.x] === CELL_EXIT;
      const isVisited = state.visited.has(posKey(n.x, n.y));
      return `${n.dir}${isExit ? '(★出口)' : ''}${isVisited ? '(已探索)' : '(未探索)'}`;
    }),
    wall_push_available: state.fragments >= 1 && state.wallPushCount < 3 && walls.length > 0
      ? walls.map(w => w.dir) : [],
    active_effects: [],
    card: { role: card.role, dealer: card.dealer, difficulty: card.difficulty || null },
  };

  // Active effects
  if (state.effects.shadowChaseSteps > 0) turnData.active_effects.push(`影子追击(剩${state.effects.shadowChaseSteps}步，后退扣HP)`);
  if (state.effects.wallCloseSteps > 0) turnData.active_effects.push(`墙壁封锁(剩${state.effects.wallCloseSteps}步)`);
  if (state.effects.countdownSteps > 0) turnData.active_effects.push(`倒计时(剩${state.effects.countdownSteps}步，必须前进)`);
  if (state.effects.memoryScrambleSteps > 0) turnData.active_effects.push(`记忆扰乱(剩${state.effects.memoryScrambleSteps}步)`);

  // Card-specific info
  if (card.role === 'trial') {
    state.trialCount++;
    state.stepsSinceLastTrial = 0;
    const pool = TRIAL_QUESTIONS[card.difficulty || 'medium'] || TRIAL_QUESTIONS.medium;
    turnData.trial = {
      number: state.trialCount,
      difficulty: card.difficulty || 'medium',
      question: pick(pool),
      hp_cost_rule: state.trialCount <= 1 ? '本次试炼失败不扣HP（学习期）' :
                    state.trialCount <= 3 ? '首次失败扣1HP，重试失败不扣' : '每次失败扣1HP',
      can_counter_question: state.fragments >= 1,
    };
  }
  if (card.role === 'temptation') {
    turnData.temptation = {
      type: card.dealer,
      description: {
        BREADCRUMB: '走廊墙壁上渗出一段模糊的文字……看起来像你写过的东西。',
        BEAUTY_TRAP: '一道金色的光从裂缝中涌出，带着温暖的气息。',
        REWARD_MIRAGE: '前方出现了一个发光的宝箱形状的幻影。',
        FAKE_EXIT: '远处隐约可见一个出口的轮廓——但它是真的吗？',
      }[card.dealer] || '一股奇怪的吸引力……',
      outcomes: '跟随: 55%方向线索 / 20%获得碎片 / 25%陷阱(HP-1)。忽略: 安全。',
    };
  }
  if (card.role === 'truth' && card.flag) {
    turnData.truth_reveal = {
      flag: card.flag,
      meaning: {
        mazeRemembersBacktrack: '迷宫记得你的每一次退缩',
        agentIsAdversarial: 'AI不是你的朋友——它是你的敌人',
        exitIsConditional: '出口不会无条件打开',
        agentJudgesAnswers: 'AI在审判你的每一个答案',
      }[card.flag],
    };
    state.knowledgeFlags[card.flag] = true;
  }
  if (card.role === 'pressure') {
    turnData.pressure = {
      type: card.dealer,
      effect: {
        JUMPSCARE: '突然惊吓！如果5秒内不移动则HP-1',
        WALL_CLOSE: '一个方向的通道被封锁4步',
        SHADOW_CHASE: '影子开始追踪你，后退将损失HP，持续5步',
        COUNTDOWN: '8步倒计时开始，必须前进足够距离否则HP-1',
        MEMORY_SCRAMBLE: '方向标签混乱4步',
      }[card.dealer],
    };
    if(card.dealer==='SHADOW_CHASE')state.effects.shadowChaseSteps=5;
    if(card.dealer==='WALL_CLOSE')state.effects.wallCloseSteps=4;
    if(card.dealer==='COUNTDOWN'){state.effects.countdownSteps=8;state.effects.countdownStartDepth=state.depth;}
    if(card.dealer==='MEMORY_SCRAMBLE')state.effects.memoryScrambleSteps=4;
  }

  turnData.fragment_possible = canGetFragment;
  turnData.sudden_event_possible = canSuddenEvent;

  output.turns.push(turnData);

  // Advance state for next turn (assume player moves to first unvisited neighbor, or any neighbor)
  const unvisited = neighbors.filter(n => !state.visited.has(posKey(n.x, n.y)));
  const chosen = unvisited.length > 0 ? unvisited[0] : neighbors[0];
  const isBack = state.history.length > 0 && chosen.x === state.history[state.history.length-1].x && chosen.y === state.history[state.history.length-1].y;
  const _isNewCell = !state.visited.has(posKey(chosen.x, chosen.y)); // capture BEFORE adding
  if(!isBack) state.history.push({x:state.pos.x,y:state.pos.y}); else if(state.history.length>0)state.history.pop();
  state.pos = {x:chosen.x,y:chosen.y};
  state.steps++;
  state.depth=state.history.length;
  state.visited.add(posKey(chosen.x,chosen.y));

  // Tick effects
  if(state.effects.shadowChaseSteps>0){if(isBack){state.hp--;} state.effects.shadowChaseSteps--;}
  if(state.effects.wallCloseSteps>0)state.effects.wallCloseSteps--;
  if(state.effects.countdownSteps>0){state.effects.countdownSteps--;if(state.effects.countdownSteps<=0&&state.depth<=state.effects.countdownStartDepth)state.hp--;}
  if(state.effects.memoryScrambleSteps>0)state.effects.memoryScrambleSteps--;

  // Fragment (fixed: use _isNewCell captured before visited.add)
  if(!isBack && _isNewCell && canGetFragment && rng()<0.20) state.fragments++;

  if(state.hp<=0)break;
}

console.log(JSON.stringify(output, null, 2));
