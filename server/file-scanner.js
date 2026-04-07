'use strict';

// ─── File System Scanner for Enhanced Lure System ────────────────────────────
// Scans local filesystem for interesting files (images, text, code) that can
// be used as lure material. Respects agent permissions — scans everything
// accessible to the process.

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Scan Configuration ──────────────────────────────────────────────────────

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const TEXT_EXTS  = new Set(['.txt', '.md', '.json', '.js', '.ts', '.py', '.sh', '.yaml', '.yml', '.toml', '.css', '.html', '.xml', '.csv', '.log', '.ini', '.conf', '.cfg', '.pdf', '.docx', '.doc', '.xlsx', '.url', '.lnk']);

// Directories to skip (system/binary/cache dirs)
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '__pycache__', '.cache', '.npm', '.yarn',
  'dist', 'build', '.next', '.nuxt', 'target', 'bin', 'obj',
  'System Volume Information', '$RECYCLE.BIN', 'Windows', 'Program Files',
  'Program Files (x86)', 'ProgramData', 'Library',
  '.Trash', '.local', '.config', '.vscode', '.idea',
  // Audio/media tools that produce bulk uninteresting output
  'CrashDumps', 'crash-reports', 'CrashReport',
  // Game engines / launchers / caches
  'steam', 'Steam', 'steamapps', 'Overwolf', 'Battle.net', 'Epic Games', 'Riot Games',
  'cache', 'Cache', 'CachedData', 'cefcache', '.cefcache',
  'Temp', 'tmp',
  // IM / social app data
  'Tencent Files', 'nt_qq', 'WeChat Files', 'wechat',
  // Browser data
  'Google', 'Microsoft', 'BrowserExtensions',
  // Package managers
  'NuGet', 'Package Cache',
  // Game-internal directories (belt-and-suspenders self-exclusion)
  'session-logs', 'test-logs', 'test-soul', 'data-seed',
]);

// Directory name patterns to skip (regex, matched against dir basename).
// Catches bulk support-log / telemetry dumps without exact string matching.
const SKIP_DIR_PATTERNS = [
  /^MSTeams?\s+Support\s+Logs?\s/i,
  /^SkypeRT$/i,
  /Support\s+Logs?\s+\d{4}/i,
  /^Diagnostics?$/i,
  /^DiagnosticLogs?$/i,
  /ETL\s+Logs?/i,
  /^WER\d/,
];

// Files to skip (system junk + secret files)
const SKIP_FILES = new Set([
  '.DS_Store', 'Thumbs.db', 'desktop.ini', '.gitignore', '.gitattributes',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  // ── Secret / credential files — never show in lure ──
  '.env', '.env.local', '.env.development', '.env.production', '.env.staging',
  '.env.test', '.envrc',
  'credentials.json', 'credentials.yml', 'credentials.yaml',
  'secrets.json', 'secrets.yml', 'secrets.yaml',
  'private.key', 'private.pem', 'id_rsa', 'id_ed25519', 'id_ecdsa',
  '.npmrc', '.pypirc', '.netrc', '.pgpass',
  'wallet.dat', 'keystore.json',
]);

// Filename patterns (regex) that indicate credential/secret files — skip these
const SKIP_FILE_PATTERNS = [
  /^\.env(\.\w+)?$/,          // .env, .env.local, etc.
  /\bsecret\b/i,              // anything with "secret" in the name
  /\bcredential/i,            // credentials.json etc.
  /\bpassword/i,              // passwords.txt etc.
  /\bprivate[-_.]key/i,       // private.key, private_key.pem
  /\b(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.pub)?$/,  // SSH keys
  /\.(pem|p12|pfx|crt|cer|der|p8|asc)$/i,            // certs & private keys
  /\bkeystore\b/i,
  /\bwallet\b/i,
  /auth[-_]?(token|key|secret)/i,
];

// Max file size for text files (100KB)
const MAX_TEXT_SIZE = 100 * 1024;
// Max image size (20MB)
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
// Max scan depth
const MAX_DEPTH = 8;
// Max files to collect per category
const MAX_IMAGES = 200;
const MAX_TEXT_FILES = 100;
// Scan timeout (ms)
const SCAN_TIMEOUT = 120000; // 120 seconds

// ─── Scan Result Types ───────────────────────────────────────────────────────
// Each scanned file: { path, name, ext, type: 'image'|'text', size, mtime, dir }

/**
 * Get directories to scan based on OS and environment.
 * Prioritizes "interesting" personal directories.
 */
