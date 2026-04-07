'use strict';
/**
 * 游戏节奏模拟器 v2 – 使用真实 DIRECTOR_DECK 和 shouldSkipCard 逻辑
 */
const DIRECTOR_DECK = [
  { role:'relief',     dealer:'EMPTY'                                               },
  { role:'temptation', dealer:'BREADCRUMB'                                          },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'easy',  anchor:true        },
  { role:'pressure',   dealer:'JUMPSCARE'                                           },
  { role:'truth',      dealer:'REVELATION', flag:'mazeRemembersBacktrack', anchor:true },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'easy'                      },
  { role:'temptation', dealer:'BEAUTY_TRAP'                                         },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'easy',  anchor:true        },
  { role:'relief',     dealer:'EMPTY'                                               },
  { role:'payoff',     dealer:'PAYOFF',     lite:true, anchor:true                 },
  { role:'temptation', dealer:'REWARD_MIRAGE'                                       },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium'                    },
  { role:'pressure',   dealer:'ECHO_LOOP'                                           },
  { role:'truth',      dealer:'REVELATION', flag:'agentIsAdversarial'              },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium', anchor:true       },
  { role:'relief',     dealer:'EMPTY'                                               },
  { role:'temptation', dealer:'FAKE_EXIT'                                           },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'medium'                    },
  { role:'truth',      dealer:'REVELATION', flag:'exitIsConditional'               },
  { role:'payoff',     dealer:'PAYOFF',     lite:true                              },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'hard'                      },
  { role:'pressure',   dealer:'MEMORY_SCRAMBLE'                                     },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'hard',  anchor:true        },
  { role:'temptation', dealer:'FAKE_EXIT'                                           },
  { role:'truth',      dealer:'REVELATION', flag:'agentJudgesAnswers'              },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'hard'                      },
  { role:'pressure',   dealer:'ECHO_LOOP'                                           },
  { role:'trial',      dealer:'MINIGAME',   difficulty:'hard',  anchor:true        },
  { role:'payoff',     dealer:'PAYOFF',     lite:false, anchor:true               },
  { role:'relief',     dealer:'EMPTY'                                               },
];

// 与 js/core.js shouldSkipCard 保持一致
function shouldSkipCard(card, deck) {
  const f = deck.knowledgeFlags;
  if (card.role === 'truth' && card.flag && f[card.flag]) return true;
  if (card.role === 'trial' && deck.stepsSinceLastTrial < 7) return true;
  if (card.role === 'trial' && card.subtype === 'sacrifice' && deck.hp <= 1) return true;
  if (card.role === 'payoff' && !card.lite && !f.firstTrialDone) return true;
  return false;
}

function drawNextCard(deck) {
  let attempts = 0;
  while (attempts < DIRECTOR_DECK.length) {
    const card = DIRECTOR_DECK[deck.idx];
    deck.idx = (deck.idx + 1) % DIRECTOR_DECK.length;
    if (shouldSkipCard(card, deck)) { deck.skipCount++; attempts++; continue; }
    deck.skipCount = 0;
    return card;
  }
  return { role:'relief', dealer:'EMPTY' };
}

// 机制 → 效果分类
const MECH_EFFECTS = {
  MINIGAME:        'trial',       // 阻止 + 问答
  JUMPSCARE:       'pressure',    // 5秒倒计时惩罚
  ECHO_LOOP:       'pressure',    // 方向干扰 2步
  MEMORY_SCRAMBLE: 'pressure',    // 小地图失效 3步
  BEAUTY_TRAP:     'lure',        // 升级为考验
  BREADCRUMB:      'lure',        // 方向提示（可信度低）
  REWARD_MIRAGE:   'lure',        // 55% 回血
  FAKE_EXIT:       'lure',        // 误导方向
  REVELATION:      'info',        // 揭示 flag
  PAYOFF:          'relief',      // 喘息 / 回血机会
  EMPTY:           'relief',      // 无事发生
};

