'use strict';

// ─── Mid-Term Memory: Cross-Game Player Profiles ──────────────────────────────
// Writes a summary after each game, reads recent summaries at game start.
// Storage: JSONL files in data/player-profiles/<playerId>.jsonl

const fs   = require('fs');
const path = require('path');

let _locale = null;
function _t(key, params) {
  let s = (_locale && _locale[key]) || require('./locales/zh')[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
  }
  return s;
}

function initLocale(ctx) {
  _locale = require('./locales/' + (ctx.LOCALE || 'zh'));
}

const DATA_DIR = path.join(__dirname, '..', 'data', 'player-profiles');

// Ensure data directory exists
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

// ─── Configurable Thresholds ──────────────────────────────────────────────────
const THRESHOLDS = {
  cautiousIgnoreRate:      0.6,   // ignore > 60% → cautious
  temptationProneFollowRate: 0.6, // follow > 60% → temptation-prone
  trialStrongPassRate:     0.7,   // pass > 70% → trial-strong
  trialWeakPassRate:       0.3,   // pass < 30% → trial-weak
  survivorMinSteps:        20,    // HP=1 survives 20+ steps
  speedrunnerMaxSteps:     30,    // escapes in < 30 steps
  stubbornConsecutive:     3,     // same direction 3+ times
  minValidSteps:           5,     // games < 5 steps are "incomplete"
};

// ─── Behavior Tag Derivation ──────────────────────────────────────────────────

function deriveBehaviorTags(summary) {
  const tags = [];
  const { temptationStats, trialStats, totalSteps, finalHp, maxHp, outcome } = summary;

  // Temptation behavior
  const temptTotal = (temptationStats?.followed || 0) + (temptationStats?.ignored || 0);
  if (temptTotal > 0) {
    const ignoreRate = (temptationStats?.ignored || 0) / temptTotal;
    const followRate = (temptationStats?.followed || 0) / temptTotal;
    if (ignoreRate > THRESHOLDS.cautiousIgnoreRate) tags.push('cautious');
    if (followRate > THRESHOLDS.temptationProneFollowRate) tags.push('temptation-prone');
  }

  // Trial performance
  if (trialStats?.total > 0) {
    const passRate = (trialStats?.passed || 0) / trialStats.total;
    if (passRate > THRESHOLDS.trialStrongPassRate) tags.push('trial-strong');
    if (passRate < THRESHOLDS.trialWeakPassRate) tags.push('trial-weak');
  }

  // Survival patterns
  if (finalHp === 1 && totalSteps > THRESHOLDS.survivorMinSteps && outcome !== 'quit') tags.push('survivor');
  if (totalSteps < THRESHOLDS.speedrunnerMaxSteps && outcome === 'escaped') tags.push('speedrunner');

  // Stubborn: consecutive same-direction moves
  const decisions = summary.decisions || [];
  if (decisions.length >= THRESHOLDS.stubbornConsecutive + 1) {
    let maxConsec = 1, curConsec = 1, lastDx = null, lastDy = null;
    for (let i = 1; i < decisions.length; i++) {
      const prev = decisions[i - 1]?.to;
      const curr = decisions[i]?.to;
      if (prev && curr) {
        const dx = (curr.x || 0) - (prev.x || 0);
        const dy = (curr.y || 0) - (prev.y || 0);
        if (lastDx !== null && dx === lastDx && dy === lastDy && (dx !== 0 || dy !== 0)) {
          curConsec++;
        } else {
          curConsec = 1;
        }
        lastDx = dx; lastDy = dy;
        if (curConsec > maxConsec) maxConsec = curConsec;
      }
    }
    if (maxConsec >= THRESHOLDS.stubbornConsecutive) tags.push('stubborn');
  }

  return tags;
}

// ─── Write Game Summary ───────────────────────────────────────────────────────

/**
 * Write a post-game summary to the player's profile.
 * Called at /api/villain/end.
 *
 * @param {string} playerId - Player identifier (default: 'default')
 * @param {object} gameData - Game state at end
 * @param {object} gameData.gameId
 * @param {string} gameData.outcome - 'escaped' | 'trapped' | 'quit'
 * @param {number} gameData.totalSteps
 * @param {number} gameData.finalHp
 * @param {number} gameData.maxHp
 * @param {object} gameData.cardStats - { blocker: N, lure: N, drain: N, calm: N }
 * @param {string[]} gameData.villainSuccessCards - Card types that worked
 * @param {object} gameData.trialStats - { total, passed, failed, topics[] }
 * @param {number} gameData.godHandCount
 * @param {object} gameData.temptationStats - { followed, ignored, trappedByTemptation }
 */
