'use strict';

const fs = require('fs');
const path = require('path');
const log = require('./utils/logger');
const factDb = require('./fact-db');

let _locale = null;
function _t(key, params) {
  let s = (_locale && _locale[key]) || require('./locales/zh')[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
  }
  return s;
}

const THEMES_PATH = path.join(__dirname, '..', 'data', 'themes.json');

let _ctx = null;
let _themes = [];
let _loaded = false;

/**
 * Load themes from disk into memory.
 * @returns {Array<{name:string, description:string, fileIds:string[]}>}
 */
function loadThemesFromDisk() {
  try {
    if (!fs.existsSync(THEMES_PATH)) {
      _themes = [];
      _loaded = true;
      return _themes;
    }

    const raw = fs.readFileSync(THEMES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const themes = Array.isArray(parsed?.themes) ? parsed.themes : [];
    _themes = themes
      .filter(theme => theme && typeof theme.name === 'string')
      .map(theme => ({
        name: theme.name.trim(),
        description: String(theme.description || '').trim(),
        fileIds: Array.isArray(theme.fileIds)
          ? [...new Set(theme.fileIds.map(id => String(id || '').trim()).filter(Boolean))]
          : [],
      }));
    _loaded = true;
    return _themes;
  } catch (err) {
    log.warn('theme-cluster', `load failed: ${err.message}`);
    _themes = [];
    _loaded = true;
    return _themes;
  }
}

/**
 * Persist themes to data/themes.json.
 * @param {Array<{name:string, description:string, fileIds:string[]}>} themes - Theme list to save.
 * @returns {void}
 */
function saveThemes(themes) {
  fs.mkdirSync(path.dirname(THEMES_PATH), { recursive: true });
  fs.writeFileSync(THEMES_PATH, JSON.stringify({ themes }, null, 2), 'utf8');
  _themes = themes;
  _loaded = true;
}

/**
 * Initialize the theme cluster module with shared runtime context.
 * @param {{LLM?:object}} ctx - Shared server context.
 * @returns {void}
 */
function init(ctx) {
  _ctx = ctx || null;
  _locale = require('./locales/' + ((ctx && ctx.LOCALE) || 'zh'));
  loadThemesFromDisk();
}

/**
 * Get all currently loaded themes. Missing themes.json degrades to empty array.
 * @returns {Array<{name:string, description:string, fileIds:string[]}>}
 */
function getThemes() {
  if (!_loaded) loadThemesFromDisk();
  if (!fs.existsSync(THEMES_PATH)) return [];
  return Array.isArray(_themes) ? _themes : [];
}

/**
 * Get the theme name for a file id.
 * @param {string} fileId - Fact-db file id.
 * @returns {string|null}
 */
function getThemeForFile(fileId) {
  const targetId = String(fileId || '').trim();
  if (!targetId) return null;
  const theme = getThemes().find(item => Array.isArray(item.fileIds) && item.fileIds.includes(targetId));
  return theme ? theme.name : null;
}

/**
 * Get all file ids belonging to one theme.
 * @param {string} themeName - Theme name.
 * @returns {string[]}
 */
function getFilesByTheme(themeName) {
  const target = String(themeName || '').trim();
  if (!target) return [];
  const theme = getThemes().find(item => item.name === target);
  return theme ? [...theme.fileIds] : [];
}

/**
 * Cluster fact-db files into themes with the fast LLM and save to disk.
 * Missing LLM or malformed output degrades gracefully to the current in-memory state.
 * @returns {Promise<Array<{name:string, description:string, fileIds:string[]}>>}
 */
async function clusterThemes() {
  try {
    const llm = _ctx?.LLM;
    if (!llm || typeof llm.chat !== 'function') {
      log.warn('theme-cluster', 'LLM unavailable, skipping clustering');
      return getThemes();
    }

    const files = factDb.listFiles(10000).map(file => ({
      id: file.id,
      path: file.path || '',
      fileName: file.fileName || '',
      summary: file.summary || '',
    }));

    if (files.length === 0) {
      log.info('theme-cluster', 'no files available for clustering');
      return getThemes();
    }

    const systemPrompt = _t('theme.cluster.systemPrompt');

    const userPrompt = `文件列表：\n${JSON.stringify(files.map(file => ({ id: file.id, path: file.path, fileName: file.fileName })), null, 2)}`;
    const raw = await llm.chat(systemPrompt, [{ role: 'user', content: userPrompt }], {
      fast: true,
      max_tokens: 2000,
      temperature: 0.2,
    });

    const parsed = parseThemeResponse(raw, files.map(file => file.id));
    if (!parsed) {
      log.warn('theme-cluster', 'LLM returned invalid theme JSON');
      return getThemes();
    }

    saveThemes(parsed);
    log.info('theme-cluster', `clustered ${files.length} files into ${parsed.length} themes`);
    return parsed;
  } catch (err) {
    log.warn('theme-cluster', `cluster failed: ${err.message}`);
    return getThemes();
  }
}

/**
 * Parse and normalize raw LLM theme output.
 * @param {string} raw - Raw LLM response text.
 * @param {string[]} knownFileIds - File ids allowed in the final output.
 * @returns {Array<{name:string, description:string, fileIds:string[]}>|null}
 */
function parseThemeResponse(raw, knownFileIds) {
  const text = String(raw || '').trim();
  if (!text) return null;

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  const allowed = new Set(knownFileIds || []);
  const seen = new Set();
  const themes = [];

  for (const theme of Array.isArray(parsed?.themes) ? parsed.themes : []) {
    const fileIds = Array.isArray(theme?.fileIds)
      ? theme.fileIds.map(id => String(id || '').trim()).filter(id => allowed.has(id) && !seen.has(id))
      : [];
    for (const id of fileIds) seen.add(id);

    const name = String(theme?.name || '').trim();
    if (!name) continue;

    themes.push({
      name,
      description: String(theme?.description || '').trim(),
      fileIds,
    });
  }

  const remaining = knownFileIds.filter(id => !seen.has(id));
  if (remaining.length > 0) {
    const other = themes.find(theme => theme.name === '其他');
    if (other) other.fileIds.push(...remaining.filter(id => !other.fileIds.includes(id)));
    else themes.push({ name: '其他', description: '暂时无法明确归类的文件', fileIds: remaining });
  }

  return themes.length > 0 ? themes : null;
}

module.exports = {
  init,
  clusterThemes,
  getThemes,
  getThemeForFile,
  getFilesByTheme,
};
