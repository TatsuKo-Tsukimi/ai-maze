'use strict';

// ─── Archivist Session: LLM-based File Analysis + Semantic Chunking ─────────
// Background processor that analyzes files and populates the fact-db.

const fs   = require('fs');
const path = require('path');
const log  = require('./utils/logger');
const llmGate = require('./utils/llm-gate');
const factDb = require('./fact-db');

let _LLM = null;
let _MODEL_ID = '';
let _locale = null;

function _t(key, params) {
  let s = (_locale && _locale[key]) || require('./locales/zh')[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
  }
  return s;
}

function init(ctx) {
  _LLM = ctx.LLM;
  _MODEL_ID = ctx.ARCHIVIST_MODEL_ID || ctx.MODEL_ID || ctx.ACTIVE_MODEL || '';
  _locale = require('./locales/' + (ctx.LOCALE || 'zh'));
  // Self-exclusion: add game directory to junk patterns so game source files are never analyzed
  if (ctx.GAME_DIR) {
    const escaped = ctx.GAME_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    JUNK_PATH_PATTERNS.push(new RegExp(escaped, 'i'));
  }
}

// ─── File content extraction ────────────────────────────────────────────────

function readFileContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  // Images: path only
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext)) {
    return null; // skip content, record metadata only
  }

  // PDF (pdf-parse v2 API via helper script)
  if (ext === '.pdf') {
    try {
      const { execSync } = require('child_process');
      const extractScript = path.join(__dirname, 'utils', 'pdf-extract.js');
      return execSync(`node "${extractScript}" "${filePath}"`, {
        maxBuffer: 512 * 1024,
        timeout: 60000,
        cwd: path.join(__dirname, '..'),
      }).toString('utf8').trim();
    } catch (pdfErr) {
      log.warn('archivist', `PDF extraction failed for ${path.basename(filePath)}: ${(pdfErr.message || '').slice(0, 100)}`);
      // Fallback to pdftotext CLI
      try {
        const { execSync } = require('child_process');
        return execSync(`pdftotext "${filePath}" - 2>/dev/null`, { maxBuffer: 512 * 1024, timeout: 10000 }).toString('utf8').trim().slice(0, 4000);
      } catch { return null; }
    }
  }

  // DOCX
  if (ext === '.docx') {
    try {
      const { execSync } = require('child_process');
      const raw = execSync(`unzip -p "${filePath}" word/document.xml 2>/dev/null`, { maxBuffer: 512 * 1024, timeout: 10000 }).toString('utf8');
      return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
    } catch { return null; }
  }

  // XLSX
  if (ext === '.xlsx') {
    try {
      const { execSync } = require('child_process');
      const raw = execSync(`unzip -p "${filePath}" xl/sharedStrings.xml 2>/dev/null`, { maxBuffer: 512 * 1024, timeout: 10000 }).toString('utf8');
      return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
    } catch { return null; }
  }

  // Text-based files
  try {
    return fs.readFileSync(filePath, 'utf8').slice(0, 4000);
  } catch { return null; }
}

function detectFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const typeMap = {
    '.pdf': 'pdf', '.docx': 'docx', '.doc': 'doc', '.xlsx': 'xlsx',
    '.txt': 'txt', '.md': 'txt', '.json': 'json',
    '.js': 'code', '.ts': 'code', '.py': 'code',
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image',
    '.webp': 'image', '.bmp': 'image', '.svg': 'image',
  };
  return typeMap[ext] || 'unknown';
}

// ─── LLM Analysis ───────────────────────────────────────────────────────────

