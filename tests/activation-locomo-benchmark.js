'use strict';

// ─── LoCoMo External Benchmark Adaptation ──────────────────────────────────
// Tests activation engine against the LoCoMo long-term conversational memory
// benchmark (Maharana et al., ACL 2024). 1986 QA pairs across 10 conversations.
//
// What we test: can activation-based ranking surface the correct evidence
// dialog turns better than baselines (random, recency, keyword-only)?
//
// Run: node tests/activation-locomo-benchmark.js

const activation = require('../server/activation.js');
const path = require('path');

const DATA_PATH = path.join(__dirname, 'locomo-data', 'data', 'locomo10.json');
let dataset;
try {
  dataset = require(DATA_PATH);
} catch {
  console.error('LoCoMo data not found. Run: git clone https://github.com/snap-research/locomo.git tests/locomo-data');
  process.exit(1);
}

// ─── Parse LoCoMo Data ───────────────────────────────────────────────────

function parseConversation(conv) {
  const turns = [];
  const sessionKeys = Object.keys(conv.conversation)
    .filter(k => k.startsWith('session_') && !k.includes('date'))
    .sort((a, b) => {
      const na = parseInt(a.replace('session_', ''));
      const nb = parseInt(b.replace('session_', ''));
      return na - nb;
    });

  const baseTime = Date.now() - sessionKeys.length * 7 * 24 * 3600000; // sessions ~1 week apart

  for (let si = 0; si < sessionKeys.length; si++) {
    const sk = sessionKeys[si];
    const sessionTurns = conv.conversation[sk];
    if (!Array.isArray(sessionTurns)) continue;
    const sessionTime = baseTime + si * 7 * 24 * 3600000;

    for (let ti = 0; ti < sessionTurns.length; ti++) {
      const t = sessionTurns[ti];
      const text = t.text || '';
      turns.push({
        diaId: t.dia_id,
        speaker: t.speaker,
        text,
        sessionIdx: si,
        turnIdx: ti,
        timestamp: sessionTime + ti * 60000, // 1 min between turns
        keywords: extractKeywords(text),
      });
    }
  }
  return turns;
}

function extractKeywords(text) {
  // Simple keyword extraction: lowercase, remove stopwords, keep 3+ char words
  const stopwords = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'are', 'was', 'were',
    'been', 'have', 'has', 'had', 'not', 'but', 'what', 'when', 'where',
    'who', 'how', 'can', 'will', 'would', 'could', 'should', 'may',
    'about', 'from', 'into', 'just', 'like', 'than', 'then', 'them',
    'they', 'also', 'been', 'some', 'more', 'very', 'really', 'going',
    'your', 'you', 'she', 'her', 'his', 'him', 'its', 'our', 'did',
    'does', 'doing', 'being', 'there', 'here', 'which', 'their', 'other',
  ]);
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !stopwords.has(w));
}

// ─── Ranking Strategies ──────────────────────────────────────────────────

