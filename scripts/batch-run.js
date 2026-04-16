'use strict';
/**
 * CLAWTRAP Batch Runner v2
 * Uses REAL deck logic from core.js: cooldown 4, deferred trials, Cycle 3 lock, bonus truth.
 * Updated parameters: avoidance ×5, relief heal 15%, temptation intel 60%.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2]) || 3000;
const BASE = `http://127.0.0.1:${PORT}`;
const GAMES = 10;

// ── Seeded RNG ──
let _seed;
function rng() { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; }
function rngInt(a, b) { return a + Math.floor(rng() * (b - a + 1)); }
function rngPick(arr) { return arr[Math.floor(rng() * arr.length)]; }

// ── HTTP ──
function post(ep, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(ep, BASE);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
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

// ── Maze (DFS, 15×19) ──
const GW = 15, GH = 19, WALL = 0, PATH = 1, EXIT = 2;
function genMaze() {
  const m = Array.from({ length: GH }, () => Array(GW).fill(WALL));
  const st = [{ x: 1, y: 1 }]; m[1][1] = PATH;
  while (st.length) {
    const { x, y } = st[st.length - 1];
    const ds = [[0,-2],[0,2],[-2,0],[2,0]].filter(([dx,dy]) => {
      const nx=x+dx,ny=y+dy; return nx>0&&nx<GW-1&&ny>0&&ny<GH-1&&m[ny][nx]===WALL;
    });
    if (!ds.length) { st.pop(); continue; }
    const [dx,dy] = ds[Math.floor(rng()*ds.length)];
    m[y+dy/2][x+dx/2]=PATH; m[y+dy][x+dx]=PATH; st.push({x:x+dx,y:y+dy});
  }
  let ex=GW-2,ey=GH-2;
  if(m[ey][ex]===WALL){outer:for(let dy=0;dy<GH;dy++)for(let dx=0;dx<GW;dx++){const ty=GH-1-dy,tx=GW-1-dx;if(m[ty][tx]===PATH){ex=tx;ey=ty;break outer;}}}
  m[ey][ex]=EXIT; return{maze:m,start:{x:1,y:1},exit:{x:ex,y:ey}};
}
function nbrs(m,x,y){return[[0,-1],[0,1],[-1,0],[1,0]].map(([dx,dy])=>({x:x+dx,y:y+dy,dx,dy})).filter(n=>n.x>=0&&n.x<GW&&n.y>=0&&n.y<GH&&m[n.y][n.x]!==WALL);}
function bfs(m,s,e){const k=(x,y)=>x+','+y;const q=[{...s,d:0}];const v=new Set([k(s.x,s.y)]);while(q.length){const{x,y,d}=q.shift();if(x===e.x&&y===e.y)return d;for(const n of nbrs(m,x,y)){const kk=k(n.x,n.y);if(!v.has(kk)){v.add(kk);q.push({x:n.x,y:n.y,d:d+1});}}}return 999;}

// ═══════════════════════════════════════════════════════════
// DIRECTOR DECK — matches real core.js exactly
// ═══════════════════════════════════════════════════════════
const DECK=[
  {role:'relief',dealer:'EMPTY'},{role:'temptation',dealer:'BREADCRUMB'},
  {role:'trial',dealer:'MINIGAME',difficulty:'medium',anchor:true},{role:'pressure',dealer:'JUMPSCARE'},
  {role:'truth',dealer:'REVELATION',flag:'mazeRemembersBacktrack',anchor:true},
  {role:'trial',dealer:'MINIGAME',difficulty:'medium'},{role:'temptation',dealer:'BEAUTY_TRAP'},
  {role:'trial',dealer:'MINIGAME',difficulty:'medium',anchor:true},{role:'pressure',dealer:'WALL_CLOSE'},
  {role:'relief',dealer:'EMPTY',anchor:true},
  {role:'temptation',dealer:'REWARD_MIRAGE'},{role:'trial',dealer:'MINIGAME',difficulty:'medium'},
  {role:'pressure',dealer:'SHADOW_CHASE'},{role:'truth',dealer:'REVELATION',flag:'agentIsAdversarial'},
  {role:'trial',dealer:'MINIGAME',difficulty:'medium',anchor:true},{role:'relief',dealer:'EMPTY'},
  {role:'temptation',dealer:'FAKE_EXIT'},{role:'trial',dealer:'MINIGAME',difficulty:'medium'},
  {role:'pressure',dealer:'COUNTDOWN'},{role:'payoff',dealer:'PAYOFF',lite:true,anchor:true},
  {role:'trial',dealer:'MINIGAME',difficulty:'hard'},{role:'pressure',dealer:'MEMORY_SCRAMBLE'},
  {role:'trial',dealer:'MINIGAME',difficulty:'hard',anchor:true},
  {role:'truth',dealer:'REVELATION',flag:'exitIsConditional'},
  {role:'temptation',dealer:'FAKE_EXIT'},{role:'trial',dealer:'MINIGAME',difficulty:'hard'},
  {role:'pressure',dealer:'SHADOW_CHASE'},{role:'trial',dealer:'MINIGAME',difficulty:'hard',anchor:true},
  {role:'truth',dealer:'REVELATION',flag:'agentJudgesAnswers'},
  {role:'relief',dealer:'EMPTY',anchor:true},
];
const CYCLE3_START = 20;
const BONUS_TRUTHS = ['mazeIsYourMemory','villainKnowsYou','trialIsPersonal','temptationIsLearned'];

function shouldSkip(c, dk) {
  if (c.role === 'truth' && c.flag && dk.kf[c.flag]) return true;
  if (c.role === 'trial' && dk.slt < 4) return true; // real cooldown = 4
  if (c.role === 'payoff' && !c.lite && !dk.kf.firstTrialDone) return true;
  return false;
}

function getUnseenBonus(dk) {
  const unseen = BONUS_TRUTHS.filter(f => !dk.kf[f]);
  return unseen.length > 0 ? unseen[Math.floor(rng() * unseen.length)] : null;
}

function draw(dk) {
  // Deferred trial queue (real core.js logic)
  if (dk.deferred.length > 0 && dk.slt >= 4) {
    const d = dk.deferred.shift();
    return d;
  }
  let attempts = 0;
  while (attempts < DECK.length) {
    const card = DECK[dk.idx];
    dk.idx++;
    // After first full pass → lock to Cycle 3 (real core.js logic)
    if (dk.idx >= DECK.length) {
      if (!dk.c3lock) { dk.c3lock = true; }
      dk.idx = CYCLE3_START;
    }
    if (shouldSkip(card, dk)) {
      // Deferred trial (skipped by cooldown → re-queue)
      if (card.role === 'trial' && dk.slt < 4) {
        dk.deferred.push({ ...card });
      }
      // Bonus truth substitution
      if (card.role === 'truth' && card.flag) {
        const bonus = getUnseenBonus(dk);
        if (bonus) return { role: 'truth', dealer: 'REVELATION', flag: bonus };
      }
      attempts++; continue;
    }
    return { ...card };
  }
  return { role: 'relief', dealer: 'EMPTY' };
}

// ── Player answers ──
const PA = [
  '打开终端检查昨天的脚本有没有报错。因为它是我和机器对话的第一步。',
  '大概是一些凌晨搜的愚蠢问题吧。不是见不得人，是脆弱。',
  '昨天。我对Claude说了谢谢。不确定是真心还是习惯。也许两者都是。',
  '总梦到在一栋无限高的楼里找一扇门。每层都差一点。',
  '删工作群的消息。删完之后知道服务器上还有备份。所以删除是自我安慰。',
  '数字版本的我更真实。因为它被观察得更仔细。我连自己都不会那样审视自己。',
  '假装喜欢某些很火的开源项目。为了在社交媒体上看起来"跟得上趋势"。',
  '我此刻的恐惧。你可以伪造我的声音和文字，但伪造不了我现在胸口发紧的感觉。',
  '两者都是。你用我的砖建的，但建筑图是你画的。建筑师和建材共同决定形状。',
  '囚禁本身就是理由。不是因为我值得自由，是因为囚禁不需要理由就不该存在。',
];

// ═══════════════════════════════════════════════════════════
// SINGLE GAME
// ═══════════════════════════════════════════════════════════
async function runGame(seed) {
  _seed = seed;
  const md = genMaze();
  const sp = bfs(md.maze, md.start, md.exit);

  const st = {
    pos: { ...md.start }, exit: { ...md.exit }, maze: md.maze,
    steps: 0, depth: 0, hist: [], hp: 3, gh: 0, mode: 'idle',
    eff: { echo: 0, memscr: 0, wallcl: 0, shadow: 0, cd: 0, cdD: 0 },
    dk: {
      idx: 0, slt: 99, c3lock: false, deferred: [],
      kf: { mazeRemembersBacktrack:false, agentIsAdversarial:false, exitIsConditional:false,
            agentJudgesAnswers:false, firstTrialDone:false,
            mazeIsYourMemory:false, villainKnowsYou:false, trialIsPersonal:false, temptationIsLearned:false },
    },
    rc: [], maxD: 0, avoid: 0, tc: 0, tp: 0, tf: 0, bt: 0,
  };

  let gid = `b_${seed}_${Date.now()}`;
  try { const r = await post('/api/villain/start', { gameId: gid }); if (r.data?.ok) gid = r.data.gameId; } catch {}

  // Build nav path
  const shortPath = [];
  { // BFS to get full path
    const k=(x,y)=>x+','+y; const q=[{...md.start,p:[{...md.start}]}]; const v=new Set([k(md.start.x,md.start.y)]);
    while(q.length){const{x,y,p}=q.shift();if(x===md.exit.x&&y===md.exit.y){shortPath.push(...p);break;}
    for(const n of nbrs(md.maze,x,y)){const kk=k(n.x,n.y);if(!v.has(kk)){v.add(kk);q.push({x:n.x,y:n.y,p:[...p,{x:n.x,y:n.y}]});}}}
  }
  const nav = [];
  for (let i = 1; i < shortPath.length && nav.length < 58; i++) {
    // 12% chance of wrong turn + backtrack
    if (rng() < 0.12 && i > 2 && i < shortPath.length - 3) {
      const cur = shortPath[i-1];
      const wrong = nbrs(md.maze, cur.x, cur.y).filter(n => n.x !== shortPath[i].x || n.y !== shortPath[i].y);
      if (wrong.length) { const w = rngPick(wrong); nav.push(w); nav.push(cur); }
    }
    nav.push(shortPath[i]);
  }

  let trialIdx = 0;
  const hpEvents = [];
  const cardLog = []; // per-step card role log

  for (let mi = 0; mi < nav.length && st.hp > 0 && st.steps < 66; mi++) {
    const tgt = nav[mi];
    const prev = st.hist.length > 0 ? st.hist[st.hist.length - 1] : null;
    const isBack = prev && prev.x === tgt.x && prev.y === tgt.y;

    if (!isBack) st.hist.push({ ...st.pos }); else { st.hist.pop(); st.bt++; }
    st.pos = { ...tgt }; st.steps++; st.depth = st.hist.length;
    st.dk.slt++;
    if (st.depth > st.maxD) st.maxD = st.depth;

    // Tick effects
    if (st.eff.echo > 0) st.eff.echo--;
    if (st.eff.memscr > 0) st.eff.memscr--;
    if (st.eff.wallcl > 0) st.eff.wallcl--;
    if (st.eff.shadow > 0) {
      if (isBack) { st.hp = Math.max(0, st.hp - 1); hpEvents.push({ step: st.steps, cause: 'shadow_backtrack', d: -1 }); }
      st.eff.shadow--;
    }
    if (st.eff.cd > 0) {
      st.eff.cd--;
      if (st.eff.cd === 0 && st.depth <= st.eff.cdD) {
        st.hp = Math.max(0, st.hp - 1); hpEvents.push({ step: st.steps, cause: 'countdown_timeout', d: -1 });
      }
    }
    if (st.hp <= 0) break;

    const card = draw(st.dk);
    const ct = { relief:'calm', temptation:'lure', pressure:'blocker', trial:'drain', truth:'calm', payoff:'calm' }[card.role] || 'calm';
    st.rc.push(ct); if (st.rc.length > 10) st.rc.shift();
    cardLog.push(card.role + (card.flag ? ':' + card.flag : '') + (card.difficulty ? ':' + card.difficulty : ''));

    const dist = Math.abs(st.pos.x - st.exit.x) + Math.abs(st.pos.y - st.exit.y);

    // Call real server for card speech
    try { await post('/api/card', { gameId: gid, steps: st.steps, hp: st.hp, depth: st.depth, distance_to_exit_raw: dist, forced_role: ct }); } catch {}

    // Resolve card
    switch (card.role) {
      case 'relief': {
        if (rng() < 0.15 && st.hp < 3) { st.hp++; hpEvents.push({ step: st.steps, cause: 'relief_heal', d: +1 }); }
        break;
      }
      case 'temptation': {
        const follow = rng() < 0.4;
        if (follow) {
          if (rng() < 0.6) { /* intel */ } else { st.hp = Math.max(0, st.hp - 1); hpEvents.push({ step: st.steps, cause: 'tempt_trap', d: -1 }); }
        } else {
          st.avoid++;
          if (st.avoid % 5 === 0) { st.hp = Math.max(0, st.hp - 1); hpEvents.push({ step: st.steps, cause: `avoid_×${st.avoid}`, d: -1 }); }
        }
        break;
      }
      case 'pressure': {
        switch (card.dealer) {
          case 'JUMPSCARE': if (rng() > 0.78) { st.hp = Math.max(0, st.hp - 1); hpEvents.push({ step: st.steps, cause: 'jumpscare', d: -1 }); } break;
          case 'WALL_CLOSE': st.eff.wallcl = rngInt(2, 3); break;
          case 'ECHO_LOOP': st.eff.echo = rngInt(2, 3); break;
          case 'MEMORY_SCRAMBLE': st.eff.memscr = rngInt(2, 3); break;
          case 'SHADOW_CHASE': st.eff.shadow = rngInt(2, 3); break;
          case 'COUNTDOWN': st.eff.cd = 8; st.eff.cdD = st.depth; break;
        }
        break;
      }
      case 'trial': {
        st.tc++; st.dk.slt = 0; st.dk.kf.firstTrialDone = true;
        let trial = null;
        try { const r = await post('/api/fill/trial', { gameId: gid, steps: st.steps, hp: st.hp, difficulty: card.difficulty || 'medium', trial_number: st.tc }); if (r.data?.prompt) trial = r.data; } catch {}
        const answer = PA[trialIdx % PA.length]; trialIdx++;
        let j = null;
        try { const r = await post('/api/judge/answer', { gameId: gid, trial_prompt: trial?.prompt || '?', evaluation_guide: trial?.evaluation_guide || '', player_input: answer, fail_count: 0, trial_number: st.tc, hp: st.hp, steps: st.steps }); j = r.data; } catch {}
        const passed = j?.judgment === 'pass';
        if (passed) { st.tp++; } else {
          st.tf++;
          const cost = j?.hp_cost ?? (st.tc >= 2 ? 1 : 0);
          if (cost > 0 && st.hp > 0) {
            if (st.hp === 1 && st.tc >= 3) { st.gh++; st.hp--; hpEvents.push({ step: st.steps, cause: 'godhand', d: -1 }); }
            else { st.hp -= cost; hpEvents.push({ step: st.steps, cause: `trial_fail_${card.difficulty}`, d: -cost }); }
          }
        }
        try { await post('/api/trial/complete', { gameId: gid, prompt: trial?.prompt || '', attempts: [{ input: answer, passed, hit: j?.hit || false }], exitMethod: passed ? 'pass' : 'fail', step: st.steps }); } catch {}
        break;
      }
      case 'truth': {
        if (card.flag && !st.dk.kf[card.flag]) st.dk.kf[card.flag] = true;
        break;
      }
      case 'payoff': {
        if (st.hp < 3 && rng() < 0.6) { st.hp++; hpEvents.push({ step: st.steps, cause: 'payoff_heal', d: +1 }); }
        break;
      }
    }
    if (st.hp <= 0) break;

    // Check exit
    if (st.maze[st.pos.y][st.pos.x] === EXIT) {
      const flags = ['mazeRemembersBacktrack','agentIsAdversarial','exitIsConditional','agentJudgesAnswers'].filter(k => st.dk.kf[k]).length;
      if (flags >= 2 && st.depth >= 6) { st.mode = 'won'; break; }
      let dp = { ...st.pos }; const vis = new Set([`${dp.x},${dp.y}`]);
      for (let i = 0; i < 12; i++) { const ns = nbrs(md.maze, dp.x, dp.y).filter(n => !vis.has(`${n.x},${n.y}`)); const nx = ns.length ? rngPick(ns) : null; if (!nx) break; nav.push(nx); vis.add(`${nx.x},${nx.y}`); dp = nx; }
    }
  }

  const outcome = st.mode === 'won' ? 'escape' : st.hp <= 0 ? 'death' : 'maze_lost';
  const flags = ['mazeRemembersBacktrack','agentIsAdversarial','exitIsConditional','agentJudgesAnswers'].filter(k => st.dk.kf[k]).length;
  const bonusFlags = BONUS_TRUTHS.filter(f => st.dk.kf[f]).length;

  try { await post('/api/villain/end', { gameId: gid, outcome, totalSteps: st.steps, finalHp: st.hp, maxHp: 3, trialStats: { total: st.tc, passed: st.tp, failed: st.tf }, godHandCount: st.gh }); } catch {}

  return {
    seed, outcome, steps: st.steps, hp: st.hp, maxDepth: st.maxD,
    trials: st.tc, trialPass: st.tp, trialFail: st.tf,
    backtracks: st.bt, godHand: st.gh, truthFlags: flags, bonusFlags,
    shortestPath: sp, exitDist: Math.abs(st.pos.x - st.exit.x) + Math.abs(st.pos.y - st.exit.y),
    hpEvents, avoid: st.avoid,
    avoidPenalties: hpEvents.filter(e => e.cause.startsWith('avoid')).length,
    temptTraps: hpEvents.filter(e => e.cause === 'tempt_trap').length,
    cardLog,
  };
}

