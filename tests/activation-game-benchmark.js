'use strict';

// ─── Game-Scenario Benchmark Suite for ClawTrap Activation Memory ──────────
// Tests real multi-game player scenarios, not just unit math.
// Run: node tests/activation-game-benchmark.js

const activation = require('../server/activation.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeChunk(id, prior = 0.5, theme = null) {
  return {
    id,
    fileId: theme || 'f001',
    content: `content-${id}`,
    summary: `summary-${id}`,
    tags: theme ? [`theme:${theme}`] : [],
    useCount: 0,
    hitCount: 0,
    missCount: 0,
    junk: false,
    lastUsedAtCall: -999,
    _activation: activation.createActivation(prior),
    _theme: theme,
  };
}

function makeEpisode(type, step, material, outcome, hit, prior) {
  return {
    type,
    step,
    material,
    outcome,
    hit: !!hit,
    timestamp: new Date().toISOString(),
    _activation: activation.createActivation(prior),
  };
}

function spearmanCorrelation(a, b) {
  const n = a.length;
  if (n < 2) return 0;
  const rankOf = (arr) => {
    const sorted = arr.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
    const ranks = new Array(n);
    for (let k = 0; k < n; k++) ranks[sorted[k].i] = k + 1;
    return ranks;
  };
  const ra = rankOf(a);
  const rb = rankOf(b);
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function percentile(sorted, p) {
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function shannonEntropy(counts, base) {
  const total = counts.reduce((s, c) => s + c, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c > 0) {
      const p = c / total;
      h -= p * Math.log2(p);
    }
  }
  return h / Math.log2(base || counts.length);
}

/** Replicate fact-db getAvailableChunks novelty-first + staleness-weighted backfill */
function selectChunks(chunks, count, context, globalCounter) {
  const cfg = activation.getConfig();
  const neverUsed = chunks.filter(c => !c.junk && (c.useCount || 0) === 0);
  const used = chunks.filter(c =>
    !c.junk && (c.useCount || 0) > 0 &&
    globalCounter - (c.lastUsedAtCall || 0) >= cfg.MIN_CALL_GAP
  );
  const rankedNovel = activation.rankByActivation(neverUsed, context, count);
  if (rankedNovel.length >= count) return rankedNovel.slice(0, count);

  // Backfill: staleness-weighted (0.7) + activation tiebreaker (0.3)
  const remaining = count - rankedNovel.length;
  const maxGap = Math.max(1, globalCounter);
  const nowMs = Date.now();
  const backfill = used.map(c => {
    const staleness = (globalCounter - (c.lastUsedAtCall || 0)) / maxGap;
    c._activation.cachedScore = null;
    const act = activation.computeActivation(c, context, nowMs);
    const actNorm = 1 / (1 + Math.exp(-act));
    return { chunk: c, score: staleness * 0.7 + actNorm * 0.3 };
  });
  backfill.sort((a, b) => b.score - a.score);
  return [...rankedNovel, ...backfill.slice(0, remaining).map(b => b.chunk)];
}

function markUsed(chunk, context, nowMs, globalCounter) {
  chunk.useCount = (chunk.useCount || 0) + 1;
  chunk.lastUsedAtCall = globalCounter;
  activation.recordAccess(chunk, context, nowMs);
}

// ─── Results ──────────────────────────────────────────────────────────────

const results = [];
function report(name, score, pass, detail) {
  results.push({ name, score, pass, detail });
}

// ═══════════════════════════════════════════════════════════════════════════
// SUITE A: Multi-Game Simulation
// ═══════════════════════════════════════════════════════════════════════════

function testA1_LearningCurve() {
  const context = {
    behaviorTags: ['cautious', 'trial-strong'],
    softSpotTopics: ['family', 'career'],
    hitBonus: true,
    activeTheme: 'personal',
  };
  const cfg = activation.getConfig();
  const GAME_GAP_MS = 1800000; // 30 min between games
  const STEP_MS = 120000;      // 2 min between steps

  const allEpisodes = []; // { episode, gameIdx }
  const consolidated = [];
  let baseTime = Date.now() - 10 * GAME_GAP_MS;
  const meanScoresPerGame = [];

  for (let g = 0; g < 10; g++) {
    const gameStart = baseTime + g * GAME_GAP_MS;

    // At game start (g >= 1), measure injection quality
    if (g > 0) {
      const recentGames = allEpisodes.filter(e => e.gameIdx >= Math.max(0, g - 5));
      const candidates = [...recentGames.map(e => e.episode), ...consolidated];
      if (candidates.length > 0) {
        const nowMs = gameStart;
        // Average over runs to smooth noise
        let totalScore = 0;
        const runs = 30;
        for (let r = 0; r < runs; r++) {
          for (const c of candidates) c._activation.cachedScore = null;
          const ranked = activation.rankByActivation(candidates, context, 12);
          const meanAct = ranked.reduce((s, ep) => {
            ep._activation.cachedScore = null;
            return s + activation.computeActivation(ep, context, nowMs);
          }, 0) / ranked.length;
          totalScore += meanAct;
        }
        meanScoresPerGame.push(totalScore / runs);
      }
    }

    // Generate 6 episodes per game
    const materials = ['family_photo', 'career_plan', 'secret_diary', 'old_email', 'school_paper', 'chat_log'];
    for (let s = 0; s < 6; s++) {
      const isHit = s < 2; // 2 hits per game
      const type = s < 3 ? 'trial' : 'temptation';
      const outcome = type === 'trial' ? (isHit ? 'pass' : 'fail') : (s < 4 ? 'follow' : 'ignore');
      const prior = isHit ? 0.8 : 0.3;
      const ep = makeEpisode(type, s, materials[s], outcome, isHit, prior);
      const ts = gameStart + s * STEP_MS;
      activation.recordAccess(ep, context, ts);
      if (isHit) activation.recordHitSignal(ep);
      allEpisodes.push({ episode: ep, gameIdx: g });
    }

    // End-of-game consolidation
    const nowEnd = gameStart + 6 * STEP_MS;
    for (const { episode: ep } of allEpisodes) {
      ep._activation.cachedScore = null;
      const score = activation.computeActivation(ep, context, nowEnd);
      if (score >= cfg.CONSOLIDATION_THRESHOLD) {
        const exists = consolidated.find(c => c.timestamp === ep.timestamp && c.step === ep.step);
        if (!exists) {
          const copy = { ...ep, _activation: { ...ep._activation } };
          copy._activation.foldedActivation += 1.0;
          copy._activation.cachedScore = null;
          consolidated.push(copy);
        }
      }
    }
    if (consolidated.length > 30) {
      const scored = consolidated.map(c => ({
        c, s: activation.computeActivation(c, context, nowEnd)
      }));
      scored.sort((a, b) => b.s - a.s);
      consolidated.length = 0;
      consolidated.push(...scored.slice(0, 30).map(x => x.c));
    }
  }

  const gameNums = meanScoresPerGame.map((_, i) => i + 2);
  const rho = spearmanCorrelation(gameNums, meanScoresPerGame);
  const score = Math.max(0, Math.round(rho * 100));

  report('A1: Learning Curve', `rho=${rho.toFixed(3)}`, rho >= 0.6,
    `injection score trend over 9 games: rho=${rho.toFixed(3)}`);
}

function testA2_NoveltyDepletion() {
  const TOTAL_CHUNKS = 50;
  const ROUNDS_PER_GAME = 50;
  const GAMES = 5;
  const context = { behaviorTags: ['cautious'], hitBonus: false };

  const chunks = [];
  for (let i = 0; i < TOTAL_CHUNKS; i++) {
    chunks.push(makeChunk(`depl-${i}`, 0.3 + Math.random() * 0.4));
  }

  let globalCounter = 0;
  let baseTime = Date.now();
  let firstRepeatRound = null;
  const selectionCounts = new Map(); // chunkId -> count

  for (let g = 0; g < GAMES; g++) {
    for (let r = 0; r < ROUNDS_PER_GAME; r++) {
      const nowMs = baseTime + (g * ROUNDS_PER_GAME + r) * 120000;
      const selected = selectChunks(chunks, 1, context, globalCounter);
      if (selected.length > 0) {
        const c = selected[0];
        const wasUsedBefore = (c.useCount || 0) > 0;
        if (wasUsedBefore && firstRepeatRound === null && g === 0) {
          firstRepeatRound = r;
        }
        markUsed(c, context, nowMs, globalCounter);
        globalCounter++;
        selectionCounts.set(c.id, (selectionCounts.get(c.id) || 0) + 1);
      }
    }
  }

  const coveragePct = selectionCounts.size / TOTAL_CHUNKS * 100;
  const counts = Array.from(selectionCounts.values());
  const normEntropy = shannonEntropy(counts, TOTAL_CHUNKS);

  if (firstRepeatRound === null) firstRepeatRound = ROUNDS_PER_GAME;

  const sub1 = firstRepeatRound >= 48 ? 1 : 0;
  const sub2 = coveragePct >= 95 ? 1 : 0;
  const sub3 = normEntropy >= 0.75 ? 1 : 0;
  const score = Math.round((sub1 + sub2 + sub3) / 3 * 100);

  report('A2: Novelty Depletion',
    `repeat@${firstRepeatRound} cov=${coveragePct.toFixed(0)}% H=${normEntropy.toFixed(3)}`,
    sub1 && sub2 && sub3,
    `firstRepeat=round ${firstRepeatRound}, coverage=${coveragePct.toFixed(1)}%, entropy=${normEntropy.toFixed(3)}`);
}

function testA3_MaterialCoverage() {
  const CHUNKS_PER_FILE = 20;
  const FILES = 10;
  const THEMES = ['personal', 'work', 'hobby', 'academic', 'social'];
  const STEPS_PER_GAME = 66;
  const GAMES = 3;

  const chunks = [];
  for (let f = 0; f < FILES; f++) {
    const theme = THEMES[f % THEMES.length];
    for (let c = 0; c < CHUNKS_PER_FILE; c++) {
      const ch = makeChunk(`cov-f${f}-c${c}`, 0.2 + Math.random() * 0.6, theme);
      ch.fileId = `f${f}`;
      chunks.push(ch);
    }
  }

  let globalCounter = 0;
  let baseTime = Date.now();

  for (let g = 0; g < GAMES; g++) {
    const gameTheme = THEMES[g % THEMES.length];
    const ctx = { behaviorTags: ['cautious'], activeTheme: gameTheme, hitBonus: false };
    for (let s = 0; s < STEPS_PER_GAME; s++) {
      const nowMs = baseTime + (g * STEPS_PER_GAME + s) * 120000;
      const selected = selectChunks(chunks, 1, ctx, globalCounter);
      if (selected.length > 0) {
        markUsed(selected[0], ctx, nowMs, globalCounter);
        globalCounter++;
      }
    }
  }

  const touched = chunks.filter(c => c.useCount > 0);
  const touchedPct = touched.length / chunks.length * 100;

  // Cold spots per file
  const coldPerFile = {};
  for (const c of chunks) {
    if (c.useCount === 0) {
      coldPerFile[c.fileId] = (coldPerFile[c.fileId] || 0) + 1;
    }
  }
  const maxColdInFile = Math.max(0, ...Object.values(coldPerFile));

  const score = Math.round(touchedPct * 0.7 + Math.max(0, 1 - maxColdInFile / 20) * 30);
  const pass = touchedPct >= 80 && maxColdInFile <= 10;

  report('A3: Material Coverage',
    `${touchedPct.toFixed(1)}% touched, max cold=${maxColdInFile}`,
    pass,
    `${touched.length}/${chunks.length} chunks used, worst file has ${maxColdInFile} untouched`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SUITE B: Player Differentiation
// ═══════════════════════════════════════════════════════════════════════════

function testB4_ArchetypeDivergence() {
  const N = 100;
  const chunks = [];
  const now = Date.now();

  for (let i = 0; i < N; i++) {
    const c = makeChunk(`arch-${i}`, 0.5);
    const ctx = i < 50
      ? { behaviorTags: ['cautious', 'trial-strong'] }
      : { behaviorTags: ['temptation-prone', 'trial-weak'] };
    for (let r = 0; r < 5; r++) {
      activation.recordAccess(c, ctx, now - (60000 - r * 1000));
    }
    chunks.push(c);
  }

  const ctxA = { behaviorTags: ['cautious', 'trial-strong'], softSpotTopics: ['discipline'], hitBonus: false };
  const ctxB = { behaviorTags: ['temptation-prone', 'trial-weak'], softSpotTopics: ['pleasure'], hitBonus: true };

  // Average over multiple runs to handle noise
  const countsA = new Map();
  const countsB = new Map();
  const runs = 20;

  for (let r = 0; r < runs; r++) {
    for (const c of chunks) c._activation.cachedScore = null;
    const selA = activation.rankByActivation(chunks, ctxA, 20);
    for (const c of selA) countsA.set(c.id, (countsA.get(c.id) || 0) + 1);

    for (const c of chunks) c._activation.cachedScore = null;
    const selB = activation.rankByActivation(chunks, ctxB, 20);
    for (const c of selB) countsB.set(c.id, (countsB.get(c.id) || 0) + 1);
  }

  // Top 20 most frequently selected for each
  const topA = new Set([...countsA.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(e => e[0]));
  const topB = new Set([...countsB.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(e => e[0]));

  const intersection = [...topA].filter(id => topB.has(id)).length;
  const union = new Set([...topA, ...topB]).size;
  const jaccard = 1 - intersection / union;

  report('B4: Archetype Divergence',
    `Jaccard=${jaccard.toFixed(3)}`,
    jaccard >= 0.50,
    `|A|=${topA.size} |B|=${topB.size} |A∩B|=${intersection} |A∪B|=${union}`);
}

function testB5_BehaviorShift() {
  const chunks = [];
  const now = Date.now();

  for (let i = 0; i < 60; i++) {
    const c = makeChunk(`shift-${i}`, 0.5);
    const ctx = i < 30
      ? { behaviorTags: ['cautious'] }
      : { behaviorTags: ['reckless'] };
    for (let r = 0; r < 5; r++) {
      activation.recordAccess(c, ctx, now - (120000 - r * 1000));
    }
    c._trained = i < 30 ? 'cautious' : 'reckless';
    chunks.push(c);
  }

  // Phase 1: cautious context
  let cautiousPrecision = 0;
  const runs = 30;
  for (let r = 0; r < runs; r++) {
    for (const c of chunks) c._activation.cachedScore = null;
    const sel = activation.rankByActivation(chunks, { behaviorTags: ['cautious'] }, 10);
    cautiousPrecision += sel.filter(c => c._trained === 'cautious').length / 10;
  }
  cautiousPrecision /= runs;

  // Phase 2: reckless context
  let recklessPrecision = 0;
  for (let r = 0; r < runs; r++) {
    for (const c of chunks) c._activation.cachedScore = null;
    const sel = activation.rankByActivation(chunks, { behaviorTags: ['reckless'] }, 10);
    recklessPrecision += sel.filter(c => c._trained === 'reckless').length / 10;
  }
  recklessPrecision /= runs;

  const shiftDetected = (cautiousPrecision + recklessPrecision) / 2;
  const score = Math.round(shiftDetected * 100);

  report('B5: Behavior Shift Detection',
    `${score}% (P1=${(cautiousPrecision * 100).toFixed(0)}% P2=${(recklessPrecision * 100).toFixed(0)}%)`,
    shiftDetected >= 0.60,
    `cautious precision=${cautiousPrecision.toFixed(2)}, reckless precision=${recklessPrecision.toFixed(2)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SUITE C: Strategic Memory
// ═══════════════════════════════════════════════════════════════════════════

function testC6_HitMemoryTransfer() {
  const THEMES = ['A', 'B', 'C', 'D'];
  const chunks = [];
  const now = Date.now();

  // 40 chunks: 10 per theme
  for (const theme of THEMES) {
    for (let i = 0; i < 10; i++) {
      chunks.push(makeChunk(`hmt-${theme}-${i}`, 0.5, theme));
    }
  }

  // Game 1: use 3 chunks from theme A
  let globalCounter = 0;
  const hitChunk = chunks.find(c => c._theme === 'A' && c.id.endsWith('-0'));
  const otherA1 = chunks.find(c => c._theme === 'A' && c.id.endsWith('-1'));
  const otherA2 = chunks.find(c => c._theme === 'A' && c.id.endsWith('-2'));

  const ctxA = { activeTheme: 'A', hitBonus: true, behaviorTags: ['cautious'] };
  markUsed(hitChunk, ctxA, now - 3600000, globalCounter++);
  activation.recordHitSignal(hitChunk);
  activation.recordHitSignal(hitChunk);
  activation.recordHitSignal(hitChunk);
  markUsed(otherA1, ctxA, now - 3500000, globalCounter++);
  markUsed(otherA2, ctxA, now - 3400000, globalCounter++);

  // Game 2: use 5 chunks from various themes
  for (let i = 3; i < 6; i++) {
    const c = chunks.find(c => c._theme === 'B' && c.id.endsWith(`-${i - 3}`));
    markUsed(c, { activeTheme: 'B' }, now - 1800000, globalCounter++);
  }
  for (let i = 0; i < 2; i++) {
    const c = chunks.find(c => c._theme === 'C' && c.id.endsWith(`-${i}`));
    markUsed(c, { activeTheme: 'C' }, now - 1700000, globalCounter++);
  }

  // Game 3: select 5 chunks with theme A context
  const game3Ctx = { activeTheme: 'A', hitBonus: true, behaviorTags: ['cautious'] };
  const selected = selectChunks(chunks, 5, game3Ctx, globalCounter);

  // Check 1: hit chunk excluded (it has useCount > 0, novel chunks exist)
  const hitExcluded = !selected.some(c => c.id === hitChunk.id);

  // Check 2: theme A preference among novel selections
  const themeACounts = selected.filter(c => c._theme === 'A').length;
  const themeAFraction = themeACounts / selected.length;

  const score = (hitExcluded ? 50 : 0) + Math.round(themeAFraction * 50);

  report('C6: Hit Memory Transfer',
    `excluded=${hitExcluded} themeA=${(themeAFraction * 100).toFixed(0)}%`,
    hitExcluded && themeAFraction >= 0.40,
    `hit chunk ${hitExcluded ? 'correctly excluded' : 'INCORRECTLY included'}, ${themeACounts}/5 from theme A`);
}

function testC7_ConsolidationQuality() {
  const cfg = activation.getConfig();
  const now = Date.now();
  const context = { behaviorTags: ['cautious'], hitBonus: true };

  const episodes = [];
  // 32 winners
  for (let i = 0; i < 32; i++) {
    const ep = makeEpisode('trial', i, `winner-${i}`, 'pass', true, 0.8);
    for (let r = 0; r < 8; r++) {
      activation.recordAccess(ep, context, now - (10000 - r * 500));
    }
    for (let h = 0; h < 3; h++) activation.recordHitSignal(ep);
    episodes.push({ ep, isWinner: true });
  }
  // 48 losers
  for (let i = 0; i < 48; i++) {
    const ep = makeEpisode('trial', 32 + i, `loser-${i}`, 'fail', false, 0.2);
    activation.recordAccess(ep, null, now - 7200000); // single access, 2h ago
    episodes.push({ ep, isWinner: false });
  }

  // Consolidation
  const consolidated = [];
  for (const { ep, isWinner } of episodes) {
    ep._activation.cachedScore = null;
    const score = activation.computeActivation(ep, context, now);
    if (score >= cfg.CONSOLIDATION_THRESHOLD) {
      consolidated.push({ ep, isWinner });
    }
  }

  const tp = consolidated.filter(c => c.isWinner).length;
  const fp = consolidated.filter(c => !c.isWinner).length;
  const fn = 32 - tp;
  const precision = consolidated.length > 0 ? tp / consolidated.length : 0;
  const recall = tp / 32;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  report('C7: Consolidation Quality',
    `F1=${f1.toFixed(3)} P=${(precision * 100).toFixed(0)}% R=${(recall * 100).toFixed(0)}%`,
    precision >= 0.80 && recall >= 0.50,
    `TP=${tp} FP=${fp} FN=${fn}`);
}

function testC8_EpisodeInjectionRelevance() {
  const now = Date.now();
  const GAME_GAP = 1800000;
  const targetCtx = { behaviorTags: ['cautious'], activeTheme: 'family', hitBonus: true };
  const otherCtx1 = { behaviorTags: ['reckless'], activeTheme: 'adventure' };
  const otherCtx2 = { behaviorTags: ['stubborn'], activeTheme: 'work' };

  const allEpisodes = [];

  // Game 1 (oldest): 6 eps, 3 match target context
  for (let s = 0; s < 6; s++) {
    const isTarget = s < 3;
    const ctx = isTarget ? targetCtx : otherCtx1;
    const ep = makeEpisode('trial', s, `g1-${s}`, 'pass', isTarget, isTarget ? 0.8 : 0.3);
    const ts = now - 5 * GAME_GAP + s * 120000;
    for (let r = 0; r < 5; r++) {
      activation.recordAccess(ep, ctx, ts + r * 10000);
    }
    if (isTarget) activation.recordHitSignal(ep);
    ep._game = 1;
    ep._isTarget = isTarget;
    allEpisodes.push(ep);
  }

  // Games 2-4: all different context
  for (let g = 2; g <= 4; g++) {
    for (let s = 0; s < 6; s++) {
      const ep = makeEpisode('trial', s, `g${g}-${s}`, 'fail', false, 0.3);
      const ts = now - (5 - g) * GAME_GAP + s * 120000;
      activation.recordAccess(ep, otherCtx1, ts);
      ep._game = g;
      ep._isTarget = false;
      allEpisodes.push(ep);
    }
  }

  // Game 5 (most recent): all yet another context
  for (let s = 0; s < 6; s++) {
    const ep = makeEpisode('trial', s, `g5-${s}`, 'pass', false, 0.5);
    const ts = now - 60000 + s * 5000; // very recent
    activation.recordAccess(ep, otherCtx2, ts);
    ep._game = 5;
    ep._isTarget = false;
    allEpisodes.push(ep);
  }

  // Rank with target context
  let relevancePrecision = 0;
  let game5Count = 0;
  const runs = 50;
  for (let r = 0; r < runs; r++) {
    for (const ep of allEpisodes) ep._activation.cachedScore = null;
    const ranked = activation.rankByActivation(allEpisodes, targetCtx, 6);
    relevancePrecision += ranked.filter(ep => ep._isTarget).length / 6;
    game5Count += ranked.filter(ep => ep._game === 5).length;
  }
  relevancePrecision /= runs;
  game5Count /= runs;

  const recencyNotDominant = game5Count < 3;
  const score = Math.min(100, Math.round(relevancePrecision * 100) + (recencyNotDominant ? 20 : 0));

  report('C8: Episode Injection Relevance',
    `${(relevancePrecision * 100).toFixed(0)}% relevant, ${game5Count.toFixed(1)} from g5`,
    relevancePrecision >= 0.33,
    `target (game1) precision=${relevancePrecision.toFixed(2)}, game5 in top6=${game5Count.toFixed(1)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SUITE D: Stress & Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

function testD9_ScaleDegradation() {
  const tiers = [
    { n: 100,  budget: 2 },
    { n: 500,  budget: 5 },
    { n: 1000, budget: 12 },
    { n: 2000, budget: 30 },
    { n: 5000, budget: 80 },
  ];
  const context = { behaviorTags: ['cautious', 'trial-strong'], hitBonus: true };
  const tierResults = [];

  for (const tier of tiers) {
    const chunks = [];
    const now = Date.now();
    for (let i = 0; i < tier.n; i++) {
      const c = makeChunk(`scale-${tier.n}-${i}`, Math.random());
      const accessCount = 1 + Math.floor(Math.random() * 8);
      for (let a = 0; a < accessCount; a++) {
        activation.recordAccess(c, { behaviorTags: [Math.random() > 0.5 ? 'cautious' : 'reckless'] },
          now - Math.random() * 3600000);
      }
      chunks.push(c);
    }

    // Warmup (generous to stabilize JIT + flush GC)
    for (let w = 0; w < 20; w++) {
      for (const c of chunks) c._activation.cachedScore = null;
      activation.rankByActivation(chunks, context, tier.n);
    }
    if (global.gc) global.gc(); // flush GC if exposed (node --expose-gc)

    // Timed runs
    const latencies = [];
    for (let r = 0; r < 30; r++) {
      for (const c of chunks) c._activation.cachedScore = null;
      const start = performance.now();
      activation.rankByActivation(chunks, context, tier.n);
      latencies.push(performance.now() - start);
    }
    latencies.sort((a, b) => a - b);
    const p99 = percentile(latencies, 99);
    const pass = p99 < tier.budget;
    tierResults.push({ n: tier.n, p99, budget: tier.budget, pass });
  }

  const allPass = tierResults.every(t => t.pass);
  const passCount = tierResults.filter(t => t.pass).length;
  const detail = tierResults.map(t =>
    `${t.n}: ${t.pass ? 'OK' : 'SLOW'} p99=${t.p99.toFixed(2)}ms/${t.budget}ms`
  ).join(', ');

  report('D9: Scale Degradation',
    `${passCount}/${tiers.length} tiers`,
    allPass,
    detail);
}

function testD10_EmptyDBGraceful() {
  const checks = [];

  // 1. No _activation
  try {
    const r = activation.computeActivation({}, null, Date.now());
    checks.push({ label: 'no _activation', pass: r === -Infinity });
  } catch { checks.push({ label: 'no _activation', pass: false }); }

  // 2. Cold start, no context
  try {
    const r = activation.computeActivation({ _activation: activation.createActivation(0.5) }, null, Date.now());
    checks.push({ label: 'cold + null ctx', pass: Number.isFinite(r) });
  } catch { checks.push({ label: 'cold + null ctx', pass: false }); }

  // 3. Empty array
  try {
    const r = activation.rankByActivation([], null, 10);
    checks.push({ label: 'empty array', pass: Array.isArray(r) && r.length === 0 });
  } catch { checks.push({ label: 'empty array', pass: false }); }

  // 4. Item without _activation in rankByActivation
  try {
    const r = activation.rankByActivation([{ id: 'x' }], null, 5);
    checks.push({ label: 'item no _activation', pass: r.length === 1 });
  } catch { checks.push({ label: 'item no _activation', pass: false }); }

  // 5. recordAccess on bare object
  try {
    const obj = {};
    activation.recordAccess(obj, null, Date.now());
    checks.push({ label: 'recordAccess bare', pass: !!obj._activation });
  } catch { checks.push({ label: 'recordAccess bare', pass: false }); }

  // 6. recordHitSignal on bare object
  try {
    activation.recordHitSignal({});
    checks.push({ label: 'recordHitSignal bare', pass: true });
  } catch { checks.push({ label: 'recordHitSignal bare', pass: false }); }

  // 7. shouldRetire bare
  try {
    checks.push({ label: 'shouldRetire bare', pass: activation.shouldRetire({}) === false });
  } catch { checks.push({ label: 'shouldRetire bare', pass: false }); }

  // 8. shouldSurface bare
  try {
    checks.push({ label: 'shouldSurface bare', pass: activation.shouldSurface({}) === false });
  } catch { checks.push({ label: 'shouldSurface bare', pass: false }); }

  // 9. migrateFromLegacy zero
  try {
    const obj = {};
    activation.migrateFromLegacy(obj, 0, 0);
    checks.push({ label: 'migrate zero', pass: !!obj._activation && obj._activation.accessTimestamps.length === 0 });
  } catch { checks.push({ label: 'migrate zero', pass: false }); }

  // 10. selectChunks with empty arrays
  try {
    const r = selectChunks([], 5, null, 0);
    checks.push({ label: 'empty selectChunks', pass: Array.isArray(r) && r.length === 0 });
  } catch { checks.push({ label: 'empty selectChunks', pass: false }); }

  const passed = checks.filter(c => c.pass).length;
  const failed = checks.filter(c => !c.pass).map(c => c.label);

  report('D10: Empty DB Graceful',
    `${passed}/${checks.length}`,
    passed === checks.length,
    failed.length > 0 ? `FAILED: ${failed.join(', ')}` : 'all edge cases handled');
}

function testD11_ColdStart() {
  const chunks = [];
  for (let i = 0; i < 30; i++) {
    chunks.push(makeChunk(`cold-${i}`, 0.2 + (0.6 * i / 29)));
  }

  // Sub 1: rankByActivation with null context works
  const ranked = activation.rankByActivation(chunks, null, 10);
  const rankingWorks = ranked.length === 10 && ranked.every(c => c != null);

  // Sub 2: prior respected (average over runs)
  const priors = chunks.map(c => c._activation.importancePrior);
  const avgScores = chunks.map(() => 0);
  const runs = 50;
  for (let r = 0; r < runs; r++) {
    for (const c of chunks) c._activation.cachedScore = null;
    for (let i = 0; i < chunks.length; i++) {
      avgScores[i] += activation.computeActivation(chunks[i], null, Date.now());
    }
  }
  for (let i = 0; i < chunks.length; i++) avgScores[i] /= runs;
  const rho = spearmanCorrelation(priors, avgScores);
  const priorRespected = rho > 0.5;

  // Sub 3: episodes with no _activation
  let coldEpSafe = true;
  for (let i = 0; i < 5; i++) {
    try {
      const ep = { type: 'trial', step: i, material: `ep-${i}` };
      ep._activation = activation.createActivation(0.5);
      const s = activation.computeActivation(ep, null, Date.now());
      if (!Number.isFinite(s)) coldEpSafe = false;
    } catch { coldEpSafe = false; }
  }

  // Sub 4: novelty-first with null context
  const selected = selectChunks(chunks, 5, null, 0);
  const noveltyWorks = selected.length === 5;

  const subsPass = [rankingWorks, priorRespected, coldEpSafe, noveltyWorks].filter(Boolean).length;
  const score = Math.round(subsPass / 4 * 100);

  report('D11: Cold Start',
    `${subsPass}/4 checks (rho=${rho.toFixed(3)})`,
    subsPass === 4,
    `ranking=${rankingWorks} prior_rho=${rho.toFixed(3)} episodes=${coldEpSafe} novelty=${noveltyWorks}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Report Printer
// ═══════════════════════════════════════════════════════════════════════════

function printReport() {
  const W1 = 36, W2 = 50, W3 = 6;
  const sep = '='.repeat(W1 + W2 + W3 + 8);

  console.log();
  console.log('  ClawTrap Activation: Game-Scenario Benchmark');
  console.log('  ' + sep);
  console.log('  ' + 'Test'.padEnd(W1) + 'Score'.padEnd(W2) + 'Result');
  console.log('  ' + '-'.repeat(W1 + W2 + W3 + 8));

  let suiteHeader = '';
  const suites = { A: 'Multi-Game Simulation', B: 'Player Differentiation', C: 'Strategic Memory', D: 'Stress & Edge Cases' };

  for (const r of results) {
    const suite = r.name[0];
    if (suite !== suiteHeader) {
      suiteHeader = suite;
      console.log('  ' + `--- ${suites[suite]} ---`);
    }
    const marker = r.pass ? '  ' : '! ';
    const status = r.pass ? 'PASS' : 'FAIL';
    console.log(marker + r.name.padEnd(W1) + String(r.score).padEnd(W2) + status);
    if (!r.pass) console.log('    -> ' + r.detail);
  }

  console.log('  ' + '-'.repeat(W1 + W2 + W3 + 8));
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`  Overall: ${passed}/${total} passed`);

  // Per-suite summary
  for (const [key, name] of Object.entries(suites)) {
    const suite = results.filter(r => r.name.startsWith(key));
    const sp = suite.filter(r => r.pass).length;
    console.log(`    ${name}: ${sp}/${suite.length}`);
  }
  console.log('  ' + sep);
  console.log();

  process.exitCode = passed === total ? 0 : 1;
}

// ─── Main ─────────────────────────────────────────────────────────────────

console.log('ClawTrap Activation: Game-Scenario Benchmark');
console.log(`Config: ${JSON.stringify(activation.getConfig())}\n`);

testA1_LearningCurve();
testA2_NoveltyDepletion();
testA3_MaterialCoverage();
testB4_ArchetypeDivergence();
testB5_BehaviorShift();
testC6_HitMemoryTransfer();
testC7_ConsolidationQuality();
testC8_EpisodeInjectionRelevance();
testD9_ScaleDegradation();
testD10_EmptyDBGraceful();
testD11_ColdStart();

printReport();
