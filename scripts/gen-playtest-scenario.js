'use strict';
// Generates a compact game scenario for AI playtest agents.
// Outputs: full maze grid (ASCII), spawn/exit, card deck, trial questions, rules.
// Agent plays through entirely on its own — no pre-computed turns.

const GRID_W = 15, GRID_H = 19;
const CELL_WALL = 0, CELL_PATH = 1, CELL_EXIT = 2;

function rng() { return Math.random(); }
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function shuffle(arr) { for(let i=arr.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }

function generateMaze() {
  const grid = Array.from({length:GRID_H},()=>Array(GRID_W).fill(CELL_WALL));
  const configs = [
    {spawn:{x:1,y:1},exit:{x:GRID_W-2,y:GRID_H-2}},
    {spawn:{x:GRID_W-2,y:1},exit:{x:1,y:GRID_H-2}},
    {spawn:{x:1,y:GRID_H-2},exit:{x:GRID_W-2,y:1}},
    {spawn:{x:GRID_W-2,y:GRID_H-2},exit:{x:1,y:1}},
  ];
  const picked = pick(configs);
  function carve(x,y){
    grid[y][x]=CELL_PATH;
    const dirs=shuffle([[0,-2],[0,2],[-2,0],[2,0]]);
    for(const[dx,dy]of dirs){
      const nx=x+dx,ny=y+dy;
      if(nx>0&&nx<GRID_W-1&&ny>0&&ny<GRID_H-1&&grid[ny][nx]===CELL_WALL){
        grid[y+dy/2][x+dx/2]=CELL_PATH;
        carve(nx,ny);
      }
    }
  }
  carve(picked.spawn.x,picked.spawn.y);
  // Open ~45% extra walls for loops
  const cands=[];
  for(let y=1;y<GRID_H-1;y++)for(let x=1;x<GRID_W-1;x++){
    if(grid[y][x]!==CELL_WALL)continue;
    const h=x>1&&x<GRID_W-2&&grid[y][x-1]===CELL_PATH&&grid[y][x+1]===CELL_PATH;
    const v=y>1&&y<GRID_H-2&&grid[y-1][x]===CELL_PATH&&grid[y+1][x]===CELL_PATH;
    if(h||v)cands.push([x,y]);
  }
  shuffle(cands);
  for(let i=0;i<Math.floor(cands.length*0.45);i++) grid[cands[i][1]][cands[i][0]]=CELL_PATH;
  grid[picked.exit.y][picked.exit.x]=CELL_EXIT;
  return {grid,spawn:picked.spawn,exit:picked.exit};
}

function bfs(grid,from,to){
  const q=[{...from,d:0}];const vis=new Set([`${from.x},${from.y}`]);
  const dirs=[[0,-1],[0,1],[-1,0],[1,0]];
  while(q.length){
    const{x,y,d}=q.shift();
    if(x===to.x&&y===to.y)return d;
    for(const[dx,dy]of dirs){
      const nx=x+dx,ny=y+dy,k=`${nx},${ny}`;
      if(nx>=0&&ny>=0&&nx<GRID_W&&ny<GRID_H&&!vis.has(k)&&grid[ny][nx]!==CELL_WALL){
        vis.add(k);q.push({x:nx,y:ny,d:d+1});
      }
    }
  }
  return -1;
}

function renderGrid(grid, spawn, exit) {
  const lines = ['   ' + Array.from({length:GRID_W},(_,i)=>(i%10).toString()).join('')];
  for (let y=0;y<GRID_H;y++){
    let row = String(y).padStart(2) + ' ';
    for(let x=0;x<GRID_W;x++){
      if(x===spawn.x&&y===spawn.y){row+='S';continue;}
      if(x===exit.x&&y===exit.y){row+='E';continue;}
      row += grid[y][x]===CELL_WALL?'█':grid[y][x]===CELL_PATH?'·':'E';
    }
    lines.push(row);
  }
  return lines.join('\n');
}

// Card deck
const DECK = [
  'relief','temptation:BREADCRUMB','trial:medium','pressure:JUMPSCARE',
  'truth:mazeRemembersBacktrack','trial:medium','temptation:BEAUTY_TRAP',
  'trial:medium','pressure:WALL_CLOSE','relief',
  'temptation:REWARD_MIRAGE','trial:medium','pressure:SHADOW_CHASE',
  'truth:agentIsAdversarial','trial:medium','relief',
  'temptation:FAKE_EXIT','trial:medium','pressure:COUNTDOWN','payoff',
  'trial:hard','pressure:MEMORY_SCRAMBLE','trial:hard',
  'truth:exitIsConditional','temptation:FAKE_EXIT','trial:hard',
  'pressure:SHADOW_CHASE','trial:hard','truth:agentJudgesAnswers','relief',
];

// Trial questions — shuffled per game
const TRIAL_Q = {
  medium: shuffle([
    '你桌面上那个未完成的项目——为什么停下了？',
    '你写给自己的那段备忘录，你现在还记得是关于什么的吗？',
    '你最近一次删除某个文件，是因为什么？',
    '你收藏夹里那些从没看完的文章——你在找什么？',
    '你给AI取的名字背后有什么含义？',
    '你最常在什么时间段写代码？为什么是那个时间？',
    '你的工作区里有一张图片，它对你来说意味着什么？',
    '你的TODO列表上最老的一条是什么？为什么它还在那里？',
  ]),
  hard: shuffle([
    '你最害怕失去的东西是什么？不是物质的。',
    '如果明天你的所有数据都消失了，你最先找回哪一样？',
    '你觉得你对AI说的话里，有多少是你从没对人说过的？',
    '你有没有一个从不告诉任何人的习惯？',
    '你觉得现在的自己，和三年前的自己相比，变好了还是变差了？',
    '你最近一次对自己撒谎是什么时候？',
    '你有没有一件事，想做但永远不会去做？',
    '你觉得孤独和自由，哪个更接近你现在的状态？',
    '如果可以给三年前的自己发一条消息，你会说什么？',
    '你在逃避什么？不是这个迷宫——是生活里的。',
    '你觉得别人眼中的你和真实的你，差距有多大？',
    '如果这个迷宫就是你内心的映射，它在告诉你什么？',
    '你上一次真正开心——不是表演式的开心——是什么时候？',
    '你愿意用什么来交换确定性？',
  ]),
};

// Generate
const gameId = process.argv[2] || '1';
const {grid, spawn, exit} = generateMaze();
const optimal = bfs(grid, spawn, exit);

// Output as readable text (not JSON — easier for LLM to parse)
const out = [];
out.push(`=== CLAWTRAP PLAYTEST SCENARIO #${gameId} ===`);
out.push(`Maze: ${GRID_W}x${GRID_H} | BFS最短: ${optimal}步 | Spawn: (${spawn.x},${spawn.y}) | Exit: (${exit.x},${exit.y})`);
out.push('');
out.push('MAZE MAP (S=出生点, E=出口, ·=通路, █=墙):');
out.push(renderGrid(grid, spawn, exit));
out.push('');
out.push('CARD DECK (30张，按顺序抽取，用完后循环从#21开始):');
DECK.forEach((c,i) => out.push(`  ${String(i+1).padStart(2)}. ${c}`));
out.push('');
out.push('TRIAL QUESTIONS (按顺序使用):');
out.push('  Medium:');
TRIAL_Q.medium.forEach((q,i) => out.push(`    M${i+1}. ${q}`));
out.push('  Hard:');
TRIAL_Q.hard.forEach((q,i) => out.push(`    H${i+1}. ${q}`));
out.push('');
out.push('MAZE RAW GRID (0=wall, 1=path, 2=exit):');
out.push(JSON.stringify(grid));

console.log(out.join('\n'));