function writeGameSummary(playerId, gameData) {
  const pid = playerId || 'default';
  const filePath = path.join(DATA_DIR, `${pid}.jsonl`);

  const summary = {
    gameId:             gameData.gameId || 'unknown',
    timestamp:          new Date().toISOString(),
    playerId:           pid,
    outcome:            gameData.outcome || 'unknown',
    totalSteps:         gameData.totalSteps || 0,
    finalHp:            gameData.finalHp ?? 0,
    maxHp:              gameData.maxHp || 3,
    cardStats:          gameData.cardStats || {},
    villainSuccessCards: gameData.villainSuccessCards || [],
    trialStats:         gameData.trialStats || { total: 0, passed: 0, failed: 0, topics: [] },
    godHandCount:       gameData.godHandCount || 0,
    temptationStats:    gameData.temptationStats || { followed: 0, ignored: 0, trappedByTemptation: 0 },
    decisions:          gameData.decisions || [],
    truthsDiscovered:   gameData.truthsDiscovered || [],
    behaviorTags:       [],
    villainNotes:       '',
  };

  // Mark incomplete games (too short to be meaningful)
  if (summary.totalSteps < THRESHOLDS.minValidSteps) {
    summary.incomplete = true;
  }

  // Derive behavior tags
  summary.behaviorTags = deriveBehaviorTags(summary);

  // Generate rule-based villain notes (no LLM in Phase 1)
  summary.villainNotes = generateVillainNotes(summary);

  // Append to JSONL
  const line = JSON.stringify(summary) + '\n';
  fs.appendFileSync(filePath, line);
  console.log(`[session-memory] wrote summary for ${pid}: ${summary.outcome}, ${summary.totalSteps} steps, tags=[${summary.behaviorTags.join(',')}]`);

  // Check if we should compress (every 10 games) — count lines instead of parsing all
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lineCount = content.split('\n').filter(Boolean).length;
    if (lineCount > 0 && lineCount % 10 === 0) {
      const recent10 = readRecentSummaries(pid, 10);
      compressToLongTerm(pid, recent10);
    }
  } catch {}

  return summary;
}

// ─── Generate Villain Notes (Rule-Based) ──────────────────────────────────────

function generateVillainNotes(summary) {
  const notes = [];
  const { temptationStats, trialStats, totalSteps, finalHp, outcome, cardStats } = summary;

  // Temptation analysis
  const temptTotal = (temptationStats?.followed || 0) + (temptationStats?.ignored || 0);
  if (temptTotal > 0) {
    const followRate = (temptationStats?.followed || 0) / temptTotal;
    if (followRate > 0.6) notes.push(_t('smem.note.lureEffective'));
    else if (followRate < 0.3) notes.push(_t('smem.note.lureResistant'));
  }

  // Trial analysis
  if (trialStats?.total > 0) {
    const passRate = (trialStats?.passed || 0) / trialStats.total;
    if (passRate > 0.7) notes.push(_t('smem.note.trialIneffective'));
    else if (passRate < 0.3) notes.push(_t('smem.note.trialEffective'));
  }

  // Pacing analysis
  if (totalSteps > 50 && outcome === 'trapped') notes.push(_t('smem.note.longGameImpatient'));
  if (totalSteps < 25 && outcome === 'escaped') notes.push(_t('smem.note.quickDecision'));

  // Card effectiveness
  const mostUsed = Object.entries(cardStats || {}).sort((a, b) => b[1] - a[1])[0];
  if (mostUsed && mostUsed[1] > 3) notes.push(_t('smem.note.cardFrequent', { card: mostUsed[0] }));

  return notes.join('\uFF1B') || _t('smem.note.firstGame');
}

// ─── Read Recent Summaries ────────────────────────────────────────────────────

/**
 * Read the most recent N game summaries for a player.
 * @param {string} playerId
 * @param {number} count - Max summaries to return (default: 3)
 * @returns {object[]} Array of summary objects, newest last
 */
function readRecentSummaries(playerId, count = 3) {
  const pid = playerId || 'default';
  const filePath = path.join(DATA_DIR, `${pid}.jsonl`);

  try {
    const content = fs.readFileSync(filePath, 'utf8').trim();
    if (!content) return [];
    const lines = content.split('\n').filter(Boolean);
    const summaries = [];
    for (const line of lines.slice(-count)) {
      try { summaries.push(JSON.parse(line)); } catch {}
    }
    return summaries;
  } catch {
    return [];
  }
}

// ─── Generate Villain Context from Summaries ──────────────────────────────────