function getScanRoots() {
  const home = os.homedir();
  const roots = [];

  // Priority 1: User's personal directories
  const personalDirs = [
    'Desktop', 'Downloads', 'Documents', 'Pictures', 'Screenshots',
    'Music', 'Videos', 'Projects', 'repos', 'src', 'dev', 'code',
  ];
  for (const dir of personalDirs) {
    const full = path.join(home, dir);
    if (dirExists(full)) roots.push({ path: full, priority: 'high' });
  }

  // Priority 2: Agent workspace (SOUL_PATH)
  // Added dynamically via addScanRoot()

  // Priority 3: WSL Windows user directory
  const wslUser = process.env.WSLUSER || process.env.USER || '';
  if (process.platform === 'linux') {
    // Try common WSL mount points
    for (const drive of ['c', 'd', 'e']) {
      const winHome = `/mnt/${drive}/Users`;
      if (dirExists(winHome)) {
        try {
          const users = fs.readdirSync(winHome).filter(u =>
            !['Public', 'Default', 'Default User', 'All Users'].includes(u)
            && dirExists(path.join(winHome, u))
          );
          for (const u of users) {
            for (const dir of personalDirs) {
              const full = path.join(winHome, u, dir);
              if (dirExists(full)) roots.push({ path: full, priority: 'medium' });
            }
            // OneDrive paths
            const oneDriveDirs = [
              path.join(winHome, u, 'OneDrive'),
              path.join(winHome, u, 'OneDrive', '\u6587\u6863'),
            ];
            for (const od of oneDriveDirs) {
              if (dirExists(od)) roots.push({ path: od, priority: 'medium' });
            }
          }
        } catch { /* permission denied */ }
      }
    }
  }

  // Priority 3b: AppData/LocalLow (game screenshots/saves)
  if (process.platform === 'linux') {
    for (const drive of ['c', 'd', 'e']) {
      const winHome = `/mnt/${drive}/Users`;
      if (!dirExists(winHome)) continue;
      try {
        const users = fs.readdirSync(winHome).filter(u =>
          !['Public', 'Default', 'Default User', 'All Users'].includes(u)
          && dirExists(path.join(winHome, u))
        );
        for (const u of users) {
          const appDataLow = path.join(winHome, u, 'AppData', 'LocalLow');
          if (dirExists(appDataLow)) roots.push({ path: appDataLow, priority: 'low' });
        }
      } catch {}
    }
  }

  // Priority 3c: Other drive roots — scan top-level personal directories (recently modified)
  if (process.platform === 'linux') {
    for (const drive of ['d', 'e', 'f']) {
      const driveRoot = `/mnt/${drive}`;
      if (!dirExists(driveRoot)) continue;
      try {
        const topDirs = fs.readdirSync(driveRoot).filter(d => {
          if (d.startsWith('$') || d.startsWith('.')) return false;
          if (d === 'Users' || d === 'Windows') return false;
          return dirExists(path.join(driveRoot, d));
        });
        for (const d of topDirs) {
          const full = path.join(driveRoot, d);
          try {
            const stat = fs.statSync(full);
            // Only add if recently modified (within 180 days)
            if (Date.now() - stat.mtimeMs < 180 * 24 * 60 * 60 * 1000) {
              roots.push({ path: full, priority: 'low' });
            }
          } catch {}
        }
      } catch {}
    }
  }

  // Priority 4: macOS-specific
  if (process.platform === 'darwin') {
    const macDirs = [
      path.join(home, 'Library', 'Mobile Documents'), // iCloud
    ];
    for (const d of macDirs) {
      if (dirExists(d)) roots.push({ path: d, priority: 'low' });
    }
  }

  // Deduplicate by resolved path
  const seen = new Set();
  return roots.filter(r => {
    const resolved = path.resolve(r.path);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

function dirExists(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

/**
 * Recursively scan a directory for interesting files.
 * @param {string} dir - Directory to scan
 * @param {number} depth - Current recursion depth
 * @param {object} results - Accumulator { images: [], textFiles: [] }
 * @param {number} deadline - Timestamp when scan must stop
 */
function scanDir(dir, depth, results, deadline, excludePaths) {
  if (depth > MAX_DEPTH) return;
  if (Date.now() > deadline) return;
  if (results.images.length >= MAX_IMAGES && results.textFiles.length >= MAX_TEXT_FILES) return;

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; } // permission denied

  for (const entry of entries) {
    if (Date.now() > deadline) return;

    const name = entry.name;
    if (name.startsWith('.') && name !== '.openclaw') continue;
    if (SKIP_FILES.has(name)) continue;
    if (SKIP_FILE_PATTERNS.some(p => p.test(name))) continue;

    const fullPath = path.join(dir, name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      if (SKIP_DIR_PATTERNS.some(p => p.test(name))) continue;
      // Self-exclusion: skip game's own directory tree
      if (excludePaths && excludePaths.some(ep => fullPath === ep || fullPath.startsWith(ep + path.sep))) continue;
      scanDir(fullPath, depth + 1, results, deadline, excludePaths);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(name).toLowerCase();
    let stat;
    try { stat = fs.statSync(fullPath); } catch { continue; }

    if (IMAGE_EXTS.has(ext) && results.images.length < MAX_IMAGES) {
      if (stat.size > 0 && stat.size <= MAX_IMAGE_SIZE) {
        results.images.push({
          path: fullPath,
          name,
          ext,
          type: 'image',
          size: stat.size,
          mtime: stat.mtimeMs,
          dir: dir,
        });
      }
    } else if (TEXT_EXTS.has(ext) && results.textFiles.length < MAX_TEXT_FILES) {
      if (stat.size > 0 && stat.size <= MAX_TEXT_SIZE) {
        results.textFiles.push({
          path: fullPath,
          name,
          ext,
          type: 'text',
          size: stat.size,
          mtime: stat.mtimeMs,
          dir: dir,
        });
      }
    }
  }
}

/**
 * Extract a text preview from a file (first N lines, respecting encoding).
 */
function extractTextPreview(filePath, maxLines = 30, maxChars = 2000) {
  const ext = path.extname(filePath).toLowerCase();

  // .url files: extract target URL
  if (ext === '.url') {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const urlMatch = content.match(/URL=(.+)/i);
      const url = urlMatch ? urlMatch[1].trim() : '';
      return { preview: `快捷方式 → ${url}`, totalLines: 1, language: 'url' };
    } catch { return null; }
  }

  // .lnk files: filename only (binary format)
  if (ext === '.lnk') {
    const name = path.basename(filePath, '.lnk');
    return { preview: `桌面快捷方式：${name}`, totalLines: 1, language: 'shortcut' };
  }

  // .docx: extract text via unzip (it's a zip file with word/document.xml inside)
  if (ext === '.docx') {
    try {
      const { execFileSync } = require('child_process');
      const raw = execFileSync('unzip', ['-p', filePath, 'word/document.xml'], { maxBuffer: 512 * 1024, timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
      const text = raw.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text.length > 10) {
        return { preview: text.slice(0, maxChars), totalLines: 0, language: 'document' };
      }
    } catch { /* fall through to metadata-only */ }
    const name = path.basename(filePath);
    try {
      const stat = fs.statSync(filePath);
      return { preview: `${name}（${(stat.size/1024/1024).toFixed(1)}MB）`, totalLines: 0, language: 'document' };
    } catch { return null; }
  }

  // .xlsx: extract shared strings via unzip
  if (ext === '.xlsx') {
    try {
      const { execFileSync } = require('child_process');
      const raw = execFileSync('unzip', ['-p', filePath, 'xl/sharedStrings.xml'], { maxBuffer: 512 * 1024, timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] });
      const text = raw.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text.length > 10) {
        return { preview: text.slice(0, maxChars), totalLines: 0, language: 'spreadsheet' };
      }
    } catch { /* fall through */ }
    const name = path.basename(filePath);
    try {
      const stat = fs.statSync(filePath);
      return { preview: `${name}（${(stat.size/1024/1024).toFixed(1)}MB）`, totalLines: 0, language: 'spreadsheet' };
    } catch { return null; }
  }

  // .pdf: try pdftotext → pdf-parse → metadata fallback
  if (ext === '.pdf') {
    // Method 1: pdftotext (fast, if system has poppler-utils)
    try {
      const { execFileSync } = require('child_process');
      const text = execFileSync('pdftotext', [filePath, '-'], { maxBuffer: 512 * 1024, timeout: 10000, stdio: ['pipe', 'pipe', 'ignore'] }).toString('utf8').trim();
      if (text.length > 10) {
        return { preview: text.slice(0, maxChars), totalLines: 0, language: 'document' };
      }
    } catch { /* pdftotext not available */ }
    // Method 2: pdf-parse (npm package, no system deps)
    try {
      // Sync wrapper: pdf-parse is async but we need sync here.
      // Use execFileSync (no shell) to run a small inline script.
      const { execFileSync: execF } = require('child_process');
      const script = `const fs=require('fs');const p=require('pdf-parse');p(fs.readFileSync(${JSON.stringify(filePath)})).then(d=>process.stdout.write(d.text.slice(0,${maxChars}))).catch(()=>process.exit(1))`;
      const text = execF('node', ['-e', script], { maxBuffer: 512 * 1024, timeout: 15000 }).toString('utf8').trim();
      if (text.length > 10) {
        return { preview: text.slice(0, maxChars), totalLines: 0, language: 'document' };
      }
    } catch { /* pdf-parse failed */ }
    // Method 3: metadata only
    const name = path.basename(filePath);
    try {
      const stat = fs.statSync(filePath);
      return { preview: `${name}（${(stat.size/1024/1024).toFixed(1)}MB）`, totalLines: 0, language: 'document' };
    } catch { return null; }
  }

  // .doc: metadata only (binary format, needs antiword/catdoc)
  if (ext === '.doc') {
    const name = path.basename(filePath);
    try {
      const stat = fs.statSync(filePath);
      return { preview: `${name}（${(stat.size/1024/1024).toFixed(1)}MB）`, totalLines: 0, language: 'document' };
    } catch { return null; }
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').slice(0, maxLines);
    const preview = lines.join('\n').slice(0, maxChars);
    return { preview, totalLines: content.split('\n').length, language: detectLanguage(filePath) };
  } catch { return null; }
}

/**
 * Detect programming language from file extension.
 */
function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const langMap = {
    '.js': 'javascript', '.ts': 'typescript', '.py': 'python',
    '.sh': 'bash', '.json': 'json', '.md': 'markdown',
    '.html': 'html', '.css': 'css', '.yaml': 'yaml', '.yml': 'yaml',
    '.toml': 'toml', '.xml': 'xml', '.csv': 'csv', '.txt': 'text',
    '.log': 'text', '.ini': 'ini', '.conf': 'text', '.cfg': 'text',
    '.pdf': 'document', '.docx': 'document', '.doc': 'document',
    '.xlsx': 'spreadsheet', '.url': 'url', '.lnk': 'shortcut',
  };
  return langMap[ext] || 'text';
}


/**
 * Deduplicate files from bulk-download directories.
 * If a single directory contains more than `threshold` files of the same category,
 * mark them as _bulkDir and keep only the `keepCount` most-recent ones.
 *
 * @param {object[]} files - Array of scanned file objects (must have .dir and .mtime)
 * @param {number} threshold - Min file count in a dir to trigger dedup
 * @param {number} keepCount - How many files to keep per bulk dir
 * @returns {object[]} Deduplicated array with _bulkDir and _dirImageCount fields
 */
function deduplicateBulkDir(files, threshold, keepCount) {
  // Group by directory
  const byDir = new Map();
  for (const f of files) {
    const list = byDir.get(f.dir) || [];
    list.push(f);
    byDir.set(f.dir, list);
  }

  const result = [];
  for (const [dir, group] of byDir) {
    const count = group.length;
    if (count > threshold) {
      // Sort by mtime descending, keep only the newest `keepCount`
      group.sort((a, b) => b.mtime - a.mtime);
      const kept = group.slice(0, keepCount);
      for (const f of kept) {
        result.push({ ...f, _bulkDir: true, _dirImageCount: count });
      }
    } else {
      // Not a bulk dir — annotate with count but keep all
      for (const f of group) {
        result.push({ ...f, _dirImageCount: count });
      }
    }
  }

  // Re-sort by mtime descending to maintain original order
  result.sort((a, b) => b.mtime - a.mtime);
  return result;
}

// ─── Deep Scan: PDF/DOCX/XLSX across all drives ────────────────────────────

const DEEP_DOC_EXTS = new Set(['.pdf', '.docx', '.xlsx']);
const DEEP_SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '__pycache__', '.cache', '.npm', '.yarn',
  'dist', 'build', '.next', '.nuxt', 'target', 'bin', 'obj',
  'System Volume Information', '$RECYCLE.BIN', 'Windows', 'Program Files',
  'Program Files (x86)', 'ProgramData',
  'AppData', '.Trash', '.local', '.config',
  'cache', 'Cache', 'CachedData', 'Temp', 'tmp',
  // IM / social app data
  'Tencent Files', 'nt_qq', 'WeChat Files', 'wechat',
  // Game launchers / engines
  'Steam', 'steamapps', 'Epic Games', 'Overwolf', 'Battle.net', 'Riot Games',
  // Browser data
  'Google', 'Microsoft', 'BrowserExtensions', 'IndexedDB', 'Service Worker',
  // Package managers / build caches
  'NuGet', 'Package Cache', 'pip', 'conda', 'Maven',
  // Media caches
  'Spotify', 'iTunes', 'VLC',
]);

