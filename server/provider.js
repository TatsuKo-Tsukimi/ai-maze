'use strict';
/**
 * ═══════════════════════════════════════════════════════════════
 * AI Provider Auto-Detection & Unified Interface
 * ═══════════════════════════════════════════════════════════════
 *
 * Detection priority:
 *   1. Explicit env vars (ANTHROPIC_API_KEY / OPENAI_API_KEY)
 *   2. OpenClaw auth-profiles.json (Anthropic first, then OpenAI)
 *   3. Fallback env var API_KEY
 *   4. OpenClaw Gateway (localhost)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');

/**
 * Resolve the local OpenClaw home directory.
 * @returns {string|null} OpenClaw home path when readable.
 */
/** Detected WSL distro name (cached for Linux→UNC path conversion). */
let _wslDistro = null;

function getOpenClawHome() {
  if (process.env.OPENCLAW_HOME) return process.env.OPENCLAW_HOME;
  const home = os.homedir();
  const candidates = [
    path.join(home, '.openclaw'),
  ];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'OpenClaw'));

    // WSL: probe common distros via //wsl.localhost/{distro}/home/{user}/.openclaw
    // Note: enumerating //wsl.localhost itself fails on some setups, so we try known distro names.
    const wslDistros = ['Ubuntu', 'Ubuntu-22.04', 'Ubuntu-24.04', 'Ubuntu-20.04',
                        'Debian', 'kali-linux', 'openSUSE-Leap-15.5', 'Alpine'];
    for (const distro of wslDistros) {
      try {
        const wslHome = path.join('//wsl.localhost', distro, 'home');
        const users = fs.readdirSync(wslHome);
        for (const user of users) {
          candidates.push(path.join(wslHome, user, '.openclaw'));
        }
      } catch {}
    }
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'OpenClaw'));
  } else {
    candidates.push(path.join(home, '.config', 'openclaw'));
  }
  for (const dir of candidates) {
    try {
      fs.accessSync(dir, fs.constants.R_OK);
      // Cache WSL distro name for later path conversion
      const wslMatch = dir.replace(/\\/g, '/').match(/^\/\/wsl\.localhost\/([^/]+)\//);
      if (wslMatch) _wslDistro = wslMatch[1];
      return dir;
    } catch {}
  }
  return null;
}

/**
 * Convert a Linux-style path to a Windows UNC path when running on Windows
 * and the OpenClaw home was detected inside WSL.
 * e.g. /home/user/.openclaw/workspace → //wsl.localhost/Ubuntu/home/user/.openclaw/workspace
 */
function linuxToWslUNC(linuxPath) {
  if (!linuxPath || typeof linuxPath !== 'string') return linuxPath;
  if (process.platform !== 'win32') return linuxPath;
  if (!_wslDistro) return linuxPath;
  // Only convert absolute Linux paths (starting with /)
  if (!linuxPath.startsWith('/')) return linuxPath;
  // Already a UNC path
  if (linuxPath.startsWith('//')) return linuxPath;
  return path.join('//wsl.localhost', _wslDistro, linuxPath);
}

/**
 * Read OpenClaw config.
 * @param {string|null} ocHome - OpenClaw home directory.
 * @returns {Record<string, any>|null}
 */