function simulateGame(gameId, maxMoves = 60) {
  const deck = {
    idx: 0, skipCount: 0, stepsSinceLastTrial: 99,
    knowledgeFlags: {}, hp: 3,
  };
  let hp = 3, moves = 0, trialCount = 0;
  const mechCounts = {}, hpLog = [], deckLog = [];

  // 玩家 trial 通过率：early=0.7, medium=0.55, hard=0.4
  const passProbByDiff = { easy:0.70, medium:0.55, hard:0.40 };
  // 玩家 JUMPSCARE 及时移动概率 0.78
  // BEAUTY_TRAP 跟上去概率 0.5（跟上才触发 minigame）
  // REWARD_MIRAGE 55% 回血（实际 hp < 3 才触发）

  while (moves < maxMoves && hp > 0) {
    moves++;
    deck.stepsSinceLastTrial++;

    const card = drawNextCard(deck);
    const mech = card.dealer;
    mechCounts[mech] = (mechCounts[mech] || 0) + 1;
    deckLog.push({ move: moves, role: card.role, mech, diff: card.difficulty });

    switch (mech) {
      case 'MINIGAME': {
        trialCount++;
        deck.stepsSinceLastTrial = 0;
        deck.knowledgeFlags.firstTrialDone = true;
        const pPass = passProbByDiff[card.difficulty] || 0.55;
        const passed = Math.random() < pPass;
        if (!passed) {
          // 失败：HP-1（如果 HP > 1）
          if (hp > 1) { hp--; deck.hp = hp; hpLog.push({ move: moves, reason: `MINIGAME_FAIL_${card.difficulty}` }); }
          else { /* HP=1 时失败但不扣血，允许上帝之手 */ }
        }
        break;
      }
      case 'JUMPSCARE': {
        // 78% 玩家来得及，22% 扣血
        if (Math.random() > 0.78) {
          hp = Math.max(0, hp - 1); deck.hp = hp;
          hpLog.push({ move: moves, reason: 'JUMPSCARE_SLOW' });
        }
        break;
      }
      case 'BEAUTY_TRAP': {
        // 50% 跟上 → 触发 MINIGAME
        if (Math.random() < 0.50) {
          const passed = Math.random() < 0.60;
          if (!passed && hp > 1) { hp--; deck.hp = hp; hpLog.push({ move: moves, reason: 'BEAUTY_TRAP_FAIL' }); }
        }
        break;
      }
      case 'REWARD_MIRAGE': {
        // 55% 概率回血（hp < 3）
        if (hp < 3 && Math.random() < 0.55) { hp++; deck.hp = hp; }
        break;
      }
      case 'REVELATION': {
        if (card.flag) deck.knowledgeFlags[card.flag] = true;
        break;
      }
      case 'PAYOFF': {
        // 玩家大多选休息（60%）→ 回血
        if (hp < 3 && Math.random() < 0.60) { hp++; deck.hp = hp; }
        break;
      }
      // BREADCRUMB, FAKE_EXIT, ECHO_LOOP, MEMORY_SCRAMBLE, EMPTY: 无 HP 影响
    }
  }

  return { gameId, moves, hp, trialCount, mechCounts, hpLog, deckLog };
}

// ──────────────────────────────────────────────────────────────
const N = 1000;
const results = Array.from({ length: N }, (_, i) => simulateGame(i));

const avgMoves   = (results.reduce((a,r) => a + r.moves, 0) / N).toFixed(1);
const avgTrials  = (results.reduce((a,r) => a + r.trialCount, 0) / N).toFixed(2);
const hpZero     = results.filter(r => r.hp <= 0).length;
const deathRate  = ((hpZero / N) * 100).toFixed(1);

// 机制触发汇总
const allMechs = {};
results.forEach(r => Object.entries(r.mechCounts).forEach(([m,c]) => { allMechs[m] = (allMechs[m]||0) + c; }));
const totalMechs = Object.values(allMechs).reduce((a,b) => a+b, 0);

// HP 损失来源
const hpCauses = {};
results.forEach(r => r.hpLog.forEach(e => { hpCauses[e.reason] = (hpCauses[e.reason]||0) + 1; }));

// Trial 时序（前15步 vs 16-35 vs 36+）
const t1 = results.reduce((a,r) => a + r.deckLog.filter(e=>e.move<=15&&e.mech==='MINIGAME').length, 0);
const t2 = results.reduce((a,r) => a + r.deckLog.filter(e=>e.move>15&&e.move<=35&&e.mech==='MINIGAME').length, 0);
const t3 = results.reduce((a,r) => a + r.deckLog.filter(e=>e.move>35&&e.mech==='MINIGAME').length, 0);

// Difficulty 分布（MINIGAME only）
const diffDist = {};
results.forEach(r => r.deckLog.forEach(e => {
  if (e.mech === 'MINIGAME' && e.diff) diffDist[e.diff] = (diffDist[e.diff]||0) + 1;
}));

// 连续 trial 分析（两连 trial）
let consecTrials = 0;
results.forEach(r => {
  let prev = false;
  for (const e of r.deckLog) {
    if (e.mech === 'MINIGAME') { if (prev) consecTrials++; prev = true; }
    else prev = false;
  }
});

