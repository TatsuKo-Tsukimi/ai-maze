'use strict';

// ─── Trial Dedup & Fact Selection ─────────────────────────────────────────────
// Manages per-game trial state: fact tracking, prompt dedup, topic rotation,
// anchor dedup, and fixed-trial queue management.

const _usedFacts     = new Map(); // gameId → Set<factKey>
const _usedPrompts   = new Map(); // gameId → Set<promptKey>
const _globalRecent  = [];
const _globalRecentPrompts = []; // cross-game prompt dedup (last 20)
const _globalRecentTopics = []; // cross-game topic dedup (last 30)
const _trialQueues   = new Map();
const _trialCallIdx  = new Map(); // gameId → call count
const _lastAnchor    = new Map(); // gameId → last trial's anchor
const _lastTopics    = new Map(); // gameId → string[] of recent topic keywords

function factKey(factText) {
  // Enhanced normalization: remove spaces/punctuation, lowercase, and use a sliding window/hash approach
  // Also truncate at 80 chars for better uniqueness without being too sensitive to trailing noise
  return (factText || '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/\s+/g, '')
    .toLowerCase()
    .slice(0, 80);
}
function promptKey(prompt) {
  return (prompt || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase().slice(0, 50);
}

function isFactUsed(gameId, factText) {
  if (!factText) return false;
  const key = factKey(factText);
  // Cross-game: check global recent facts first
  if (_globalRecent.includes(key)) return true;
  const gk = gameId || '__global';
  if (_usedFacts.has(gk)) return _usedFacts.get(gk).has(key);
  return false;
}

function isTrialUsed(gameId, prompt) {
  const key = promptKey(prompt);
  // Cross-game dedup: check global recent prompts first
  if (_globalRecentPrompts.includes(key)) return true;
  if (gameId && _usedPrompts.has(gameId)) return _usedPrompts.get(gameId).has(key);
  return false;
}

function recordUsedTrial(gameId, prompt, usedFactText) {
  const gk = gameId || '__global';
  if (prompt) {
    const pk = promptKey(prompt);
    if (!_usedPrompts.has(gk)) _usedPrompts.set(gk, new Set());
    _usedPrompts.get(gk).add(pk);
    // Cross-game dedup: track last 20 prompts globally
    if (!_globalRecentPrompts.includes(pk)) {
      _globalRecentPrompts.push(pk);
      if (_globalRecentPrompts.length > 20) _globalRecentPrompts.shift();
    }
  }
  if (usedFactText) {
    const fk = factKey(usedFactText);
    if (!_usedFacts.has(gk)) _usedFacts.set(gk, new Set());
    _usedFacts.get(gk).add(fk);
    if (!_globalRecent.includes(fk)) {
      _globalRecent.push(fk);
      if (_globalRecent.length > 30) _globalRecent.shift();
    }
  }
}

function cleanupUsedTrials(gameId) {
  if (gameId) {
    _usedFacts.delete(gameId);
    _usedPrompts.delete(gameId);
    _trialQueues.delete(gameId);
    _trialCallIdx.delete(gameId);
    _lastAnchor.delete(gameId);
    _lastTopics.delete(gameId);
  }
}

// ─── Topic detection ──────────────────────────────────────────────────────────
const TOPIC_KEYWORDS = [
  { topic: 'naming',     re: /取名|命名|名字|起名/ },
  { topic: 'ai-relation',re: /姐姐|同伴|助手|agent.*关系|AI.*关系|信任.*审美|自主协作/ },
  { topic: 'habits',     re: /凌晨|通宵|习惯|熬夜|突然开始/ },
  { topic: 'pricing',    re: /付费|免费|方案|定价|收费/ },
  { topic: 'automation', re: /邮件|处理|自动|流程/ },
  { topic: 'design',     re: /设计|卡牌|UI|界面/ },
  { topic: 'discord',    re: /Discord|bot|频道|服务器/ },
  { topic: 'identity',   re: /身份|角色扮演|人格/ },
  { topic: 'incident',   re: /炸了|崩了|恢复|故障|宕机/ },
  { topic: 'psychology', re: /着迷|警惕|害怕|恐惧|焦虑|纠结/ },
  { topic: 'academic',   re: /演讲|学术|论文|Bloom|GDC/ },
  { topic: 'technical',  re: /语音|转写|离线|API|架构|重构/ },
  { topic: 'release',    re: /发布|上线|部署|版本/ },
  { topic: 'debug',      re: /修复|bug|错误|排查/ },
  { topic: 'games',      re: /FF14|FFXIV|星穹铁道|LOL|英雄联盟|守望先锋|风暴英雄|战双|游戏截图/ },
  { topic: 'files',      re: /简历|文档|config|配置文件|日志文件/ },
  { topic: 'model',      re: /模型|切换|换了.*模型|新模型/ },
];

function detectTopic(text) {
  for (const { topic, re } of TOPIC_KEYWORDS) {
    if (re.test(text)) return topic;
  }
  return null;
}

function isTopicRepeated(gameId, topic) {
  if (!topic) return false;
  // Cross-game topic check first
  if (_globalRecentTopics.includes(topic)) return true;
  const gk = gameId || '__global';
  const recent = _lastTopics.get(gk) || [];
  return recent.slice(-4).includes(topic);
}

function recordTopic(gameId, topic) {
  if (!topic) return;
  const gk = gameId || '__global';
  const recent = _lastTopics.get(gk) || [];
  recent.push(topic);
  if (recent.length > 8) recent.shift();
  _lastTopics.set(gk, recent);
  // Cross-game topic tracking
  if (!_globalRecentTopics.includes(topic)) {
    _globalRecentTopics.push(topic);
    if (_globalRecentTopics.length > 30) _globalRecentTopics.shift();
  }
}

function selectUnusedFact(facts, gameId, callIdx, gameContext = null) {
  const gk = gameId || '__global';
  if (!_usedFacts.has(gk)) _usedFacts.set(gk, new Set());
  const used = _usedFacts.get(gk);

  // Phase 0: deduplicate incoming facts by factKey — catches cases where
  // extractSpecificFacts returns near-duplicate facts from different sources
  const seenKeys = new Set();
  const dedupedFacts = facts.filter(f => {
    const fk = factKey(f.text);
    if (seenKeys.has(fk)) return false;
    seenKeys.add(fk);
    return true;
  });
  if (dedupedFacts.length < facts.length) {
    console.log(`[trial] input dedup: ${facts.length} → ${dedupedFacts.length} facts`);
  }

  let available = dedupedFacts.filter(f => {
    const fk = factKey(f.text);
    if (used.has(fk)) return false;
    if (_globalRecent.includes(fk)) return false; // cross-game dedup
    return true;
  });

  if (available.length === 0) {
    console.log(`[trial] all ${dedupedFacts.length} facts exhausted for ${gk}, resetting`);
    used.clear();
    available = dedupedFacts;
  }

  // Anchor dedup
  const prevAnchor = _lastAnchor.get(gk);
  if (prevAnchor && available.length > 1) {
    const diffAnchor = available.filter(f => {
      const a = f.anchor || require('./memory').extractAnchor(f.text);
      return a !== prevAnchor;
    });
    if (diffAnchor.length > 0) {
      console.log(`[trial] anchor-dedup: skipping ${available.length - diffAnchor.length} facts with same anchor "${prevAnchor}"`);
      available = diffAnchor;
    }
  }

  // Topic dedup
  if (available.length > 1) {
    const diffTopic = available.filter(f => {
      const t = detectTopic(f.text);
      return !isTopicRepeated(gk, t);
    });
    if (diffTopic.length > 0 && diffTopic.length < available.length) {
      console.log(`[trial] topic-dedup: skipping ${available.length - diffTopic.length} facts with repeated topic`);
      available = diffTopic;
    }
  }

  // ── Contextual score boosting (non-mutating) ────────────────────
  // Use a local boost map instead of mutating f.score directly,
  // which would cause scores to accumulate across calls/games
  const ctxBoost = new Map();
  if (gameContext) {
    for (const f of available) {
      let boost = 0;
      const t = (f.text || '').toLowerCase();
      if (gameContext.nearExit && /出口|完成|结束|finish|escape|exit/.test(t)) boost += 3;
      if (gameContext.trialStruggling && f.text.length < 80) boost += 2;
      if (gameContext.lowHp && /失败|放弃|错误|bug|问题|fail|error/.test(t)) boost += 2;
      if (gameContext.stubborn && /决定|选择|坚持|反复|change|decide/.test(t)) boost += 2;
      if (boost > 0) ctxBoost.set(f, boost);
    }
  }

  // Weighted random selection (base score + contextual boost)
  const weights = available.map(f => Math.max((f.score || 0) + (ctxBoost.get(f) || 0), 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalWeight;
  for (let i = 0; i < available.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      used.add(factKey(available[i].text));
      const pickedAnchor = available[i].anchor || require('./memory').extractAnchor(available[i].text);
      if (pickedAnchor) _lastAnchor.set(gk, pickedAnchor);
      recordTopic(gk, detectTopic(available[i].text));
      console.log(`[trial] weighted-random picked fact ${i}/${available.length} score=${available[i].score} topic=${detectTopic(available[i].text)||'∅'} text="${available[i].text.slice(0,50)}"`);
      return available[i];
    }
  }

  // Fallback
  const pick = available[0];
  used.add(factKey(pick.text));
  const pickedAnchor = pick.anchor || require('./memory').extractAnchor(pick.text);
  if (pickedAnchor) _lastAnchor.set(gk, pickedAnchor);
  recordTopic(gk, detectTopic(pick.text));
  return pick;
}

function nextTrialCallIndex(gameId) {
  const key = gameId || '__global';
  if (!_trialCallIdx.has(key)) {
    const seed = Math.floor(Math.random() * 11);
    _trialCallIdx.set(key, seed);
    return seed;
  }
  const idx = _trialCallIdx.get(key);
  _trialCallIdx.set(key, idx + 1);
  return idx;
}

function getNextFixedTrial(gameId, difficulty) {
  const { FIXED_TRIAL_POOL } = require('./prompts');
  if (!_trialQueues.has(gameId || '__global')) {
    const all = Object.values(FIXED_TRIAL_POOL).flat()
      .sort(() => Math.random() - 0.5);
    _trialQueues.set(gameId || '__global', [...all]);
  }
  const queue = _trialQueues.get(gameId || '__global');
  const idx = queue.findIndex(q => !isTrialUsed(gameId, q.prompt));
  if (idx === -1) {
    const { FIXED_TRIAL_POOL: P } = require('./prompts');
    const fresh = Object.values(P).flat().sort(() => Math.random() - 0.5);
    _trialQueues.set(gameId || '__global', fresh);
    return fresh[0];
  }
  const [q] = queue.splice(idx, 1);
  queue.push(q);
  return q;
}

module.exports = {
  factKey, isFactUsed, isTrialUsed, recordUsedTrial, cleanupUsedTrials,
  detectTopic, selectUnusedFact, nextTrialCallIndex, getNextFixedTrial,
};