async function processFile(filePath, content) {
  if (!_LLM) {
    log.warn('archivist', 'no LLM client, skipping analysis');
    return null;
  }

  const fileName = path.basename(filePath);
  const fileType = detectFileType(filePath);

  // Images: record metadata only, no LLM call
  if (fileType === 'image') {
    const fileId = factDb.addFile({
      path: filePath,
      fileName,
      type: fileType,
      summary: _t('archivist.image_summary', { name: fileName }),
      tags: ['image'],
    });
    return { fileId, chunks: [] };
  }

  if (!content) {
    log.warn('archivist', `no content for ${fileName}, recording metadata only`);
    const fileId = factDb.addFile({
      path: filePath,
      fileName,
      type: fileType,
      summary: _t('archivist.no_content_summary', { type: fileType, name: fileName }),
      tags: [fileType],
    });
    return { fileId, chunks: [] };
  }

  const userMsg = JSON.stringify({
    event: 'analyze_file',
    file_name: fileName,
    file_path: filePath,
    content,
    _protocol: {
      response_format: {
        summary: `string, ${_t('archivist.protocol.summary_desc')}`,
        tags: `string[], ${_t('archivist.protocol.tags_desc')}`,
        chunks: '[{content: string, summary: string, tags: string[]}]',
      },
    },
  });

  try {
    const raw = await Promise.race([
      _LLM.chat(_t('archivist.system_prompt'), [{ role: 'user', content: userMsg }], {
        max_tokens: 2000, ...(_MODEL_ID ? { model: _MODEL_ID } : {}),
        temperature: 0.4,
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('archivist LLM timeout')), 60000)),
    ]);

    const parsed = parseResponse(raw);
    if (!parsed) {
      log.warn('archivist', `failed to parse LLM response for ${fileName}, raw: ${(raw || '').slice(0, 200)}`);
      // Retry once with simpler prompt
      try {
        const retryMsg = JSON.stringify({
          event: 'analyze_file',
          file_name: fileName,
          content: content.slice(0, 2000),
          _protocol: { response_format: { summary: 'string', tags: 'string[]', chunks: '[]' } },
        });
        const retryRaw = await Promise.race([
          _LLM.chat(_t('archivist.system_prompt'), [{ role: 'user', content: retryMsg }], { max_tokens: 1200, temperature: 0.3, ...(_MODEL_ID ? { model: _MODEL_ID } : {}) }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('archivist retry timeout')), 60000)),
        ]);
        const retryParsed = parseResponse(retryRaw);
        if (retryParsed) {
          log.info('archivist', `retry succeeded for ${fileName}`);
          const fileId = factDb.addFile({ path: filePath, fileName, type: fileType, summary: retryParsed.summary || '', tags: retryParsed.tags || [] });
          const chunkIds = [];
          for (const chunk of (retryParsed.chunks || [])) {
            chunkIds.push(factDb.addChunk({ fileId, content: chunk.content || '', summary: chunk.summary || '', tags: chunk.tags || [] }));
          }
          return { fileId, chunks: chunkIds };
        }
      } catch (retryErr) {
        log.warn('archivist', `retry also failed for ${fileName}: ${retryErr.message}`);
      }
      return null;
    }

    // Write to fact-db
    const isJunk = parsed.junk === true || parsed.junk === 'true';
    const fileId = factDb.addFile({
      path: filePath,
      fileName,
      type: fileType,
      summary: parsed.summary || '',
      tags: parsed.tags || [],
    });

    // Junk files: mark and skip chunking
    if (isJunk) {
      factDb.markFileJunk(fileId);
      log.info('archivist', `${fileName}: junk (system-generated), skipped chunking`);
      return { fileId, chunks: [] };
    }

    const chunkIds = [];
    for (const chunk of (parsed.chunks || [])) {
      const cid = factDb.addChunk({
        fileId,
        content: chunk.content || '',
        summary: chunk.summary || '',
        tags: chunk.tags || [],
      });
      chunkIds.push(cid);
    }

    log.info('archivist', `analyzed ${fileName}: ${chunkIds.length} chunks`);
    return { fileId, chunks: chunkIds };
  } catch (err) {
    log.warn('archivist', `analysis failed for ${fileName}: ${err.message}`);
    return null;
  }
}

function parseResponse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      let cleaned = jsonMatch[0]
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(cleaned);
    } catch {}
  }
  return null;
}

// ─── Background Processing ──────────────────────────────────────────────────

// ─── Path-level junk detection (no LLM needed) ──────────────────────────────
const JUNK_PATH_PATTERNS = [
  /Tencent Files/i, /nt_qq/i, /VasUpdate/i, /MiniApp/i,
  /WeChat Files/i, /wechat/i,
  /AppData[/\\]Local/i, /AppData[/\\]Roaming/i,
  /\.cache[/\\]/i, /cache[/\\]/i,
  /node_modules/i, /\.git[/\\]/i,
  /Package\s*Cache/i, /NuGet/i,
  /CrashDump/i, /crash-report/i,
  /[/\\]Logs?[/\\]/i,
  /steamapps/i, /Epic Games/i,
  /Microsoft[/\\]Edge/i, /Google[/\\]Chrome[/\\]/i,
  /BrowserExtensions/i,
  /[/\\]\.npm/i, /[/\\]\.yarn/i,
  /[/\\]dist[/\\]/i, /[/\\]build[/\\]/i,
  /[/\\]__pycache__[/\\]/i,
];

