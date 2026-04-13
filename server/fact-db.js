'use strict';

// ─── Fact Database: Two-Layer Schema (files + chunks) ───────────────────────
// Persistent JSON store with 20-call cooldown dedup and access logging.

const fs   = require('fs');
const path = require('path');
const log  = require('./utils/logger');
const activation = require('./activation');

const DATA_DIR     = path.join(__dirname, '..', 'data');
const DB_PATH      = path.join(DATA_DIR, 'fact-db.json');
const ACCESS_LOG   = path.join(DATA_DIR, 'fact-db-access.log');

// In-memory state
let _db = {
  files: [],            // file records
  chunks: [],           // chunk records
  globalCallCounter: 0, // monotonic counter for dedup
};

let _nextFileId  = 1;
let _nextChunkId = 1;

// ─── Persistence ────────────────────────────────────────────────────────────

const DB_BACKUP_PATH = DB_PATH + '.bak';

function _tryParseDb(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.files) || !Array.isArray(data.chunks)) return null;
    return data;
  } catch {
    return null;
  }
}

function loadDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}

  // Try main file first, fall back to backup if corrupted
  let data = _tryParseDb(DB_PATH);
  if (!data) {
    data = _tryParseDb(DB_BACKUP_PATH);
    if (data) {
      log.warn('fact-db', 'main db corrupted, loaded from backup');
    }
  }

  if (data) {
    _db.files  = data.files;
    _db.chunks = data.chunks;
    _db.globalCallCounter = data.globalCallCounter || 0;

    // Restore ID counters
    for (const f of _db.files) {
      const num = parseInt((f.id || '').replace('f', ''), 10);
      if (num >= _nextFileId) _nextFileId = num + 1;
    }
    for (const c of _db.chunks) {
      const num = parseInt((c.id || '').replace('c', ''), 10);
      if (num >= _nextChunkId) _nextChunkId = num + 1;
    }

    // Migrate chunks without _activation (Bayesian activation engine)
    let migrated = 0;
    for (const c of _db.chunks) {
      if (!c._activation) {
        activation.migrateFromLegacy(c, _db.globalCallCounter);
        migrated++;
      }
    }
    if (migrated > 0) {
      log.info('fact-db', `migrated ${migrated} chunks to activation engine`);
      saveDb();
    }

    log.info('fact-db', `loaded: ${_db.files.length} files, ${_db.chunks.length} chunks (counter=${_db.globalCallCounter})`);
  } else {
    log.info('fact-db', 'no existing db, starting fresh');
  }

  // Create backup after successful load (periodic backup on save)
  if (data && !_tryParseDb(DB_BACKUP_PATH)) {
    try { fs.copyFileSync(DB_PATH, DB_BACKUP_PATH); } catch {}
  }
}

// ─── Atomic save: write to temp file then rename (prevents corruption) ──────
let _saveCount = 0;
function saveDb() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmpPath = DB_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(_db, null, 2), 'utf8');
    fs.renameSync(tmpPath, DB_PATH);
    // Backup every 50 saves
    _saveCount++;
    if (_saveCount % 50 === 0) {
      try { fs.copyFileSync(DB_PATH, DB_BACKUP_PATH); } catch {}
    }
  } catch (err) {
    log.warn('fact-db', `save error: ${err.message}`);
  }
}

// ─── Debounced save: batch frequent updates (markUsed, recordHit) ───────────
let _savePending = false;
function saveDbDebounced() {
  if (_savePending) return;
  _savePending = true;
  setTimeout(() => {
    _savePending = false;
    saveDb();
  }, 2000); // flush every 2 seconds at most
}

// ─── File Operations ────────────────────────────────────────────────────────

function addFile(record) {
  const id = `f${String(_nextFileId++).padStart(3, '0')}`;
  const file = {
    id,
    path: record.path || '',
    fileName: record.fileName || path.basename(record.path || ''),
    type: record.type || 'unknown',
    summary: record.summary || '',
    tags: record.tags || [],
    mtime: record.mtime || new Date().toISOString(),
    discoveredAt: new Date().toISOString(),
    chunks: [],
  };
  _db.files.push(file);
  saveDb();
  return id;
}