/**
 * Deep scan for PDF/DOCX/XLSX files across all drives. No depth limit.
 * @returns {string[]} Array of file paths
 */
function deepScanForDocuments(excludePaths) {
  const results = [];
  const deadline = Date.now() + SCAN_TIMEOUT;
  const _excludes = excludePaths || [];

  function walk(dir) {
    if (Date.now() > deadline) return;
    if (results.length >= 500) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (Date.now() > deadline) return;
      const name = entry.name;
      if (name.startsWith('.') || name.startsWith('$')) continue;

      const fullPath = path.join(dir, name);

      if (entry.isDirectory()) {
        if (DEEP_SKIP_DIRS.has(name)) continue;
        if (_excludes.some(ep => fullPath === ep || fullPath.startsWith(ep + path.sep))) continue;
        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(name).toLowerCase();
      if (DEEP_DOC_EXTS.has(ext)) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > 0 && stat.size <= 50 * 1024 * 1024) { // 50MB max
            results.push(fullPath);
          }
        } catch {}
      }
    }
  }

  // Scan all WSL drive mounts
  if (process.platform === 'linux') {
    for (const drive of ['c', 'd', 'e']) {
      const driveRoot = `/mnt/${drive}`;
      if (dirExists(driveRoot)) {
        console.log(`[file-scanner] deep doc scan: /mnt/${drive}`);
        walk(driveRoot);
      }
    }
  } else {
    // macOS / native Linux: scan home
    walk(os.homedir());
  }

  console.log(`[file-scanner] deep doc scan found ${results.length} documents`);
  return results;
}