function isPathJunk(filePath) {
  return JUNK_PATH_PATTERNS.some(re => re.test(filePath));
}

// ─── LLM-based batch path triage (Haiku, fast + cheap) ──────────────────────
async function _batchPathTriage(paths) {
  if (!_LLM || paths.length === 0) return new Set();

  const BATCH_SIZE = 80;
  const junkSet = new Set();

  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE);
    const numbered = batch.map((p, idx) => `${idx + 1}. ${p}`).join('\n');

    const prompt = `${_t('archivist.classify_prompt')}\n\n${numbered}`;

    try {
      const raw = await Promise.race([
        _LLM.chat(_t('archivist.classify_system'), [{ role: 'user', content: prompt }], {
          max_tokens: 300,
          temperature: 0,
          ...(_MODEL_ID ? { model: _MODEL_ID } : {}),
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('triage timeout')), 30000)),
      ]);

      // Parse "1, 3, 7, 12" or "none"
      let junkInBatch = 0;
      if (raw && !/^none$/i.test(raw.trim())) {
        const nums = raw.match(/\d+/g) || [];
        for (const n of nums) {
          const idx = parseInt(n, 10) - 1;
          if (idx >= 0 && idx < batch.length) { junkSet.add(batch[idx]); junkInBatch++; }
        }
      }
      log.info('archivist', `path triage batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} files, ${junkInBatch} junk`);
    } catch (e) {
      log.warn('archivist', `path triage batch failed: ${(e.message || '').slice(0, 60)}`);
      // On failure, keep all (conservative)
    }

    await llmGate.wait(200); // rate limit (throttled during game)
  }

  return junkSet;
}

async function startBackgroundWork(filePaths, options = {}) {
  // Phase 0: regex path filter (instant)
  const preFilterCount = filePaths.length;
  const regexFiltered = filePaths.filter(fp => !isPathJunk(fp));
  const junkByRegex = preFilterCount - regexFiltered.length;
  log.info('archivist', `path filter: ${regexFiltered.length} files after regex (${junkByRegex} removed)`);

  // Phase 1: LLM batch path triage (optional — skipped by default for faster cold start)
  let filteredPaths = regexFiltered;
  if (!options.skipLLMTriage) {
    const llmJunk = await _batchPathTriage(regexFiltered);
    filteredPaths = regexFiltered.filter(fp => !llmJunk.has(fp));
    log.info('archivist', `after LLM triage: ${filteredPaths.length} files to analyze (${llmJunk.size} more junk by LLM)`);
  }

  // Phase 2: deep analysis
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let noContent = 0;
  const TARGET_CHUNKS = 300;

  for (const filePath of filteredPaths) {
    // Stop if we have enough chunks
    if (factDb.stats().totalChunks >= TARGET_CHUNKS) {
      log.info('archivist', `reached ${TARGET_CHUNKS} chunks target, stopping`);
      break;
    }

    // Skip already processed files
    if (factDb.getFileByPath(filePath)) {
      skipped++;
      continue;
    }

    try {
      const content = readFileContent(filePath);
      if (!content && detectFileType(filePath) !== 'image') {
        noContent++;
        // Still record the file so we don't retry it every boot
        factDb.addFile({
          path: filePath,
          fileName: path.basename(filePath),
          type: detectFileType(filePath),
          summary: _t('archivist.no_content_summary', { type: detectFileType(filePath), name: path.basename(filePath) }),
          tags: [detectFileType(filePath)],
        });
        continue;
      }
      const result = await processFile(filePath, content);
      if (result && result.chunks.length > 0) {
        processed++;
      } else if (result) {
        noContent++;
      } else {
        failed++;
      }

      // Small delay between LLM calls (throttled during game, backoff on 429)
      await llmGate.wait(500);
    } catch (err) {
      failed++;
      const errMsg = err.message || '';
      if (errMsg.includes('429') || errMsg.includes('rate_limit')) {
        llmGate.report429();
      }
      log.warn('archivist', `error processing ${path.basename(filePath)}: ${errMsg.slice(0, 100)}`);
    }
  }

  log.info('archivist', `background work done: ${processed} analyzed, ${noContent} no content, ${failed} failed, ${skipped} skipped`);
  log.info('archivist', `fact-db stats: ${JSON.stringify(factDb.stats())}`);
}

module.exports = {
  init,
  processFile,
  startBackgroundWork,
  readFileContent,
};