function getFileById(id) {
  return _db.files.find(f => f.id === id) || null;
}

function getFileByPath(filePath) {
  return _db.files.find(f => f.path === filePath) || null;
}

// ─── Chunk Operations ───────────────────────────────────────────────────────

function addChunk(record) {
  const id = `c${String(_nextChunkId++).padStart(3, '0')}`;
  const prior = typeof record.importancePrior === 'number'
    ? record.importancePrior : 0.5;
  const chunk = {
    id,
    fileId: record.fileId || '',
    content: record.content || '',
    summary: record.summary || '',
    tags: record.tags || [],
    useCount: 0,
    hitCount: 0,       // times villain judged hit=true
    missCount: 0,      // times villain judged hit=false
    junk: record.junk || false, // system-generated, not human-created
    lastUsedAtCall: -999,       // never used
    _activation: activation.createActivation(prior),
  };
  _db.chunks.push(chunk);

  // Link chunk to its parent file
  const file = getFileById(chunk.fileId);
  if (file) file.chunks.push(id);

  saveDb();
  return id;
}

function getChunkById(id) {
  return _db.chunks.find(c => c.id === id) || null;
}

/**
 * Search chunks by case-insensitive keyword hits across content and summary.
 * @param {string} query - Search query string.
 * @param {number} limit - Maximum number of results to return.
 * @param {string|null} theme - Optional theme name filter.
 * @returns {Array<{id:string, summary:string, fileName:string, tags:string[]}>}
 */
function search(query, limit = 5, theme = null) {
  const terms = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean);

  if (terms.length === 0) return [];

  let allowedFileIds = null;
  if (theme) {
    try {
      const themeCluster = require('./theme-cluster');
      allowedFileIds = new Set(themeCluster.getFilesByTheme(theme));
      if (allowedFileIds.size === 0) return [];
    } catch (err) {
      log.warn('fact-db', `theme filter unavailable: ${err.message}`);
    }
  }

  const matches = [];

  for (const chunk of _db.chunks) {
    if (allowedFileIds && !allowedFileIds.has(chunk.fileId)) continue;
    const haystack = `${chunk.content || ''}\n${chunk.summary || ''}`.toLowerCase();
    let score = 0;

    for (const term of terms) {
      if (!haystack.includes(term)) continue;
      score += haystack.split(term).length - 1;
    }

    if (score <= 0) continue;

    const file = getFileById(chunk.fileId);
    matches.push({
      id: chunk.id,
      summary: chunk.summary || (chunk.content || '').slice(0, 160),
      fileName: file?.fileName || '',
      tags: Array.isArray(chunk.tags) ? chunk.tags : [],
      timesUsed: chunk.useCount || 0,
      _score: score,
    });
  }

  // Hybrid scoring: keyword 0.7, activation 0.3 (normalized)
  const maxKw = Math.max(1, ...matches.map(m => m._score));
  const nowMs = Date.now();
  for (const m of matches) {
    const chunk = getChunkById(m.id);
    const actScore = chunk ? activation.computeActivation(chunk, _contextFeatures, nowMs) : 0;
    const normKw = m._score / maxKw;
    const normAct = 1 / (1 + Math.exp(-actScore)); // sigmoid to [0,1]
    m._hybrid = normKw * 0.7 + normAct * 0.3;
  }

  matches.sort((a, b) => b._hybrid - a._hybrid || a.id.localeCompare(b.id));
  return matches.slice(0, limit).map(({ _score, _hybrid, timesUsed, ...item }) => ({ ...item, timesUsed }));
}

/**
 * Record trial hit/miss feedback on a chunk.
 */