function readOpenClawConfig(ocHome) {
  if (!ocHome) return null;
  try {
    const raw = fs.readFileSync(path.join(ocHome, 'openclaw.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read local OpenClaw Gateway settings.
 * @returns {{ port: number, token: string, apiBase: string, source: string }|null}
 */
function readGatewayConfig() {
  const ocHome = getOpenClawHome();
  const config = readOpenClawConfig(ocHome);
  const port = Number(config?.gateway?.port || 18789);
  const token = typeof config?.gateway?.auth?.token === 'string'
    ? config.gateway.auth.token.trim()
    : '';

  if (!token) return null;

  return {
    port,
    token,
    apiBase: `http://127.0.0.1:${port}`,
    source: `OpenClaw Gateway (localhost:${port})`,
  };
}

function readAuthProfiles() {
  const ocHome = getOpenClawHome();
  if (!ocHome) return {};
  const filePath = path.join(ocHome, 'agents', 'main', 'agent', 'auth-profiles.json');
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return data.profiles || data;
  } catch {
    return {};
  }
}

// ─── Try to find SOUL.md from Claude workspace ───────────────
function findSoulPath() {
  // Explicit env var takes priority
  if (process.env.SOUL_PATH) return process.env.SOUL_PATH;

  // Try OpenClaw configured workspace
  const ocHome = getOpenClawHome();
  if (ocHome) {
    try {
      const config = readOpenClawConfig(ocHome);
      const workspace = config?.agents?.defaults?.workspace;
      if (workspace && typeof workspace === 'string') {
        const resolved = path.resolve(linuxToWslUNC(workspace));
        const configuredMemoryFiles = ['SOUL.md', 'MEMORY.md', 'USER.md', 'IDENTITY.md'];
        for (const fname of configuredMemoryFiles) {
          try {
            fs.accessSync(path.join(resolved, fname), fs.constants.R_OK);
            console.log(`  ✅ OpenClaw workspace: ${resolved} (${fname})`);
            return resolved;
          } catch {}
        }
      }
    } catch {}
  }

  const home = os.homedir();
  const candidates = [];

  // Env-specified Agent home
  if (process.env.CLAUDE_HOME) candidates.push(process.env.CLAUDE_HOME);
  if (process.env.AGENT_HOME) candidates.push(process.env.AGENT_HOME);

  // Claude Code / Claude Desktop
  candidates.push(path.join(home, '.claude'));
  candidates.push(path.join(home, 'Claude'));
  candidates.push(path.join(home, 'Documents', 'Claude'));

  // OpenClaw
  candidates.push(path.join(home, '.openclaw'));
  candidates.push(path.join(home, 'openclaw'));
  candidates.push(path.join(home, '.config', 'openclaw'));

  // Generic Agent locations
  candidates.push(path.join(home, '.agent'));
  candidates.push(path.join(home, '.config', 'claude'));
  candidates.push(path.join(home, '.config', 'agent'));

  // Platform-specific
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'Claude'));
    candidates.push(path.join(appData, 'OpenClaw'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'Claude'));
    candidates.push(path.join(home, 'Library', 'Application Support', 'OpenClaw'));
  }

  // Search for ANY recognized memory file
  const MEMORY_FILES = ['SOUL.md', 'soul.md', 'MEMORY.md', 'memory.md', 'USER.md', 'user.md'];

  function checkDir(dir) {
    for (const fname of MEMORY_FILES) {
      try {
        fs.accessSync(path.join(dir, fname), fs.constants.R_OK);
        console.log(`  ✅ 找到 ${fname} → ${dir}`);
        return dir;
      } catch {}
    }
    try {
      const memDir = path.join(dir, 'memory');
      const files = fs.readdirSync(memDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
      if (files.length > 0) {
        console.log(`  ✅ 找到 memory/ 日记目录 (${files.length} 个文件) → ${dir}`);
        return dir;
      }
    } catch {}
    return null;
  }

  console.log('🔎 搜索 SOUL.md / MEMORY.md …');

  for (const dir of candidates) {
    console.log(`  📂 检查: ${dir}`);
    const found = checkDir(dir);
    if (found) return found;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const subDir = path.join(dir, entry.name);
          console.log(`  📂 检查子目录: ${subDir}`);
          const subFound = checkDir(subDir);
          if (subFound) return subFound;
        }
      }
    } catch {}
  }

  console.log('  ❌ 未找到任何记忆文件');
  return '';
}

function pickAuthProfileKey(profiles, wantProvider) {
  if (!profiles || typeof profiles !== 'object') return null;

  for (const [key, val] of Object.entries(profiles)) {
    if (!val || typeof val !== 'object') continue;
    const token = val.token || val.key || val.apiKey || '';
    if (!token || token.length <= 10) continue;

    if (wantProvider === 'anthropic' && key.startsWith('anthropic:')) {
      return {
        apiKey: token,
        source: `OpenClaw auth-profiles (${key})`,
        model: 'claude-sonnet-4-20250514',
      };
    }

    if (wantProvider === 'openai' && key.startsWith('openai:') && val.type !== 'oauth') {
      return {
        apiKey: token,
        source: `OpenClaw auth-profiles (${key})`,
        apiBase: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
      };
    }
  }

  return null;
}

/**
 * Auto-detect provider configuration.
 * Priority:
 *   1. Env vars ANTHROPIC_API_KEY / OPENAI_API_KEY
 *   2. OpenClaw auth-profiles.json (Anthropic first, then OpenAI)
 *   3. Env var API_KEY
 *   4. OpenClaw Gateway (localhost)
 * @returns {Promise<{
 *   provider: ('openclaw-gateway'|'anthropic'|'openai'|null),
 *   apiKey: string,
 *   apiBase: string,
 *   model: string,
 *   fastModel: string,
 *   soulPath: string,
 *   source: string,
 *   warnings: string[],
 *   gatewayPort?: number
 * }>}
 */