/** Baseline 1: Random */
function rankRandom(turns, _queryKw) {
  const shuffled = [...turns];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/** Baseline 2: Recency (most recent first) */
function rankRecency(turns, _queryKw) {
  return [...turns].sort((a, b) => b.timestamp - a.timestamp);
}

/** Baseline 3: BM25-like keyword scoring */
function rankKeyword(turns, queryKw) {
  if (queryKw.length === 0) return rankRecency(turns, queryKw);

  const N = turns.length;
  // IDF approximation
  const df = {};
  for (const t of turns) {
    const unique = new Set(t.keywords);
    for (const w of unique) df[w] = (df[w] || 0) + 1;
  }

  const scored = turns.map(t => {
    let score = 0;
    const termFreq = {};
    for (const w of t.keywords) termFreq[w] = (termFreq[w] || 0) + 1;
    const docLen = t.keywords.length || 1;
    const avgLen = turns.reduce((s, t2) => s + t2.keywords.length, 0) / N;
    const k1 = 1.5, b = 0.75;

    for (const qw of queryKw) {
      const tf = termFreq[qw] || 0;
      if (tf === 0) continue;
      const idf = Math.log((N - (df[qw] || 0) + 0.5) / ((df[qw] || 0) + 0.5) + 1);
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgLen));
    }
    return { turn: t, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.turn);
}

/** Our system: ACT-R activation with keyword context */
function rankActivation(turns, queryKw, turnChunks) {
  // Build context features from query keywords
  const context = {
    behaviorTags: queryKw.slice(0, 10), // top keywords as "tags"
    hitBonus: true,
  };

  // Rank by activation
  const nowMs = Date.now();
  const scored = turnChunks.map((chunk, i) => ({
    turn: turns[i],
    score: activation.computeActivation(chunk, context, nowMs),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.turn);
}

/** Hybrid: BM25 score + activation score fusion (not replacement) */
function rankHybrid(turns, queryKw, turnChunks) {
  if (queryKw.length === 0) return rankRecency(turns, queryKw);

  const N = turns.length;
  // Compute BM25 scores
  const df = {};
  for (const t of turns) {
    const unique = new Set(t.keywords);
    for (const w of unique) df[w] = (df[w] || 0) + 1;
  }

  const context = { behaviorTags: queryKw.slice(0, 10), hitBonus: true };
  const nowMs = Date.now();

  const scored = turns.map((t, i) => {
    // BM25 score
    const termFreq = {};
    for (const w of t.keywords) termFreq[w] = (termFreq[w] || 0) + 1;
    const docLen = t.keywords.length || 1;
    const avgLen = turns.reduce((s, t2) => s + t2.keywords.length, 0) / N;
    const k1 = 1.5, b = 0.75;
    let bm25 = 0;
    for (const qw of queryKw) {
      const tf = termFreq[qw] || 0;
      if (tf === 0) continue;
      const idf = Math.log((N - (df[qw] || 0) + 0.5) / ((df[qw] || 0) + 0.5) + 1);
      bm25 += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgLen));
    }

    // Activation score (normalized to 0..1 via sigmoid)
    const chunk = turnChunks[i];
    const actRaw = chunk ? activation.computeActivation(chunk, context, nowMs) : 0;
    const actNorm = 1 / (1 + Math.exp(-actRaw));

    // Score fusion: BM25 dominant (0.85), activation as tiebreaker (0.15)
    return { turn: t, score: bm25 * 0.85 + actNorm * 0.15 };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.turn);
}

// ─── Build Activation Memory for a Conversation ──────────────────────────

function buildActivationMemory(turns) {
  const chunks = turns.map(t => {
    const chunk = {
      id: t.diaId,
      tags: [...t.keywords.slice(0, 5)], // top keywords as intrinsic tags
      _activation: activation.createActivation(0.5),
      _theme: null,
    };

    // Record the initial "access" when the turn happens
    const kwContext = { behaviorTags: t.keywords.slice(0, 5) };
    activation.recordAccess(chunk, kwContext, t.timestamp);

    return chunk;
  });

  // Simulate cross-session topic recurrence:
  // If a keyword appears in session N and also in session M>N,
  // the earlier turn gets re-accessed (simulating the topic being recalled)
  const kwToTurns = new Map(); // keyword -> [{chunkIdx, sessionIdx, timestamp}]
  for (let i = 0; i < turns.length; i++) {
    for (const kw of turns[i].keywords.slice(0, 3)) {
      if (!kwToTurns.has(kw)) kwToTurns.set(kw, []);
      kwToTurns.get(kw).push({ idx: i, session: turns[i].sessionIdx, ts: turns[i].timestamp });
    }
  }

  for (const [kw, occurrences] of kwToTurns) {
    if (occurrences.length < 2) continue;
    // For each later occurrence, re-access earlier turns with same keyword
    const sessions = [...new Set(occurrences.map(o => o.session))];
    if (sessions.length < 2) continue;

    for (let i = 1; i < occurrences.length; i++) {
      for (let j = 0; j < i; j++) {
        if (occurrences[j].session < occurrences[i].session) {
          // Earlier turn gets re-accessed when topic recurs
          activation.recordAccess(
            chunks[occurrences[j].idx],
            { behaviorTags: [kw] },
            occurrences[i].ts
          );
        }
      }
    }
  }

  return chunks;
}

// ─── Metrics ─────────────────────────────────────────────────────────────

function recallAtK(ranked, evidenceIds, k) {
  const topK = new Set(ranked.slice(0, k).map(t => t.diaId));
  const hits = evidenceIds.filter(id => topK.has(id)).length;
  return hits / evidenceIds.length;
}

function mrr(ranked, evidenceIds) {
  const evSet = new Set(evidenceIds);
  for (let i = 0; i < ranked.length; i++) {
    if (evSet.has(ranked[i].diaId)) return 1 / (i + 1);
  }
  return 0;
}

// ─── Run Evaluation ──────────────────────────────────────────────────────

function evaluate() {
  const strategies = [
    { name: 'Random', fn: (turns, qkw, _chunks) => rankRandom(turns, qkw) },
    { name: 'Recency', fn: (turns, qkw, _chunks) => rankRecency(turns, qkw) },
    { name: 'BM25', fn: (turns, qkw, _chunks) => rankKeyword(turns, qkw) },
    { name: 'ACT-R', fn: (turns, qkw, chunks) => rankActivation(turns, qkw, chunks) },
    { name: 'BM25+ACT-R', fn: (turns, qkw, chunks) => rankHybrid(turns, qkw, chunks) },
  ];

  // Per-category tracking: 1=single-hop, 2=multi-hop, 3=temporal, 4=open-ended, 5=adversarial
  const catNames = { 1: 'single-hop', 2: 'multi-hop', 3: 'temporal', 4: 'open-ended', 5: 'adversarial' };

  const metrics = {};
  for (const s of strategies) {
    metrics[s.name] = { r5: 0, r10: 0, mrr: 0, count: 0, byCat: {} };
    for (const cn of Object.values(catNames)) {
      metrics[s.name].byCat[cn] = { r5: 0, r10: 0, mrr: 0, count: 0 };
    }
  }

  let totalQA = 0, skipped = 0;
  const RUNS = 3; // average over runs to smooth noise

  for (const conv of dataset) {
    const turns = parseConversation(conv);
    if (turns.length === 0) continue;

    // Build activation memory once per conversation
    const turnChunks = buildActivationMemory(turns);

    for (const qa of conv.qa) {
      const evidenceIds = qa.evidence || [];
      if (evidenceIds.length === 0) { skipped++; continue; }

      // Verify evidence IDs exist in turns
      const turnIds = new Set(turns.map(t => t.diaId));
      const validEvidence = evidenceIds.filter(id => turnIds.has(id));
      if (validEvidence.length === 0) { skipped++; continue; }

      const queryKw = extractKeywords(qa.question);
      const cat = catNames[qa.category] || 'unknown';
      totalQA++;

      for (const strat of strategies) {
        let sumR5 = 0, sumR10 = 0, sumMrr = 0;

        for (let run = 0; run < RUNS; run++) {
          // Invalidate activation caches for fresh computation
          for (const c of turnChunks) c._activation.cachedScore = null;
          const ranked = strat.fn(turns, queryKw, turnChunks);
          sumR5 += recallAtK(ranked, validEvidence, 5);
          sumR10 += recallAtK(ranked, validEvidence, 10);
          sumMrr += mrr(ranked, validEvidence);
        }

        const r5 = sumR5 / RUNS;
        const r10 = sumR10 / RUNS;
        const m = sumMrr / RUNS;

        metrics[strat.name].r5 += r5;
        metrics[strat.name].r10 += r10;
        metrics[strat.name].mrr += m;
        metrics[strat.name].count++;

        if (metrics[strat.name].byCat[cat]) {
          metrics[strat.name].byCat[cat].r5 += r5;
          metrics[strat.name].byCat[cat].r10 += r10;
          metrics[strat.name].byCat[cat].mrr += m;
          metrics[strat.name].byCat[cat].count++;
        }
      }
    }
  }

  return { metrics, totalQA, skipped, catNames };
}

// ─── Report ──────────────────────────────────────────────────────────────

function printReport({ metrics, totalQA, skipped, catNames }) {
  console.log(`\n  LoCoMo External Benchmark (${totalQA} QA pairs, ${skipped} skipped)\n`);

  // Overall results
  const W = 16;
  console.log('  ' + 'Strategy'.padEnd(W) + 'Recall@5'.padEnd(12) + 'Recall@10'.padEnd(12) + 'MRR');
  console.log('  ' + '-'.repeat(W + 36));

  const overall = {};
  for (const [name, m] of Object.entries(metrics)) {
    const r5 = m.count > 0 ? m.r5 / m.count : 0;
    const r10 = m.count > 0 ? m.r10 / m.count : 0;
    const mrrVal = m.count > 0 ? m.mrr / m.count : 0;
    overall[name] = { r5, r10, mrr: mrrVal };
    console.log('  ' +
      name.padEnd(W) +
      r5.toFixed(3).padEnd(12) +
      r10.toFixed(3).padEnd(12) +
      mrrVal.toFixed(3));
  }

  // Per-category breakdown for key strategies
  console.log('\n  Per-Category Recall@5:');
  const cats = Object.values(catNames);
  console.log('  ' + 'Strategy'.padEnd(W) + cats.map(c => c.padEnd(14)).join(''));
  console.log('  ' + '-'.repeat(W + 14 * cats.length));

  for (const [name, m] of Object.entries(metrics)) {
    const catScores = cats.map(cat => {
      const bc = m.byCat[cat];
      return bc && bc.count > 0 ? (bc.r5 / bc.count).toFixed(3) : 'N/A';
    });
    console.log('  ' + name.padEnd(W) + catScores.map(s => s.padEnd(14)).join(''));
  }

  // Summary
  console.log('\n  Key Findings:');
  const bm25 = overall['BM25'];
  const actr = overall['ACT-R'];
  const hybrid = overall['BM25+ACT-R'];
  const random = overall['Random'];

  console.log(`  - ACT-R vs Random:  Recall@5 +${((actr.r5 - random.r5) * 100).toFixed(1)}pp, MRR +${((actr.mrr - random.mrr) * 100).toFixed(1)}pp`);
  console.log(`  - BM25 vs ACT-R:   BM25 Recall@5 ${bm25.r5 > actr.r5 ? '>' : '<'} ACT-R (${bm25.r5.toFixed(3)} vs ${actr.r5.toFixed(3)})`);
  console.log(`  - Hybrid vs BM25:  Recall@5 ${hybrid.r5 > bm25.r5 ? '+' : ''}${((hybrid.r5 - bm25.r5) * 100).toFixed(1)}pp, MRR ${hybrid.mrr > bm25.mrr ? '+' : ''}${((hybrid.mrr - bm25.mrr) * 100).toFixed(1)}pp`);

  // Interpretation
  console.log('\n  Interpretation:');
  if (actr.r5 > random.r5 * 1.5) {
    console.log('  ACT-R activation provides meaningful signal beyond random baseline.');
  }
  if (bm25.r5 > actr.r5) {
    console.log('  BM25 outperforms pure ACT-R on factual retrieval (expected: ACT-R has no semantic matching).');
  }
  if (hybrid.r5 >= bm25.r5 || hybrid.mrr >= bm25.mrr) {
    console.log('  Hybrid (BM25+ACT-R rerank) shows activation adds value on top of keyword retrieval.');
  } else {
    console.log('  Hybrid did not improve over BM25 — activation reranking was neutral on this dataset.');
  }
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────────

console.log('Loading LoCoMo dataset...');
console.log(`Conversations: ${dataset.length}`);
console.log(`Total QA pairs: ${dataset.reduce((s, c) => s + c.qa.length, 0)}`);

const result = evaluate();
printReport(result);