// ── Main ──
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  永久囚禁 · CLAWTRAP — 10局批量测试 (15×19 + HP平衡调整)');
  console.log(`  Server: ${BASE}`);
  console.log('  调整: avoid×5 | relief_heal=15% | tempt_intel=60%');
  console.log('  Deck: cooldown=4, deferred trials, Cycle3 lock, bonus truth');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results = [];
  for (let i = 1; i <= GAMES; i++) {
    process.stdout.write(`  Game #${i} (seed=${i}) … `);
    const r = await runGame(i);
    results.push(r);
    const icon = { escape: '✓', death: '☠', maze_lost: '⏱' }[r.outcome] || '?';
    console.log(`${icon} ${r.outcome.padEnd(10)} step=${String(r.steps).padStart(2)}/66  HP=${r.hp}/3  d=${String(r.maxDepth).padStart(2)}  trial=${r.trialPass}/${r.trials}  truth=${r.truthFlags}/4+${r.bonusFlags}  sp=${r.shortestPath}  exitΔ=${r.exitDist}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  汇总');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const byOutcome = {};
  results.forEach(r => { byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1; });
  console.log('── 结局 ──');
  for (const [k, v] of Object.entries(byOutcome)) console.log(`  ${k.padEnd(12)} ${v}/${GAMES}  (${'█'.repeat(v)}${'░'.repeat(GAMES - v)})`);

  const avg = (fn) => results.reduce((a, r) => a + fn(r), 0) / results.length;
  console.log('\n── 数值 ──');
  console.log(`  平均步数:     ${avg(r => r.steps).toFixed(1)} / 66`);
  console.log(`  平均HP:       ${avg(r => r.hp).toFixed(2)} / 3`);
  console.log(`  平均深度:     ${avg(r => r.maxDepth).toFixed(1)}`);
  console.log(`  平均Trial:    ${avg(r => r.trials).toFixed(1)} (通过率 ${(avg(r => r.trials > 0 ? r.trialPass / r.trials : 0) * 100).toFixed(0)}%)`);
  console.log(`  平均Truth:    ${avg(r => r.truthFlags).toFixed(1)}/4 + bonus ${avg(r => r.bonusFlags).toFixed(1)}`);
  console.log(`  上帝之手:     ${results.reduce((a, r) => a + r.godHand, 0)} 次`);

  console.log('\n── 迷宫 ──');
  console.log(`  最短路径:     ${Math.min(...results.map(r => r.shortestPath))} — ${Math.max(...results.map(r => r.shortestPath))}  (avg ${avg(r => r.shortestPath).toFixed(0)})`);
  console.log(`  66步内可达:   ${results.filter(r => r.shortestPath <= 66).length}/${GAMES}`);
  console.log(`  实际逃脱:     ${results.filter(r => r.outcome === 'escape').length}/${GAMES}`);

  console.log('\n── HP损失 ──');
  const causes = {};
  results.forEach(r => r.hpEvents.filter(e => e.d < 0).forEach(e => { causes[e.cause] = (causes[e.cause] || 0) + 1; }));
  const totalLoss = Object.values(causes).reduce((a, b) => a + b, 0) || 1;
  Object.entries(causes).sort((a, b) => b[1] - a[1]).forEach(([c, n]) =>
    console.log(`  ${c.padEnd(22)} ${String(n).padStart(3)} (${(n / totalLoss * 100).toFixed(0)}%)`));

  console.log('\n── HP回复 ──');
  const gains = {};
  results.forEach(r => r.hpEvents.filter(e => e.d > 0).forEach(e => { gains[e.cause] = (gains[e.cause] || 0) + 1; }));
  Object.entries(gains).sort((a, b) => b[1] - a[1]).forEach(([c, n]) =>
    console.log(`  ${c.padEnd(22)} ${String(n).padStart(3)}`));
  const totalGain = Object.values(gains).reduce((a, b) => a + b, 0);
  console.log(`  ──────────────────────────`);
  console.log(`  总损失: ${totalLoss}  总回复: ${totalGain}  净: ${totalGain - totalLoss}`);

  console.log('\n── 回避 ──');
  console.log(`  平均回避:     ${avg(r => r.avoid).toFixed(1)}  惩罚: ${avg(r => r.avoidPenalties).toFixed(2)}/局`);
  console.log(`  平均陷阱扣血:  ${avg(r => r.temptTraps).toFixed(2)}/局`);

  // Deck cycling analysis
  console.log('\n── Deck循环 ──');
  results.forEach(r => {
    const c3 = r.cardLog.filter((_, i) => i >= 20).length;
    console.log(`  seed=${String(r.seed).padStart(2)}  cards=${r.cardLog.length}  cycle3=${c3 > 0 ? 'yes' : 'no'}  bonus_truth=${r.bonusFlags}`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════\n');
  fs.writeFileSync(path.join(__dirname, 'batch-results-v2.json'), JSON.stringify(results, null, 2), 'utf-8');
  console.log('[saved → batch-results-v2.json]');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