async function autoDetect() {
  const result = {
    provider: null,
    apiKey: '',
    apiBase: '',
    model: '',
    fastModel: '',
    soulPath: '',
    source: '',
    warnings: [],
    gatewayPort: undefined,
  };

  const envModel = (process.env.MAZE_MODEL || process.env.MODEL || '').trim();
  const envFastModel = (process.env.FAST_MODEL || '').trim();
  const envApiBase = (process.env.API_BASE || '').trim().replace(/\/$/, '');

  function applyProvider(provider, apiKey, source, extra = {}) {
    result.provider = provider;
    result.apiKey = apiKey;
    result.apiBase = extra.apiBase || '';
    result.model = extra.model || '';
    result.fastModel = extra.fastModel || envFastModel || result.model;
    result.source = source;
    if (typeof extra.gatewayPort === 'number') result.gatewayPort = extra.gatewayPort;
  }

  // 1. Explicit env vars
  if (process.env.ANTHROPIC_API_KEY) {
    applyProvider('anthropic', process.env.ANTHROPIC_API_KEY, 'env ANTHROPIC_API_KEY', {
      model: envModel || 'claude-sonnet-4-20250514',
      fastModel: envFastModel || envModel || 'claude-sonnet-4-20250514',
    });
  } else if (process.env.OPENAI_API_KEY) {
    applyProvider('openai', process.env.OPENAI_API_KEY, 'env OPENAI_API_KEY', {
      apiBase: envApiBase || 'https://api.openai.com/v1',
      model: envModel || 'gpt-4o-mini',
      fastModel: envFastModel || envModel || 'gpt-4o-mini',
    });
  }

  // 2. OpenClaw Gateway (preferred for OpenClaw users)
  if (!result.provider) {
    const gateway = readGatewayConfig();
    if (gateway) {
      // Probe gateway to verify LLM proxy is actually available
      // Use /v1/chat/completions (not /v1/models which lists agent targets regardless)
      let gatewayAlive = false;
      try {
        const res = await fetch(`${gateway.apiBase}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${gateway.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'openclaw/default', messages: [] }),
          signal: AbortSignal.timeout(2000),
        });
        // 404 = endpoint not available; any other status (400, 422, etc.) = endpoint exists
        gatewayAlive = res.status !== 404;
      } catch {}
      if (gatewayAlive) {
        applyProvider('openclaw-gateway', gateway.token, gateway.source, {
          apiBase: gateway.apiBase,
          model: envModel || 'openclaw/default',
          gatewayPort: gateway.port,
        });
      } else {
        console.log('  ⚠ OpenClaw Gateway detected but not proxying LLM — skipping');
      }
    }
  }

  // 3. OpenClaw auth-profiles.json (Anthropic first, then OpenAI)
  if (!result.provider) {
    const profiles = readAuthProfiles();
    if (profiles) {
      const anthro = pickAuthProfileKey(profiles, 'anthropic');
      if (anthro) {
        applyProvider('anthropic', anthro.apiKey, anthro.source, {
          model: envModel || anthro.model,
          fastModel: envFastModel || envModel || anthro.model,
        });
      } else {
        const oai = pickAuthProfileKey(profiles, 'openai');
        if (oai) {
          applyProvider('openai', oai.apiKey, oai.source, {
            apiBase: envApiBase || oai.apiBase || 'https://api.openai.com/v1',
            model: envModel || oai.model,
            fastModel: envFastModel || envModel || oai.model,
          });
        }
      }
    }
  }

  // 4. Fallback env var API_KEY
  if (!result.provider && process.env.API_KEY) {
    const key = process.env.API_KEY;
    const looksAnthropic = key.startsWith('sk-ant-');
    applyProvider(looksAnthropic ? 'anthropic' : 'openai', key, 'env API_KEY', {
      apiBase: looksAnthropic ? '' : (envApiBase || 'https://api.openai.com/v1'),
      model: envModel || (looksAnthropic ? 'claude-sonnet-4-20250514' : 'gpt-4o-mini'),
      fastModel: envFastModel || envModel || (looksAnthropic ? 'claude-sonnet-4-20250514' : 'gpt-4o-mini'),
    });
  }

  result.soulPath = findSoulPath();

  if (!result.provider) {
    result.warnings.push('No provider detected. Configure OpenClaw Gateway, or set ANTHROPIC_API_KEY / OPENAI_API_KEY.');
    result.source = 'no provider detected';
  }

  if (!result.model) {
    result.warnings.push('未预设模型：将由 OpenClaw Gateway 或调用方决定。');
  }

  return result;
}

/**
 * Execute an HTTP(S) POST request.
 * @param {string} urlString
 * @param {Record<string, string>} headers
 * @param {string} body
 * @returns {Promise<{ status: number|undefined, body: string }>} HTTP response.
 */
function requestPost(urlString, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const lib = url.protocol === 'http:' ? http : https;
    const opts = {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    };
    const req = lib.request(opts, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('LLM timeout'));
    });
    req.write(body);
    req.end();
  });
}

function getAnthropicHeaders(apiKey) {
  const isOAuth = typeof apiKey === 'string' && apiKey.startsWith('sk-ant-oat');
  const headers = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
  };
  if (isOAuth) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else {
    headers['x-api-key'] = apiKey;
  }
  return headers;
}

async function callAnthropicMessages(apiKey, payload) {
  const body = JSON.stringify(payload);
  const response = await requestPost(
    'https://api.anthropic.com/v1/messages',
    getAnthropicHeaders(apiKey),
    body,
  );

  if (response.status === 200) {
    return (JSON.parse(response.body).content || [])
      .filter(block => block && block.type === 'text')
      .map(block => block.text || '')
      .join('');
  }

  throw new Error(`Anthropic HTTP ${response.status}: ${(response.body || '').slice(0, 200)}`);
}

function extractOpenAITextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .join('');
  }
  return '';
}

async function callOpenAICompatible(url, headers, payload, errorLabel) {
  const response = await requestPost(url, headers, JSON.stringify(payload));
  if (response.status !== 200) {
    throw new Error(`${errorLabel} HTTP ${response.status}: ${(response.body || '').slice(0, 200)}`);
  }
  const parsed = response.body ? JSON.parse(response.body) : {};
  return extractOpenAITextContent(parsed.choices?.[0]?.message?.content);
}

/**
 * Build a unified LLM client.
 * Supports OpenClaw Gateway, Anthropic Messages API, and OpenAI-compatible Chat Completions.
 * @param {{ provider: string, apiKey: string, apiBase?: string, model: string, fastModel?: string }} config
 * @returns {{ provider: string, model: string, chatWithImage: Function, chat: Function }}
 */
function createLLMClient(config) {
  const { provider, apiKey, apiBase, model } = config;
  const fastModel = config.fastModel || model;
  const gatewayBase = (apiBase || 'http://127.0.0.1:18789').replace(/\/$/, '');
  // True Gateway base URL from local config (used to detect env-based Gateway proxy)
  const _realGateway = readGatewayConfig();
  const _realGatewayBase = _realGateway ? _realGateway.apiBase.replace(/\/$/, '') : null;
  // Auto-disabled when a reasoning model is detected (outputs <think> blocks)
  let _disablePrefill = false;

  /** Strip provider/ prefix for direct API calls (e.g. 'anthropic/claude-sonnet-4-20250514' → 'claude-sonnet-4-20250514') */
  function rawModel(canonical) {
    if (typeof canonical === 'string' && canonical.includes('/')) return canonical.split('/').slice(1).join('/');
    return canonical;
  }

  function getGatewayHeaders(options = {}, extraHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'x-openclaw-scopes': 'operator.read,operator.write',
      ...extraHeaders,
    };
    // Route model selection through x-openclaw-model header (Gateway rejects raw model names in body)
    const effectiveModel = options.model || (options.fast ? fastModel : model) || '';
    if (effectiveModel && effectiveModel !== 'openclaw/default') {
      headers['x-openclaw-model'] = effectiveModel;
    }
    return headers;
  }

  /** Body model for Gateway: always 'openclaw/default' (real model goes in header) */
  const GATEWAY_BODY_MODEL = 'openclaw/default';

  return {
    provider,
    model,

    async chatWithImage(prompt, base64Image, mimeType, options = {}) {
      const maxTokens = options.max_tokens || 300;
      const temperature = options.temperature || 0.7;
      const activeModel = options.model || (options.fast ? fastModel : model) || 'openclaw/default';

      if (provider === 'openclaw-gateway') {
        return callOpenAICompatible(
          `${gatewayBase}/v1/chat/completions`,
          getGatewayHeaders(options),
          {
            model: GATEWAY_BODY_MODEL,
            max_tokens: maxTokens,
            temperature,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
              ],
            }],
          },
          'OpenClaw Gateway vision',
        );
      }

      if (provider === 'anthropic') {
        return callAnthropicMessages(apiKey, {
          model: rawModel(activeModel),
          max_tokens: maxTokens,
          temperature,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
              { type: 'text', text: prompt },
            ],
          }],
        });
      }

      if (provider === 'openai') {
        const base = (apiBase || 'https://api.openai.com/v1').replace(/\/$/, '');
        const isGwProxy = gatewayBase && base.startsWith(gatewayBase);
        const visionHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        };
        if (isGwProxy) {
          visionHeaders['x-openclaw-scopes'] = 'operator.read,operator.write';
          if (activeModel && activeModel !== 'openclaw/default') {
            visionHeaders['x-openclaw-model'] = activeModel;
          }
        }
        return callOpenAICompatible(
          `${base}/chat/completions`,
          visionHeaders,
          {
            model: isGwProxy ? 'openclaw/default' : rawModel(activeModel),
            max_tokens: maxTokens,
            temperature,
            messages: [{
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
                { type: 'text', text: prompt },
              ],
            }],
          },
          isGwProxy ? 'OpenClaw Gateway vision (openai path)' : 'OpenAI vision',
        );
      }

      return null;
    },

    // Capability-aware prefill: only enabled for verified providers
    supportsPrefill() {
      return !_disablePrefill && ['anthropic', 'openclaw-gateway', 'openai'].includes(provider);
    },

    async chat(systemPrompt, messages, options = {}) {
      const maxTokens = options.max_tokens || 120;
      const temperature = options.temperature || 0.85;
      const activeModel = options.model || (options.fast ? fastModel : model) || 'openclaw/default';

      // Append prefill assistant message if requested and provider supports it
      let finalMessages = messages;
      if (options.prefill && !_disablePrefill && ['anthropic', 'openclaw-gateway', 'openai'].includes(provider)) {
        finalMessages = [...messages, { role: 'assistant', content: options.prefill }];
      }

      let raw;
      if (provider === 'openclaw-gateway') {
        raw = await callOpenAICompatible(
          `${gatewayBase}/v1/chat/completions`,
          getGatewayHeaders(options),
          {
            model: GATEWAY_BODY_MODEL,
            max_tokens: maxTokens,
            temperature,
            messages: [{ role: 'system', content: systemPrompt }, ...finalMessages],
          },
          'OpenClaw Gateway',
        );
      } else if (provider === 'anthropic') {
        raw = await callAnthropicMessages(apiKey, {
          model: rawModel(activeModel),
          max_tokens: maxTokens,
          temperature,
          system: systemPrompt,
          messages: finalMessages,
        });
      } else {
        // This fallback path handles 'openai' provider (including when routed through Gateway via env vars)
        const base = (apiBase || 'https://api.openai.com/v1').replace(/\/$/, '');
        // Detect Gateway: env-based setup where OPENAI_API_KEY points to Gateway
        const isGatewayProxy = _realGatewayBase && base.startsWith(_realGatewayBase);
        const oaiHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        };
        if (isGatewayProxy) {
          oaiHeaders['x-openclaw-scopes'] = 'operator.read,operator.write';
          if (activeModel && activeModel !== 'openclaw/default') {
            oaiHeaders['x-openclaw-model'] = activeModel;
          }
        }
        raw = await callOpenAICompatible(
          `${base}/chat/completions`,
          oaiHeaders,
          {
            model: isGatewayProxy ? 'openclaw/default' : rawModel(activeModel),
            max_tokens: maxTokens,
            temperature,
            messages: [{ role: 'system', content: systemPrompt }, ...finalMessages],
          },
          isGatewayProxy ? 'OpenClaw Gateway (openai path)' : 'OpenAI',
        );
      }

      // Strip reasoning model <think> blocks before callers try to parse JSON
      if (typeof raw === 'string') {
        const hadThinking = /<think>/i.test(raw);
        raw = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        // Handle unclosed <think> (model started thinking but never closed)
        if (/<think>/i.test(raw)) raw = raw.replace(/<think>[\s\S]*/i, '').trim();
        // Auto-disable prefill for reasoning models — prefill '{' + model's own '{' = '{{'
        if (hadThinking && !_disablePrefill) {
          _disablePrefill = true;
          console.log('[provider] reasoning model detected — prefill auto-disabled');
        }
      }
      return raw;
    },
  };
}

module.exports = {
  autoDetect,
  createLLMClient,
  findSoulPath,
  getOpenClawHome,
  readOpenClawConfig,
  readGatewayConfig,
  readAuthProfiles,
};