function recordHit(chunkId, isHit) {
  const chunk = getChunkById(chunkId);
  if (!chunk) return;
  if (isHit) {
    chunk.hitCount = (chunk.hitCount || 0) + 1;
    activation.recordHitSignal(chunk);
  } else {
    chunk.missCount = (chunk.missCount || 0) + 1;
  }
  saveDbDebounced();
}

/**
 * List fact-db files with aggregate chunk stats.
 * @param {number} limit - Maximum number of files to return.
 * @returns {Array<{id:string, fileName:string, path:string, summary:string, chunkCount:number, timesUsed:number}>}
 */
function listFiles(limit = 100) {
  const max = Math.max(1, Number(limit) || 100);
  return _db.files
    .map(file => {
      const chunks = _db.chunks.filter(chunk => chunk.fileId === file.id);
      return {
        id: file.id,
        fileName: file.fileName || '',
        path: file.path || '',
        summary: file.summary || '',
        chunkCount: chunks.length,
        timesUsed: chunks.reduce((sum, chunk) => sum + (Number(chunk.useCount) || 0), 0),
      };
    })
    .sort((a, b) => b.timesUsed - a.timesUsed || b.chunkCount - a.chunkCount || a.id.localeCompare(b.id))
    .slice(0, max);
}

/**
 * Mark a file's chunks as junk (system-generated, not human-created).
 */
function markFileJunk(fileId) {
  for (const c of _db.chunks) {
    if (c.fileId === fileId) c.junk = true;
  }
  saveDb();
}

/**
 * Get available chunks (excluding junk and those in cooldown).
 * @param {number} count - Max chunks to return
 * @returns {object[]} Array of chunk records
 */
function _isRetired(c) {
  return activation.shouldRetire(c);
}

function getAvailableChunks(count, contextFeatures) {
  const cfg = activation.getConfig();
  const features = contextFeatures || _contextFeatures;

  const usable = _db.chunks.filter(c => !c.junk && !_isRetired(c));

  // ── Novelty-first, activation-as-tiebreaker ──
  // Partition: never-used chunks vs already-used chunks
  const neverUsed = usable.filter(c => (c.useCount || 0) === 0);
  const used = usable.filter(c =>
    (c.useCount || 0) > 0 &&
    _db.globalCallCounter - (c.lastUsedAtCall || 0) >= cfg.MIN_CALL_GAP
  );

  // Among novel chunks, pick the most contextually relevant (activation-ranked)
  const rankedNovel = activation.rankByActivation(neverUsed, features, count);

  if (rankedNovel.length >= count) return rankedNovel.slice(0, count);

  // Not enough novel chunks — backfill from used pool.
  // Strategy: staleness-weighted + activation tiebreaker.
  // Chunks not seen in a long time get priority (spreads repeats evenly),
  // activation breaks ties among equally stale chunks.
  const remaining = count - rankedNovel.length;
  const nowMs = Date.now();
  const maxGap = Math.max(1, _db.globalCallCounter);
  const backfill = used.map(c => {
    const staleness = (_db.globalCallCounter - (c.lastUsedAtCall || 0)) / maxGap; // 0..1
    c._activation.cachedScore = null; // force fresh computation
    const act = activation.computeActivation(c, features, nowMs);
    const actNorm = 1 / (1 + Math.exp(-act)); // sigmoid to 0..1
    return { chunk: c, score: staleness * 0.7 + actNorm * 0.3 };
  });
  backfill.sort((a, b) => b.score - a.score);

  return [...rankedNovel, ...backfill.slice(0, remaining).map(b => b.chunk)];
}

/**
 * Select random source files for a game session, return files + all their chunks.
 * File-level selection gives villain contextual depth instead of scattered fragments.
 * @param {number} fileCount - Number of source files to select (default 5)
 * @returns {{ files: object[], chunks: object[] }}
 */