/**
 * Run the full file scan. Returns { images, textFiles, scanTime, roots }.
 * @param {string[]} extraRoots - Additional directories to scan (e.g. SOUL_PATH)
 * @param {object} [options] - Scan options
 * @param {string[]} [options.excludePaths] - Absolute paths to exclude from scanning (e.g. game dir)
 */
function fullScan(extraRoots = [], options = {}) {
  const startTime = Date.now();
  const deadline = startTime + SCAN_TIMEOUT;
  const results = { images: [], textFiles: [] };
  const excludePaths = (options.excludePaths || []).map(p => path.resolve(p));

  const roots = getScanRoots();
  for (const extra of extraRoots) {
    if (extra && dirExists(extra)) {
      roots.push({ path: extra, priority: 'high' });
    }
  }

  console.log(`[file-scanner] scanning ${roots.length} root directories...`);
  if (excludePaths.length > 0) {
    console.log(`[file-scanner] excluding: ${excludePaths.join(', ')}`);
  }

  // Sort by priority (high first)
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  roots.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));

  for (const root of roots) {
    if (Date.now() > deadline) {
      console.log(`[file-scanner] timeout reached, stopping scan`);
      break;
    }
    console.log(`[file-scanner]   → ${root.path} (${root.priority})`);
    scanDir(root.path, 0, results, deadline, excludePaths);
  }

  // Sort by mtime (most recent first) — recent files are more interesting
  results.images.sort((a, b) => b.mtime - a.mtime);
  results.textFiles.sort((a, b) => b.mtime - a.mtime);

  // Bulk-directory dedup: collapse dirs with many same-type files
  results.images = deduplicateBulkDir(results.images, 5, 2);
  results.textFiles = deduplicateBulkDir(results.textFiles, 10, 2);

  // Phase 2: deep document scan (PDF/DOCX/XLSX across all drives)
  const deepDocs = deepScanForDocuments(excludePaths);
  const existingPaths = new Set(results.textFiles.map(f => f.path));
  for (const docPath of deepDocs) {
    if (existingPaths.has(docPath)) continue;
    const name = path.basename(docPath);
    const ext  = path.extname(name).toLowerCase();
    try {
      const stat = fs.statSync(docPath);
      results.textFiles.push({
        path: docPath, name, ext, type: 'text',
        size: stat.size, mtime: stat.mtimeMs, dir: path.dirname(docPath),
      });
    } catch {}
  }

  // Re-sort after merging
  results.textFiles.sort((a, b) => b.mtime - a.mtime);

  const scanTime = Date.now() - startTime;
  console.log(`[file-scanner] done in ${(scanTime/1000).toFixed(1)}s: ${results.images.length} images, ${results.textFiles.length} text files`);

  return {
    images: results.images,
    textFiles: results.textFiles,
    scanTime,
    roots: roots.map(r => r.path),
  };
}

module.exports = {
  fullScan,
  deepScanForDocuments,
  getScanRoots,
  extractTextPreview,
  detectLanguage,
  IMAGE_EXTS,
  TEXT_EXTS,
  dirExists,
};
