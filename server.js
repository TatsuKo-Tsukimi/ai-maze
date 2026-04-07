'use strict';

// ─── AI Maze Game Server — Entry Point ────────────────────────────────────────
// Thin boot layer: detects AI config, sets up shared state, starts HTTP server.
// All route handlers live in server/routes.js.

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { Worker } = require('worker_threads');

const PORT     = parseInt(process.env.PORT || '3000', 10);
const GAME_DIR = __dirname;

const { autoDetect, createLLMClient } = require('./server/provider');
const { loadPersonality, initPlayerNames } = require('./server/memory');
const { setIdentitySoulPath } = require('./server/prompts');
const { createRoutes } = require('./server/routes');
const factDb = require('./server/fact-db');
const themeCluster = require('./server/theme-cluster');
const { getIntegrationHealth } = require('./server/integration-health');

// ─── Session Logger ───────────────────────────────────────────────────────────
const SESSION_LOG_DIR = path.join(__dirname, 'session-logs');
try { fs.mkdirSync(SESSION_LOG_DIR, { recursive: true }); } catch {}

function sessionLog(gameId, entry) {
  if (!gameId) return;
  const logFile = path.join(SESSION_LOG_DIR, `${gameId}.jsonl`);
  const line = JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n';
  fs.appendFileSync(logFile, line);
}

// ─── Shared mutable state (passed to routes via ctx) ──────────────────────────
const ctx = {
  LLM: null,
  API_KEY: '',
  PROVIDER: 'openai',
  ACTIVE_MODEL: '',
  OPENAI_KEY: '',
  ANTHROPIC_KEY: '',
  SOUL_PATH: '',
  PERSONALITY_CONTEXT: '',
  GAME_DIR,
  sessionLog,
  ARCHIVIST_MODEL_ID: '',
  LOCALE: (process.env.LANG || '').startsWith('zh') ? 'zh' : 'en',
  scanConsentReceived: false,
  startScanning: null, // set during boot; called after user consents to file scanning
};

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer(createRoutes(ctx));

