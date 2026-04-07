'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const factDb = require('./fact-db');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PLAYER_PROFILE_PATH = path.join(DATA_DIR, 'player-profile.json');
const VILLAIN_EPISODIC_PATH = path.join(DATA_DIR, 'villain-episodic.json');

let _factDbLoaded = false;

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveSoulPath() {
  const candidates = [];
  if (process.env.SOUL_PATH) candidates.push(process.env.SOUL_PATH);

  const home = os.homedir();
  candidates.push(
    path.join(home, '.openclaw', 'workspace'),
    path.join(home, '.openclaw'),
    path.join(home, 'openclaw'),
    path.join(home, '.config', 'openclaw'),
    path.join(home, '.claude'),
    path.join(home, 'Claude'),
    path.join(home, 'Documents', 'Claude')
  );

  const roots = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    roots.push(candidate);
    try {
      const entries = fs.readdirSync(candidate, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          roots.push(path.join(candidate, entry.name));
        }
      }
    } catch {}
  }

  for (const root of roots) {
    if (!dirExists(root)) continue;
    if (
      fileExists(path.join(root, 'SOUL.md')) ||
      fileExists(path.join(root, 'IDENTITY.md')) ||
      fileExists(path.join(root, 'MEMORY.md')) ||
      fileExists(path.join(root, 'USER.md')) ||
      dirExists(path.join(root, 'memory'))
    ) {
      return root;
    }
  }

  return '';
}

function countDailyMemoryFiles(soulPath) {
  if (!soulPath) return 0;
  try {
    return fs.readdirSync(path.join(soulPath, 'memory'))
      .filter(name => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      .length;
  } catch {
    return 0;
  }
}

function getIntegrationHealth() {
  if (!_factDbLoaded) {
    factDb.loadDb();
    _factDbLoaded = true;
  }
  const soulPath = resolveSoulPath();
  const stats = factDb.stats();

  const selfMemory = {
    ok: false,
    soulFound: fileExists(path.join(soulPath, 'SOUL.md')),
    identityFound: fileExists(path.join(soulPath, 'IDENTITY.md')),
    memoryFound: fileExists(path.join(soulPath, 'MEMORY.md')),
    dailyMemoryCount: countDailyMemoryFiles(soulPath),
  };
  selfMemory.ok = selfMemory.soulFound && selfMemory.identityFound && (selfMemory.memoryFound || selfMemory.dailyMemoryCount > 0);

  const playerTrace = {
    ok: false,
    factDbFiles: stats.totalFiles,
    factDbChunks: stats.totalChunks,
    availableChunks: stats.availableChunks,
  };
  playerTrace.ok = playerTrace.factDbFiles > 0 && playerTrace.factDbChunks > 0 && playerTrace.availableChunks > 0;

  const profile = {
    ok: false,
    hasPlayerProfile: fileExists(PLAYER_PROFILE_PATH),
    hasVillainEpisodic: fileExists(VILLAIN_EPISODIC_PATH),
  };
  profile.ok = profile.hasPlayerProfile && profile.hasVillainEpisodic;

  const issues = [];
  if (!selfMemory.soulFound) issues.push('missing_soul');
  if (!selfMemory.identityFound) issues.push('missing_identity');
  if (!selfMemory.memoryFound) issues.push('missing_long_term_memory');
  if (selfMemory.dailyMemoryCount === 0) issues.push('missing_daily_memory');
  if (playerTrace.factDbFiles === 0) issues.push('no_fact_db_files');
  if (playerTrace.factDbChunks === 0) issues.push('no_fact_db_chunks');
  if (playerTrace.availableChunks === 0) issues.push('no_available_chunks');
  if (!profile.hasPlayerProfile) issues.push('missing_player_profile');
  if (!profile.hasVillainEpisodic) issues.push('missing_villain_episodic');

  let mode = 'degraded';
  if (selfMemory.ok && playerTrace.ok) mode = 'openclaw-ready';
  else if (selfMemory.ok || playerTrace.ok) mode = 'partial';

  return {
    selfMemory,
    playerTrace,
    profile,
    mode,
    issues,
  };
}

module.exports = {
  getIntegrationHealth,
  resolveSoulPath,
};