/**
 * Generate a natural language context string for the villain system prompt.
 * Called at /api/villain/start to inject cross-game knowledge.
 *
 * @param {string} playerId
 * @returns {string} Context to append to villain personality, or '' if no history
 */
function buildCrossGameContext(playerId) {
  const raw = readRecentSummaries(playerId, 5);
  // Filter out incomplete games (< minValidSteps)
  const summaries = raw.filter(s => !s.incomplete && (s.totalSteps || 0) >= THRESHOLDS.minValidSteps);
  if (summaries.length === 0) return '';

  const totalGames = summaries.length;
  const escaped = summaries.filter(s => s.outcome === 'escaped').length;
  const trapped = summaries.filter(s => s.outcome === 'trapped').length;

  // Aggregate behavior tags (count frequency)
  const tagCounts = {};
  for (const s of summaries) {
    for (const tag of (s.behaviorTags || [])) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  const dominantTags = Object.entries(tagCounts)
    .filter(([, c]) => c >= 2)
    .map(([t]) => t);

  // Aggregate temptation stats
  const totalFollowed = summaries.reduce((s, g) => s + (g.temptationStats?.followed || 0), 0);
  const totalIgnored  = summaries.reduce((s, g) => s + (g.temptationStats?.ignored || 0), 0);
  const temptTotal = totalFollowed + totalIgnored;

  // Aggregate trial stats
  const totalTrials = summaries.reduce((s, g) => s + (g.trialStats?.total || 0), 0);
  const totalPassed = summaries.reduce((s, g) => s + (g.trialStats?.passed || 0), 0);

  // Find villain's most successful card types
  const successCards = {};
  for (const s of summaries) {
    for (const c of (s.villainSuccessCards || [])) {
      successCards[c] = (successCards[c] || 0) + 1;
    }
  }
  const bestStrategy = Object.entries(successCards).sort((a, b) => b[1] - a[1])[0];

  // Last game villain notes
  const lastNotes = summaries[summaries.length - 1]?.villainNotes || '';

  // Build natural language
  const lines = [];
  lines.push(_t('smem.context.header', { totalGames: String(totalGames) }));
  lines.push(_t('smem.context.record', { escaped: String(escaped), trapped: String(trapped) }));

  if (temptTotal > 0) {
    const followPct = Math.round(totalFollowed / temptTotal * 100);
    if (followPct > 60) lines.push(_t('smem.context.lureWeak', { pct: String(followPct) }));
    else if (followPct < 30) lines.push(_t('smem.context.lureStrong', { pct: String(100 - followPct) }));
    else lines.push(_t('smem.context.lureBalanced', { pct: String(followPct) }));
  }

  if (totalTrials > 0) {
    const passPct = Math.round(totalPassed / totalTrials * 100);
    if (passPct > 70) lines.push(_t('smem.context.trialStrength', { pct: String(passPct) }));
    else if (passPct < 30) lines.push(_t('smem.context.trialWeakness', { pct: String(passPct) }));
    else lines.push(_t('smem.context.trialNeutral', { pct: String(passPct) }));
  }

  if (dominantTags.length > 0) {
    const tagStr = dominantTags.map(t => _t('smem.tag.' + t) || t).join('\u3001');
    lines.push(_t('smem.context.behaviorPattern', { tags: tagStr }));
  }

  if (bestStrategy) lines.push(_t('smem.context.bestStrategy', { card: bestStrategy[0] }));

  // Truth discoveries across sessions
  const allTruths = new Set();
  for (const s of summaries) {
    for (const tr of (s.truthsDiscovered || [])) allTruths.add(tr);
  }
  if (allTruths.size > 0) {
    const truthStr = [...allTruths].map(tr => _t('smem.truth.' + tr) || tr).join('\u3001');
    lines.push(_t('smem.context.knownTruths', { truths: truthStr }));
  }

  if (lastNotes) lines.push(_t('smem.context.lastNotes', { notes: lastNotes }));

  lines.push('');
  lines.push(_t('smem.context.footer'));

  return '\n\n---\n' + lines.join('\n') + '\n---';
}

// ─── Long-Term Compression ────────────────────────────────────────────────────

function compressToLongTerm(playerId, recentSummaries) {
  const pid = playerId || 'default';
  const summaryPath = path.join(DATA_DIR, `${pid}.summary.json`);

  // Read existing summary
  let existing = { totalGames: 0, totalEscaped: 0, totalTrapped: 0, avgSteps: 0, bestStrategies: {}, commonTags: {} };
  try { existing = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch {}

  // Merge new data
  const newGames = recentSummaries.length;
  existing.totalGames   += newGames;
  existing.totalEscaped += recentSummaries.filter(s => s.outcome === 'escaped').length;
  existing.totalTrapped += recentSummaries.filter(s => s.outcome === 'trapped').length;

  const totalSteps = recentSummaries.reduce((s, g) => s + (g.totalSteps || 0), 0);
  existing.avgSteps = Math.round(((existing.avgSteps * (existing.totalGames - newGames)) + totalSteps) / existing.totalGames);

  for (const s of recentSummaries) {
    for (const tag of (s.behaviorTags || [])) {
      existing.commonTags[tag] = (existing.commonTags[tag] || 0) + 1;
    }
    for (const c of (s.villainSuccessCards || [])) {
      existing.bestStrategies[c] = (existing.bestStrategies[c] || 0) + 1;
    }
  }

  existing.lastUpdated = new Date().toISOString();
  fs.writeFileSync(summaryPath, JSON.stringify(existing, null, 2));
  console.log(`[session-memory] compressed ${newGames} games into long-term summary for ${pid} (total: ${existing.totalGames})`);
}

// ─── Context Features (structured retrieval anchor) ──────────────────────────

/**
 * Extract structured context features from player's game history.
 * Used as retrieval anchor for activation-based memory systems.
 * Pure math — no LLM calls.
 *
 * @param {string} playerId
 * @returns {object|null} contextFeatures or null if no history
 */
function getContextFeatures(playerId) {
  const raw = readRecentSummaries(playerId, 5);
  const summaries = raw.filter(s => !s.incomplete && (s.totalSteps || 0) >= THRESHOLDS.minValidSteps);
  if (summaries.length === 0) return null;

  // Aggregate behavior tags
  const tagCounts = {};
  for (const s of summaries) {
    for (const tag of (s.behaviorTags || [])) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  const behaviorTags = Object.entries(tagCounts)
    .filter(([, c]) => c >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  // Temptation stats
  const totalFollowed = summaries.reduce((s, g) => s + (g.temptationStats?.followed || 0), 0);
  const totalIgnored  = summaries.reduce((s, g) => s + (g.temptationStats?.ignored || 0), 0);
  const temptTotal = totalFollowed + totalIgnored;

  // Trial stats
  const totalTrials = summaries.reduce((s, g) => s + (g.trialStats?.total || 0), 0);
  const totalPassed = summaries.reduce((s, g) => s + (g.trialStats?.passed || 0), 0);
  const totalFailed = summaries.reduce((s, g) => s + (g.trialStats?.failed || 0), 0);

  // God hand usage
  const totalGodHand = summaries.reduce((s, g) => s + (g.godHandCount || 0), 0);

  // Cognitive state derivation
  const frustration = totalTrials > 0
    ? Math.min(1, (totalGodHand + totalFailed) / Math.max(1, totalTrials * 2))
    : 0;
  const engagement = totalTrials > 0
    ? Math.min(1, totalPassed / totalTrials)
    : 0.5;

  // Knowledge boundary: topics from trials where player consistently fails
  const topicFailCounts = {};
  const topicTotalCounts = {};
  for (const s of summaries) {
    for (const topic of (s.trialStats?.topics || [])) {
      topicTotalCounts[topic] = (topicTotalCounts[topic] || 0) + 1;
    }
    // We only have aggregate topics per game, not per-trial — use tags as proxy
  }
  const knowledgeBoundary = Object.entries(topicFailCounts)
    .filter(([, c]) => c >= 2)
    .map(([t]) => t);

  // Soft spot topics (read from player-profile if available)
  let softSpotTopics = [];
  try {
    const pp = require('./player-profile');
    const profile = pp.loadProfile();
    if (profile?.base_profile?.soft_spots) {
      softSpotTopics = profile.base_profile.soft_spots
        .slice(0, 5)
        .map(s => s.topic);
    }
  } catch { /* player-profile not ready */ }

  return {
    behaviorTags,
    temptationFollowRate: temptTotal > 0 ? totalFollowed / temptTotal : 0.5,
    trialPassRate: totalTrials > 0 ? totalPassed / totalTrials : 0.5,
    gameCount: summaries.length,
    softSpotTopics,
    hitBonus: true, // always enable hit bonus in retrieval
    cognitiveState: {
      frustration,
      engagement,
      knowledgeBoundary,
    },
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  initLocale,
  writeGameSummary,
  readRecentSummaries,
  buildCrossGameContext,
  deriveBehaviorTags,
  getContextFeatures,
  DATA_DIR,
};