async function boot() {
  console.log('\n🔍 Detecting AI environment…\n');
  factDb.loadDb();
  const AI_CONFIG = await autoDetect();

  if (AI_CONFIG.provider) {
    ctx.LLM = createLLMClient(AI_CONFIG);
  }
  ctx.SOUL_PATH = AI_CONFIG.soulPath || '';
  initPlayerNames(ctx.SOUL_PATH);
  ctx.PERSONALITY_CONTEXT = ctx.SOUL_PATH ? loadPersonality(ctx.SOUL_PATH) : '';
  setIdentitySoulPath(ctx.SOUL_PATH);
  themeCluster.init(ctx);
  require('./server/memory').initLocale(ctx);
  require('./server/villain-memory').initLocale(ctx);
  require('./server/session-memory').initLocale(ctx);
  require('./server/judge').initLocale(ctx);
  require('./server/llm-helpers').initLocale(ctx);
  require('./server/vision-cache').initLocale(ctx);
  require('./server/prompts').initLocale(ctx);
  require('./server/topic-state').initLocale(ctx);

  const displayModel = AI_CONFIG.model || (AI_CONFIG.provider === 'openclaw-gateway' ? 'openclaw/default' : '');

  // Legacy compat aliases
  ctx.PROVIDER      = AI_CONFIG.provider || 'openai';
  ctx.ACTIVE_MODEL  = displayModel;
  ctx.API_KEY       = AI_CONFIG.apiKey   || '';
  ctx.ANTHROPIC_KEY = ctx.PROVIDER === 'anthropic' ? ctx.API_KEY : '';
  ctx.OPENAI_KEY    = (ctx.PROVIDER === 'openai' || ctx.PROVIDER === 'openclaw-gateway') ? ctx.API_KEY : '';
  ctx.MODEL_ID      = AI_CONFIG.model || ''; // canonical model id (e.g. anthropic/claude-sonnet-4-20250514)
  ctx.ARCHIVIST_MODEL_ID = AI_CONFIG.archivistModel || '';
  ctx.SOURCE        = AI_CONFIG.source || '';
  ctx.WARNINGS      = AI_CONFIG.warnings || [];

  // In WSL, localhost isn't reachable from Windows browser — show the WSL IP instead
  let displayHost = 'localhost';
  try {
    if (require('fs').existsSync('/proc/sys/fs/binfmt_misc/WSLInterop')) {
      const nets = require('os').networkInterfaces();
      for (const iface of Object.values(nets)) {
        const v4 = iface.find(a => a.family === 'IPv4' && !a.internal);
        if (v4) { displayHost = v4.address; break; }
      }
    }
  } catch {}

  const bar = '─'.repeat(52);
  console.log(`\n┌${bar}┐`);
  console.log(`│  🎮  永久囚禁 · AI迷宫  →  http://${displayHost}:${PORT}  `.padEnd(bar.length + 1) + '│');
  console.log(`├${bar}┤`);
  console.log(`│  Provider : ${(AI_CONFIG.provider || 'fallback').padEnd(bar.length - 13)}│`);
  const villainModel = displayModel;
  const modelDisplay = AI_CONFIG.fastModel && AI_CONFIG.fastModel !== villainModel
    ? `${villainModel} (villain) / ${AI_CONFIG.fastModel} (fast)`
    : (villainModel || '—');
  console.log(`│  Model    : ${modelDisplay.padEnd(bar.length - 13)}│`);
  console.log(`│  来源     : ${(AI_CONFIG.source || '—').padEnd(bar.length - 13)}│`);
  console.log(`│  SOUL.md  : ${(ctx.PERSONALITY_CONTEXT ? '✅ 已注入' : '— 未发现').padEnd(bar.length - 13)}│`);
  const agentUrl = (process.env.AGENT_URL || '').replace(/\/$/, '');
  console.log(`│  Agent    : ${(agentUrl ? '🔗 ' + agentUrl : '— 内置').padEnd(bar.length - 13)}│`);
  console.log(`└${bar}┘\n`);

  for (const w of (AI_CONFIG.warnings || [])) console.log(`⚠  ${w}`);

  const integration = getIntegrationHealth();
  console.log(`[integration] mode=${integration.mode} selfMemory=${integration.selfMemory.ok ? 'ok' : 'missing'} playerTrace=${integration.playerTrace.ok ? 'ok' : 'missing'} profile=${integration.profile.ok ? 'ok' : 'missing'} issues=${JSON.stringify(integration.issues)}`);

  if (!ctx.LLM) {
    console.error('\n⚠ Warning: No LLM backend detected.');
    console.error('  Server will start in degraded mode. The frontend will guide configuration.');
    console.error('  Setup options:');
    console.error('  1. OpenClaw users (recommended): ensure OpenClaw is installed and authenticated');
    console.error('  2. Anthropic: ANTHROPIC_API_KEY=sk-ant-xxx node server.js');
    console.error('  3. OpenAI compatible: OPENAI_API_KEY=sk-xxx node server.js\n');
    ctx.degraded = 'no-llm';
  }

  if (!ctx.SOUL_PATH) {
    console.error('\n⚠ Warning: SOUL_PATH (Agent memory path) not found.');
    console.error('  Server will start in degraded mode. The frontend will guide configuration.');
    console.error('  Setup options:');
    console.error('  1. OpenClaw users: ensure workspace directory exists with SOUL.md');
    console.error('  2. Manual: set SOUL_PATH=/path/to/your/workspace in .env\n');
    ctx.degraded = ctx.degraded || 'no-soul';
  }

  // (v2: villain session GC removed — maze-agent sessions managed by gateway)

  if (!fs.existsSync(path.join(__dirname, 'data', 'themes.json'))) {
    setTimeout(() => {
      themeCluster.clusterThemes().catch(err => {
        console.warn('[theme-cluster] 聚类失败:', err.message);
      });
    }, 1000);
  }

  // ── Lure Allocator init (no scanning, just state) ──
  const lureAllocator = require('./server/lure-allocator');
  lureAllocator.init(path.join(__dirname, 'data'));

  // ── Archivist + Lure scanning: deferred until user consents via frontend ──
  const archivist = require('./server/archivist');
  archivist.init(ctx);
  const playerProfile = require('./server/player-profile');
  playerProfile.init(ctx);

  let _scanWorker = null; // guard: only one scan worker at a time

  // Shared scan handler — processes worker results for archivist + lure-scan
  function _handleScanResult(msg) {
    if (!msg.ok) {
      console.warn('[scan-worker] 扫描失败:', msg.error);
      return;
    }
    const { imagePaths, textPaths, scanTime } = msg;
    console.log(`[scan-worker] 扫描完成: ${imagePaths.length} 张图片, ${textPaths.length} 个文本文件 (${(scanTime/1000).toFixed(1)}s)`);

    // Cache paths for lure-scan reuse
    ctx._scanPaths = { imagePaths, textPaths };

    // ── Archivist: start background analysis ──
    const dbStats = factDb.stats();
    if (dbStats.availableChunks < 100) {
      const memoryDir = path.join(ctx.SOUL_PATH, 'memory');
      let memoryFiles = [];
      try {
        memoryFiles = fs.readdirSync(memoryDir)
          .filter(f => f.endsWith('.md'))
          .map(f => path.join(memoryDir, f));
      } catch {}
      const soulFiles = ['MEMORY.md', 'SOUL.md', 'IDENTITY.md', 'USER.md']
        .map(f => path.join(ctx.SOUL_PATH, f))
        .filter(f => { try { fs.accessSync(f); return true; } catch { return false; } });
      const otherFiles = [...textPaths, ...imagePaths];
      const priorityFiles = [...memoryFiles, ...soulFiles];
      const allFiles = [...priorityFiles, ...otherFiles.filter(f => !priorityFiles.includes(f))];
      console.log(`[archivist] 开始分析: ${allFiles.length} 个文件 (${memoryFiles.length} 日记优先)`);
      archivist.startBackgroundWork(allFiles, { skipLLMTriage: true }).catch(err => {
        console.warn('[archivist] 后台分析失败:', err.message);
      });
    } else {
      console.log(`[archivist] fact-db 已有 ${dbStats.totalFiles} 文件 / ${dbStats.totalChunks} chunks，跳过分析`);
    }

    // ── Player Profile ──
    if (!playerProfile.hasProfile() && factDb.stats().totalChunks > 50) {
      setTimeout(async () => {
        try {
          console.log('[player-profile] 🧠 生成玩家基础画像...');
          await playerProfile.generateBaseProfile();
        } catch (e) {
          console.warn('[player-profile] 基础画像生成失败:', e.message);
        }
      }, 30000); // 30s after scan completes: archivist needs time to populate chunks
    } else if (playerProfile.hasProfile()) {
      console.log('[player-profile] ✅ 画像已存在');
    }

    // ── Enhanced Lure: vision analysis (reuses cached scan paths) ──
    (async () => {
      try {
        const { batchAnalyze, loadCache } = require('./server/vision-cache');
        const cache = loadCache();
        const cacheAge = Date.now() - (cache.lastScan || 0);
        const stale = cacheAge > 24 * 60 * 60 * 1000;

        if (stale || Object.keys(cache.entries || {}).length === 0) {
          console.log('[lure-scan] 🧠 开始 Vision 分析...');
          // Build a scanResult-like object from cached paths
          const scanResult = {
            images: imagePaths.map(p => ({ path: p })),
            textFiles: textPaths.map(p => ({ path: p })),
          };
          if (ctx.LLM && ctx.LLM.chatWithImage) {
            const analyzed = await batchAnalyze(ctx.LLM, scanResult, 30);
            console.log(`[lure-scan] ✅ 分析完成: ${analyzed.length} 个 lure 素材已缓存`);
          } else {
            console.log('[lure-scan] ⚠ 无 Vision 能力，仅缓存文本文件元数据');
            await batchAnalyze(null, scanResult, 0);
          }
        } else {
          console.log(`[lure-scan] 缓存有效 (${Object.keys(cache.entries).length} items, ${Math.round(cacheAge/60000)}min ago)`);
        }
      } catch (err) {
        console.warn('[lure-scan] 预扫描失败（不影响游戏）:', err.message);
      }
    })();
  }

  ctx.startScanning = function startScanning() {
    if (ctx.scanConsentReceived) return;
    ctx.scanConsentReceived = true;
    if (_scanWorker) return; // scan already in flight
    console.log('[scan-consent] ✅ 用户已同意文件扫描，开始后台扫描...');

    const dbStats = factDb.stats();
    if (dbStats.availableChunks >= 100) {
      console.log(`[archivist] fact-db 已有 ${dbStats.totalFiles} 文件 / ${dbStats.totalChunks} chunks，跳过扫描`);
      return;
    }

    console.log(`[scan-worker] 🔍 启动扫描 worker... (当前 ${dbStats.totalFiles} 文件, ${dbStats.totalChunks} chunks)`);
    _scanWorker = new Worker(path.join(__dirname, 'server', 'scan-worker.js'), {
      workerData: { soulPath: ctx.SOUL_PATH, gameDir: GAME_DIR },
    });

    // Timeout: terminate if scanning takes too long
    const timeout = setTimeout(() => {
      console.warn('[scan-worker] 扫描超时 (120s)，终止');
      _scanWorker.terminate();
    }, 120000);

    _scanWorker.on('message', (msg) => {
      clearTimeout(timeout);
      _handleScanResult(msg);
    });

    _scanWorker.on('error', (err) => {
      clearTimeout(timeout);
      console.warn('[scan-worker] worker 错误:', err.message);
      _scanWorker = null;
    });

    _scanWorker.on('exit', (code) => {
      clearTimeout(timeout);
      _scanWorker = null;
      if (code !== 0 && code !== null) console.warn('[scan-worker] worker 异常退出:', code);
    });
  };

  console.log('[scan] ⏳ 文件扫描已就绪，等待用户授权...');

  const HOST = process.env.HOST || '127.0.0.1';
  server.listen(PORT, HOST, () => {
    if (!process.env.NO_OPEN) {
      const open = process.platform === 'darwin' ? 'open'
                 : process.platform === 'win32'  ? 'start'
                 : 'xdg-open';
      exec(`${open} http://${displayHost}:${PORT}`, () => {});
    }
  });
}

boot().catch(err => {
  console.error('Boot failed:', err);
  process.exit(1);
});
