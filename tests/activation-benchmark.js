'use strict';

// ─── Activation Memory Benchmark Suite ────────────────────────────────────
// Tests the Bayesian ACT-R activation engine across 8 dimensions.
// Run: node tests/activation-benchmark.js

const path = require('path');
const activation = require('../server/activation.js');

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeChunk(id, prior = 0.5) {
  return {
    id,
    content: `chunk-${id}`,
    summary: `summary for ${id}`,
    tags: [],
    useCount: 0,
    hitCount: 0,
    missCount: 0,
    junk: false,
    lastUsedAtCall: -999,
    _activation: activation.createActivation(prior),
  };
}

/** Spearman rank correlation between two arrays of equal length. */
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

/** Percentile from sorted array. */
function percentile(sorted, p) {
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ─── Results Collector ────────────────────────────────────────────────────

const results = [];

function report(name, score, pass, detail) {
  results.push({ name, score, pass, detail });
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: Retrieval Quality — Hit-Favored Ranking
// ═══════════════════════════════════════════════════════════════════════════

function testHitFavoredRanking() {
  const chunks = [];
  for (let i = 0; i < 20; i++) chunks.push(makeChunk(`hit-${i}`));
  const now = Date.now();

  // Give all chunks some access history so they have a base-level activation
  for (const c of chunks) {
    activation.recordAccess(c, null, now - 60000);
    activation.recordAccess(c, null, now - 30000);
  }

  // Mark first 5 as "hit" chunks — record multiple hits
  const hitChunks = new Set();
  for (let i = 0; i < 5; i++) {
    hitChunks.add(chunks[i].id);
    for (let r = 0; r < 5; r++) {
      activation.recordHitSignal(chunks[i]);
    }
    // Also record access with each hit (simulating in-game usage)
    activation.recordAccess(chunks[i], null, now - 10000 + i * 100);
  }

  // Rank with hitBonus context enabled
  const context = { hitBonus: true };
  const ranked = activation.rankByActivation(chunks, context, 20);
  const top5 = ranked.slice(0, 5);
  const hitInTop5 = top5.filter(c => hitChunks.has(c.id)).length;
  const score = hitInTop5 / 5;

  report(
    'Hit-Favored Ranking',
    `${(score * 100).toFixed(0)}%`,
    score >= 0.6,
    `${hitInTop5}/5 hit chunks in top 5`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: Decay Behavior
// ═══════════════════════════════════════════════════════════════════════════

function testDecayBehavior() {
  const N = 10;
  const chunks = [];
  const now = Date.now();

  // Create chunks accessed at increasing times ago
  // chunk[0] accessed 1 minute ago (most recent), chunk[9] accessed 100 minutes ago
  for (let i = 0; i < N; i++) {
    const c = makeChunk(`decay-${i}`);
    const minutesAgo = 1 + i * 10; // 1, 11, 21, ..., 91
    activation.recordAccess(c, null, now - minutesAgo * 60000);
    chunks.push(c);
  }

  // Compute activation scores (no context, deterministic part)
  // Run multiple times and average to smooth out noise
  const avgScores = chunks.map(() => 0);
  const trials = 50;
  for (let t = 0; t < trials; t++) {
    for (let i = 0; i < N; i++) {
      // Invalidate cache to get fresh computation
      chunks[i]._activation.cachedScore = null;
      avgScores[i] += activation.computeActivation(chunks[i], null, now);
    }
  }
  for (let i = 0; i < N; i++) avgScores[i] /= trials;

  // Recency array: chunk 0 is most recent (highest recency rank)
  const recency = chunks.map((_, i) => N - i); // N, N-1, ..., 1
  const activationVals = avgScores;

  const rho = spearmanCorrelation(recency, activationVals);
  const pass = rho > 0.7;

  report(
    'Decay Behavior',
    rho.toFixed(3),
    pass,
    `Spearman rho=${rho.toFixed(3)} (recency vs activation)`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: Context Sensitivity (Entity Model)
// ═══════════════════════════════════════════════════════════════════════════

function testContextSensitivity() {
  const N = 20;
  const chunks = [];
  const now = Date.now();

  // Create chunks — half with 'cautious' tag, half with 'temptation-prone'
  for (let i = 0; i < N; i++) {
    const c = makeChunk(`ctx-${i}`);
    const tag = i < 10 ? 'cautious' : 'temptation-prone';
    // Access with the corresponding behavior tag multiple times
    for (let r = 0; r < 5; r++) {
      activation.recordAccess(c, { behaviorTags: [tag] }, now - (60000 - r * 1000));
    }
    c._tag = tag; // stash for scoring
    chunks.push(c);
  }

  // Query with 'cautious' context
  const context = { behaviorTags: ['cautious'] };
  const ranked = activation.rankByActivation(chunks, context, N);
  const top5 = ranked.slice(0, 5);
  const correctInTop5 = top5.filter(c => c._tag === 'cautious').length;
  const precision = correctInTop5 / 5;

  report(
    'Context Sensitivity',
    `${(precision * 100).toFixed(0)}%`,
    precision >= 0.6,
    `precision@5=${correctInTop5}/5 for 'cautious' context`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4: Consolidation
// ═══════════════════════════════════════════════════════════════════════════

function testConsolidation() {
  // We test consolidation logic directly through activation thresholds.
  // Create episodes: some with high activation (many recent accesses), some with low.
  const cfg = activation.getConfig();
  const now = Date.now();

  const highCount = 5;
  const lowCount = 10;
  const episodes = [];

  // High-activation episodes: many very recent accesses
  for (let i = 0; i < highCount; i++) {
    const ep = {
      type: 'trial',
      step: i,
      material: `high-material-${i}`,
      outcome: 'pass',
      hit: true,
      timestamp: new Date(now - 10000 - i * 1000).toISOString(),
      _activation: activation.createActivation(0.8),
    };
    // Pump up activation with many recent accesses
    for (let r = 0; r < 15; r++) {
      activation.recordAccess(ep, null, now - (5000 - r * 100));
    }
    activation.recordHitSignal(ep);
    episodes.push({ ep, expectedConsolidate: true });
  }

  // Low-activation episodes: single old access
  for (let i = 0; i < lowCount; i++) {
    const ep = {
      type: 'trial',
      step: highCount + i,
      material: `low-material-${i}`,
      outcome: 'fail',
      hit: false,
      timestamp: new Date(now - 3600000 - i * 60000).toISOString(),
      _activation: activation.createActivation(0.2),
    };
    // Single access far in the past
    activation.recordAccess(ep, null, now - 7200000);
    episodes.push({ ep, expectedConsolidate: false });
  }

  // Determine which would pass the consolidation threshold
  const consolidated = [];
  for (const { ep, expectedConsolidate } of episodes) {
    ep._activation.cachedScore = null;
    const score = activation.computeActivation(ep, null, now);
    if (score >= cfg.CONSOLIDATION_THRESHOLD) {
      consolidated.push({ ep, expectedConsolidate });
    }
  }

  // Precision: of those that were consolidated, how many should have been?
  const truePositives = consolidated.filter(c => c.expectedConsolidate).length;
  const precision = consolidated.length > 0 ? truePositives / consolidated.length : 0;

  // Recall: of those that should consolidate, how many did?
  const shouldConsolidate = episodes.filter(e => e.expectedConsolidate).length;
  const recall = shouldConsolidate > 0 ? truePositives / shouldConsolidate : 0;

  report(
    'Consolidation',
    `P=${(precision * 100).toFixed(0)}% R=${(recall * 100).toFixed(0)}%`,
    precision >= 0.7 && recall >= 0.5,
    `${truePositives} true positives, ${consolidated.length} consolidated, ${shouldConsolidate} expected`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5: Cold Start Prior
// ═══════════════════════════════════════════════════════════════════════════

function testColdStartPrior() {
  const N = 20;
  const chunks = [];
  const priors = [];

  // Create chunks with linearly spaced priors from 0.05 to 0.95
  for (let i = 0; i < N; i++) {
    const prior = 0.05 + (0.9 * i) / (N - 1);
    const c = makeChunk(`prior-${i}`, prior);
    // No access history — pure cold start
    chunks.push(c);
    priors.push(prior);
  }

  // Compute average scores over multiple runs (to smooth noise)
  const avgScores = chunks.map(() => 0);
  const trials = 100;
  for (let t = 0; t < trials; t++) {
    for (let i = 0; i < N; i++) {
      chunks[i]._activation.cachedScore = null;
      avgScores[i] += activation.computeActivation(chunks[i], null, Date.now());
    }
  }
  for (let i = 0; i < N; i++) avgScores[i] /= trials;

  const rho = spearmanCorrelation(priors, avgScores);
  const pass = rho > 0.8;

  report(
    'Cold Start Prior',
    rho.toFixed(3),
    pass,
    `Spearman rho=${rho.toFixed(3)} (prior vs activation)`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 6: Performance
// ═══════════════════════════════════════════════════════════════════════════

function testPerformance() {
  const N = 500;
  const chunks = [];
  const now = Date.now();

  for (let i = 0; i < N; i++) {
    const c = makeChunk(`perf-${i}`, Math.random());
    // Give varying access histories
    const accessCount = 1 + Math.floor(Math.random() * 10);
    for (let a = 0; a < accessCount; a++) {
      activation.recordAccess(c, {
        behaviorTags: [Math.random() > 0.5 ? 'cautious' : 'reckless'],
      }, now - Math.random() * 3600000);
    }
    chunks.push(c);
  }

  const context = { behaviorTags: ['cautious'], hitBonus: true };

  // Warmup: 10 untimed runs to let V8 JIT optimize hot paths
  for (let w = 0; w < 10; w++) {
    for (const c of chunks) c._activation.cachedScore = null;
    activation.rankByActivation(chunks, context, N);
  }

  const latencies = [];
  const runs = 50;

  for (let r = 0; r < runs; r++) {
    // Invalidate all caches so we measure full computation
    for (const c of chunks) c._activation.cachedScore = null;
    const start = performance.now();
    activation.rankByActivation(chunks, context, N);
    const elapsed = performance.now() - start;
    latencies.push(elapsed);
  }

  latencies.sort((a, b) => a - b);
  const p50 = percentile(latencies, 50);
  const p99 = percentile(latencies, 99);
  const pass = p99 < 5;

  report(
    'Performance (500 chunks)',
    `p50=${p50.toFixed(2)}ms p99=${p99.toFixed(2)}ms`,
    pass,
    `pass if p99 < 5ms`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 7: Migration Correctness
// ═══════════════════════════════════════════════════════════════════════════

function testMigration() {
  const checks = [];

  // Case A: Legacy chunk with moderate usage
  const chunkA = {
    id: 'legacy-a',
    content: 'legacy chunk A',
    useCount: 10,
    hitCount: 3,
    lastUsedAtCall: 50,
  };
  activation.migrateFromLegacy(chunkA, 100, 120000);
  checks.push({
    label: 'has _activation',
    pass: !!chunkA._activation,
  });
  checks.push({
    label: 'accessTimestamps populated',
    pass: chunkA._activation && chunkA._activation.accessTimestamps.length > 0,
  });
  checks.push({
    label: 'hitCount transferred to _hit tag',
    pass: chunkA._activation && chunkA._activation.contextTags._hit === 3,
  });
  checks.push({
    label: 'importancePrior > 0.5 for hit chunk',
    pass: chunkA._activation && chunkA._activation.importancePrior > 0.5,
  });
  // Activation should be computable and finite
  const scoreA = activation.computeActivation(chunkA, null, Date.now());
  checks.push({
    label: 'activation score is finite',
    pass: Number.isFinite(scoreA),
  });

  // Case B: Legacy chunk with zero usage
  const chunkB = {
    id: 'legacy-b',
    content: 'never used legacy chunk',
    useCount: 0,
    hitCount: 0,
    lastUsedAtCall: -999,
  };
  activation.migrateFromLegacy(chunkB, 100, 120000);
  checks.push({
    label: 'zero-use chunk has _activation',
    pass: !!chunkB._activation,
  });
  checks.push({
    label: 'zero-use chunk has empty timestamps',
    pass: chunkB._activation && chunkB._activation.accessTimestamps.length === 0,
  });
  checks.push({
    label: 'zero-use importancePrior is 0.4',
    pass: chunkB._activation && chunkB._activation.importancePrior === 0.4,
  });

  // Case C: Legacy chunk with many uses (triggers folding)
  const chunkC = {
    id: 'legacy-c',
    content: 'heavily used chunk',
    useCount: 50,
    hitCount: 10,
    lastUsedAtCall: 95,
  };
  activation.migrateFromLegacy(chunkC, 100, 120000);
  const cfg = activation.getConfig();
  checks.push({
    label: 'heavy-use timestamps capped at MAX',
    pass: chunkC._activation && chunkC._activation.accessTimestamps.length <= cfg.MAX_TIMESTAMPS,
  });
  checks.push({
    label: 'heavy-use foldedCount > 0',
    pass: chunkC._activation && chunkC._activation.foldedCount > 0,
  });
  checks.push({
    label: 'heavy-use foldedActivation > 0',
    pass: chunkC._activation && chunkC._activation.foldedActivation > 0,
  });

  // Case D: Already migrated chunk should not be overwritten
  const chunkD = {
    id: 'already-migrated',
    _activation: activation.createActivation(0.9),
    useCount: 5,
    hitCount: 2,
  };
  const origActivation = chunkD._activation;
  activation.migrateFromLegacy(chunkD, 100, 120000);
  checks.push({
    label: 'already-migrated chunk preserved',
    pass: chunkD._activation === origActivation,
  });

  const passed = checks.filter(c => c.pass).length;
  const total = checks.length;
  const allPass = passed === total;
  const failedNames = checks.filter(c => !c.pass).map(c => c.label);

  report(
    'Migration Correctness',
    `${passed}/${total}`,
    allPass,
    allPass ? 'all checks passed' : `FAILED: ${failedNames.join(', ')}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 8: Anti-Stagnation (Noise)
// ═══════════════════════════════════════════════════════════════════════════

function testAntiStagnation() {
  const chunk = makeChunk('noise-test', 0.5);
  const now = Date.now();

  // Give it some access history
  activation.recordAccess(chunk, null, now - 60000);
  activation.recordAccess(chunk, null, now - 30000);

  const scores = [];
  for (let i = 0; i < 100; i++) {
    // Invalidate cache each time so the deterministic part is recomputed
    // (but noise is always added fresh on top)
    chunk._activation.cachedScore = null;
    scores.push(activation.computeActivation(chunk, null, now));
  }

  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
  const stddev = Math.sqrt(variance);
  const cv = Math.abs(mean) > 1e-9 ? stddev / Math.abs(mean) : stddev;

  const pass = cv > 0.05;

  report(
    'Anti-Stagnation (Noise)',
    `CV=${cv.toFixed(4)}`,
    pass,
    `mean=${mean.toFixed(3)} std=${stddev.toFixed(3)} cv=${cv.toFixed(4)} (need >0.05)`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Run all tests and print report
// ═══════════════════════════════════════════════════════════════════════════

function printReport() {
  const colName = 32;
  const colScore = 28;
  const colResult = 6;

  const sep = '-'.repeat(colName + colScore + colResult + 10);
  console.log();
  console.log('  Activation Memory Benchmark');
  console.log('  ' + sep);
  console.log(
    '  ' +
    'Test'.padEnd(colName) +
    'Score'.padEnd(colScore) +
    'Result'.padEnd(colResult)
  );
  console.log('  ' + sep);

  let passed = 0;
  let total = results.length;

  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    const marker = r.pass ? '  ' : '! ';
    console.log(
      marker +
      r.name.padEnd(colName) +
      String(r.score).padEnd(colScore) +
      status.padEnd(colResult)
    );
    if (!r.pass) {
      console.log('    -> ' + r.detail);
    }
    if (r.pass) passed++;
  }

  console.log('  ' + sep);
  const overall = total > 0 ? ((passed / total) * 100).toFixed(0) : 0;
  const allPass = passed === total;
  console.log(`  Overall: ${passed}/${total} passed (${overall}%)`);
  console.log('  ' + sep);
  console.log();

  if (!allPass) {
    console.log('  Failed tests:');
    for (const r of results) {
      if (!r.pass) console.log(`    - ${r.name}: ${r.detail}`);
    }
    console.log();
  }

  process.exitCode = allPass ? 0 : 1;
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 9: Novelty Guarantee (getAvailableChunks novelty-first behavior)
// ═══════════════════════════════════════════════════════════════════════════

function testNoveltyGuarantee() {
  // Simulate the novelty-first selection logic from fact-db.getAvailableChunks
  // We can't call fact-db directly (it needs loadDb + real data dir),
  // so we replicate the exact partition logic here to test the principle.

  const N = 30;
  const chunks = [];
  const now = Date.now();

  // 15 "used" chunks with HIGH activation (previously effective material)
  for (let i = 0; i < 15; i++) {
    const c = makeChunk(`used-${i}`, 0.9);
    c.useCount = 3 + i;
    c.lastUsedAtCall = 0;
    // Pump up activation: many recent accesses + hits
    for (let r = 0; r < 10; r++) {
      activation.recordAccess(c, { behaviorTags: ['cautious'] }, now - r * 1000);
    }
    for (let h = 0; h < 5; h++) activation.recordHitSignal(c);
    chunks.push(c);
  }

  // 15 "novel" chunks with LOW activation (never used, low prior)
  for (let i = 0; i < 15; i++) {
    const c = makeChunk(`novel-${i}`, 0.3);
    c.useCount = 0;
    c.lastUsedAtCall = -999;
    // No access history — pure cold start
    chunks.push(c);
  }

  // Replicate getAvailableChunks novelty-first logic
  const neverUsed = chunks.filter(c => (c.useCount || 0) === 0);
  const used = chunks.filter(c => (c.useCount || 0) > 0);

  const requestCount = 5;
  const context = { behaviorTags: ['cautious'], hitBonus: true };
  const rankedNovel = activation.rankByActivation(neverUsed, context, requestCount);

  let selected;
  if (rankedNovel.length >= requestCount) {
    selected = rankedNovel.slice(0, requestCount);
  } else {
    const remaining = requestCount - rankedNovel.length;
    const rankedUsed = activation.rankByActivation(used, context, remaining);
    selected = [...rankedNovel, ...rankedUsed].slice(0, requestCount);
  }

  // Score: what fraction of the top-5 selection are novel chunks?
  const novelInSelection = selected.filter(c => c.id.startsWith('novel-')).length;
  const novelFraction = novelInSelection / requestCount;

  // Also verify: the used chunks (with 5x higher activation) did NOT steal slots
  const usedInSelection = selected.filter(c => c.id.startsWith('used-')).length;

  report(
    'Novelty Guarantee',
    `${(novelFraction * 100).toFixed(0)}% novel`,
    novelFraction >= 0.8,
    `${novelInSelection}/${requestCount} novel, ${usedInSelection} used (novel pool=15, should dominate)`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 10: Novelty Exhaustion Fallback
// ═══════════════════════════════════════════════════════════════════════════

function testNoveltyExhaustion() {
  // When novel chunks are exhausted, used chunks should backfill
  // AND activation should rank the backfill meaningfully (not random)
  const now = Date.now();
  const chunks = [];

  // Only 2 novel chunks
  for (let i = 0; i < 2; i++) {
    const c = makeChunk(`scarce-novel-${i}`, 0.5);
    c.useCount = 0;
    c.lastUsedAtCall = -999;
    chunks.push(c);
  }

  // 20 used chunks with varying activation (some high, some low)
  for (let i = 0; i < 20; i++) {
    const c = makeChunk(`scarce-used-${i}`, 0.5);
    c.useCount = 1 + i;
    c.lastUsedAtCall = 0;
    // Vary activation: first 5 have high activation
    const accessCount = i < 5 ? 8 : 1;
    for (let r = 0; r < accessCount; r++) {
      activation.recordAccess(c, null, now - r * 60000);
    }
    chunks.push(c);
  }

  const neverUsed = chunks.filter(c => (c.useCount || 0) === 0);
  const used = chunks.filter(c => (c.useCount || 0) > 0);

  const requestCount = 5;
  const rankedNovel = activation.rankByActivation(neverUsed, null, requestCount);

  let selected;
  if (rankedNovel.length >= requestCount) {
    selected = rankedNovel.slice(0, requestCount);
  } else {
    const remaining = requestCount - rankedNovel.length;
    const rankedUsed = activation.rankByActivation(used, null, remaining);
    selected = [...rankedNovel, ...rankedUsed].slice(0, requestCount);
  }

  const novelInSelection = selected.filter(c => c.id.startsWith('scarce-novel')).length;
  const totalSelected = selected.length;

  // Should have exactly 2 novel + 3 backfill = 5 total
  const correctTotal = totalSelected === requestCount;
  const novelFirst = novelInSelection === 2;

  report(
    'Novelty Exhaustion Fallback',
    `${novelInSelection} novel + ${totalSelected - novelInSelection} backfill`,
    correctTotal && novelFirst,
    `total=${totalSelected} (need ${requestCount}), novel=${novelInSelection} (need 2)`
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────

console.log('Running activation benchmark...');
console.log(`Config: ${JSON.stringify(activation.getConfig())}`);
console.log();

testHitFavoredRanking();
testDecayBehavior();
testContextSensitivity();
testConsolidation();
testColdStartPrior();
testPerformance();
testMigration();
testAntiStagnation();
testNoveltyGuarantee();
testNoveltyExhaustion();

printReport();