// 每局 HP 分布
const hpDist = { 0:0, 1:0, 2:0, 3:0 };
results.forEach(r => { hpDist[Math.max(0, Math.min(3, r.hp))]++; });

console.log(`\n════════ 模拟报告 v2（${N} 局）════════`);
console.log(`平均步数：${avgMoves}   平均 Trial：${avgTrials} 次/局   HP 耗尽率：${deathRate}%`);
console.log(`\n── 结束时 HP 分布 ──`);
[3,2,1,0].forEach(h => console.log(`  HP=${h}  ${'█'.repeat(Math.round(hpDist[h]/N*40))} ${hpDist[h]} 局 (${(hpDist[h]/N*100).toFixed(1)}%)`));
console.log(`\n── 机制触发分布 ──`);
Object.entries(allMechs).sort((a,b)=>b[1]-a[1]).forEach(([m,c]) => {
  const pct = (c/totalMechs*100).toFixed(1);
  const eff = MECH_EFFECTS[m] || '?';
  console.log(`  ${m.padEnd(18)} ${c.toString().padStart(5)} 次 (${pct.padStart(5)}%)  [${eff}]`);
});
console.log(`\n── HP 损失来源 ──`);
const totalHpLoss = Object.values(hpCauses).reduce((a,b)=>a+b,0);
Object.entries(hpCauses).sort((a,b)=>b[1]-a[1]).forEach(([c,n]) =>
  console.log(`  ${c.padEnd(25)} ${n.toString().padStart(4)} 次 (${(n/totalHpLoss*100).toFixed(1)}%)`));
console.log(`\n── Trial 时序分布 ──`);
console.log(`  步骤 ≤15: ${t1}   16-35: ${t2}   36+: ${t3}`);
const trialTotal = t1+t2+t3;
console.log(`  前期占比: ${(t1/trialTotal*100).toFixed(1)}%  中期: ${(t2/trialTotal*100).toFixed(1)}%  后期: ${(t3/trialTotal*100).toFixed(1)}%`);
console.log(`\n── Trial 难度分布 ──`);
Object.entries(diffDist).forEach(([d,n]) => console.log(`  ${d.padEnd(8)} ${n} 次 (${(n/(t1+t2+t3)*100).toFixed(1)}%)`));
console.log(`\n── 连续 Trial 分析 ──`);
console.log(`  两连 Trial 出现 ${consecTrials} 次 / ${N} 局 (均值 ${(consecTrials/N).toFixed(2)} 次/局)`);

console.log(`\n── 问题诊断 ──`);
const ISSUES = [];
const trialPct = (allMechs['MINIGAME']||0)/totalMechs*100;
const jumpPct  = (allMechs['JUMPSCARE']||0)/totalMechs*100;
const emptyPct = (allMechs['EMPTY']||0)/totalMechs*100;
if (trialPct > 35) ISSUES.push(`⚠️  MINIGAME 占 ${trialPct.toFixed(1)}% > 35%，节奏偏考试化`);
if (trialPct < 15) ISSUES.push(`⚠️  MINIGAME 占 ${trialPct.toFixed(1)}% < 15%，考验感太弱`);
if (parseFloat(deathRate) > 45) ISSUES.push(`⚠️  HP 耗尽率 ${deathRate}% 偏高`);
if (parseFloat(deathRate) < 8)  ISSUES.push(`⚠️  HP 耗尽率 ${deathRate}% 偏低，挑战感不足`);
if (parseFloat(avgTrials) > 7) ISSUES.push(`⚠️  平均 ${avgTrials} 次 Trial/局，压迫感可能过强`);
if (jumpPct > 15) ISSUES.push(`⚠️  JUMPSCARE 占 ${jumpPct.toFixed(1)}%，烦躁感风险`);
if (emptyPct > 35) ISSUES.push(`⚠️  EMPTY 占 ${emptyPct.toFixed(1)}%，节奏偏松`);
if (t1 / (trialTotal||1) > 0.55) ISSUES.push(`⚠️  Trial 过度集中在早期 (${(t1/trialTotal*100).toFixed(1)}%)`);
if (consecTrials / N > 0.8) ISSUES.push(`⚠️  两连 Trial 平均 ${(consecTrials/N).toFixed(2)} 次/局，连续压迫过强`);
if (ISSUES.length === 0) ISSUES.push('✅ 各项指标在合理范围内');
ISSUES.forEach(i => console.log(' ', i));
console.log('\n════════════════════════════════════\n');