function getSessionFiles(fileCount = 5, contextFeatures) {
  const cfg = activation.getConfig();
  const features = contextFeatures || _contextFeatures;
  const nowMs = Date.now();

  // Find files that have available (non-junk, non-retired) chunks
  const filesWithChunks = [];
  for (const file of _db.files) {
    const fileChunks = _db.chunks.filter(c =>
      c.fileId === file.id && !c.junk && !_isRetired(c)
    );
    if (fileChunks.length === 0) continue;

    // Novelty score: % of chunks in this file that have never been used
    const novelCount = fileChunks.filter(c => (c.useCount || 0) === 0).length;
    const noveltyRatio = novelCount / fileChunks.length;

    // Activation score: max activation among this file's chunks
    const maxAct = Math.max(...fileChunks.map(c =>
      activation.computeActivation(c, features, nowMs)
    ));

    // Combined: novelty-first (weight 3), activation-as-tiebreaker (weight 1)
    const combined = noveltyRatio * 3 + (1 / (1 + Math.exp(-maxAct)));

    filesWithChunks.push({ file, chunks: fileChunks, _combined: combined });
  }

  // Sort by combined score, take top 2×fileCount, then random sample
  filesWithChunks.sort((a, b) => b._combined - a._combined);
  const pool = filesWithChunks.slice(0, fileCount * 2);

  // Shuffle the pool for variety within the novelty-filtered set
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const selected = pool.slice(0, fileCount);
  return {
    files: selected.map(s => s.file),
    chunks: selected.flatMap(s => s.chunks),
  };
}

/**
 * Mark a chunk as used. Updates counters, activation, and writes access log.
 * @param {string} chunkId
 * @param {string} gameId
 * @param {number} step
 * @param {string} usage
 * @param {object|null} contextFeatures - Optional player context for activation
 */
function markUsed(chunkId, gameId, step, usage, contextFeatures) {
  const chunk = getChunkById(chunkId);
  if (!chunk) return;

  chunk.lastUsedAtCall = _db.globalCallCounter;
  _db.globalCallCounter++;
  chunk.useCount++;

  // Update activation engine
  const features = contextFeatures || _contextFeatures;
  activation.recordAccess(chunk, features, Date.now());

  saveDbDebounced();

  // Append to access log (extended format)
  const actScore = chunk._activation ? chunk._activation.cachedScore : null;
  const logEntry = JSON.stringify({
    t: new Date().toISOString(),
    chunkId,
    fileId: chunk.fileId,
    gameId: gameId || '',
    step: step || 0,
    usage: usage || 'unknown',
    contextTags: features ? (features.behaviorTags || []) : [],
    activationAtAccess: actScore,
  });
  try {
    activation.rotateLogIfNeeded(ACCESS_LOG);
    fs.appendFileSync(ACCESS_LOG, logEntry + '\n');
  } catch (err) {
    log.warn('fact-db', `access log write error: ${err.message}`);
  }
}

// ─── Context Features (set per game session) ───────────────────────────────

let _contextFeatures = null;

function setContextFeatures(features) {
  _contextFeatures = features || null;
}

function getContextFeatures() {
  return _contextFeatures;
}

// ─── Stats ──────────────────────────────────────────────────────────────────

function stats() {
  const cfg = activation.getConfig();
  const retiredCount = _db.chunks.filter(c => _isRetired(c)).length;
  const gapCount = _db.chunks.filter(c =>
    !_isRetired(c) && _db.globalCallCounter - (c.lastUsedAtCall || 0) < cfg.MIN_CALL_GAP
  ).length;
  const available = _db.chunks.length - retiredCount - gapCount;

  return {
    totalFiles: _db.files.length,
    totalChunks: _db.chunks.length,
    availableChunks: available,
    retiredChunks: retiredCount,
    cooldownChunks: gapCount,
  };
}

module.exports = {
  loadDb,
  saveDb,
  addFile,
  addChunk,
  getAvailableChunks,
  getSessionFiles,
  markUsed,
  recordHit,
  markFileJunk,
  getChunkById,
  search,
  listFiles,
  getFileById,
  getFileByPath,
  stats,
  setContextFeatures,
  getContextFeatures,
};
