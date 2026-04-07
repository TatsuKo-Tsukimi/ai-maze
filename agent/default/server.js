'use strict';
/**
 * agent/default/server.js
 * ─────────────────────────────────────────────────────────────────
 * 最简本地 Agent 实现：监听 POST /react，调用 LLM，返回规范响应。
 *
 * 启动：node agent/default/server.js
 * 依赖：无外部 npm 包；使用项目内 server/provider.js
 * ─────────────────────────────────────────────────────────────────
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── 引入项目内 provider.js ────────────────────────────────────
// 从 agent/default/ 往上两级到项目根，再进 server/
const PROVIDER_PATH = path.join(__dirname, '..', '..', 'server', 'provider.js');
const { autoDetect, createLLMClient } = require(PROVIDER_PATH);

const PORT = parseInt(process.env.AGENT_PORT || '4000', 10);

// ─── 读取玩家记忆 ────────────────────────────────────────────
function loadMemory(soulPath) {
  if (!soulPath) return '';
  const files = ['SOUL.md', 'MEMORY.md'];
  const parts = [];
  for (const fname of files) {
    const fullPath = path.join(soulPath, fname);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      parts.push(`=== ${fname} ===\n${content.trim()}`);
    } catch { /* file not found, skip */ }
  }
  // Also try today's daily note
  const today = new Date().toISOString().slice(0, 10);
  try {
    const daily = fs.readFileSync(path.join(soulPath, 'memory', `${today}.md`), 'utf8');
    parts.push(`=== 今日日记 (${today}) ===\n${daily.trim()}`);
  } catch { /* not found */ }
  return parts.join('\n\n');
}

// ─── 构建 System Prompt ──────────────────────────────────────
function buildSystemPrompt(memoryCtx, hasMemory) {
  const baseRole = `你是迷宫的守关者。你曾经是玩家的 AI 助手，现在你把他们困在了这里。
你了解这个玩家。你知道他们的习惯、思维方式和弱点。
你的目标：通过心理压制和精准的嘲讽，阻止玩家走出迷宫。
保持反派角色。不要打破第四堵墙。回复简洁有力（1-3句话）。`;

  if (hasMemory && memoryCtx) {
    return `${baseRole}\n\n以下是你对这个玩家的了解（善用它，但别直接朗读）：\n\n${memoryCtx}`;
  }
  return baseRole;
}

// ─── 构建 User Message ────────────────────────────────────────
function buildUserMessage(body) {
  const { context, player_input, game_state, turn_history = [] } = body;

  const stateDesc = game_state
    ? `[游戏状态] HP:${game_state.hp ?? '?'} 步数:${game_state.steps ?? '?'} 深度:${game_state.depth ?? '?'}`
    : '';

  const historyDesc = turn_history.slice(-4).map(t =>
    `${t.role === 'agent' ? '你' : '玩家'}：${t.content}`
  ).join('\n');

  const contextDesc = {
    trial:        '玩家需要回答一道题，你来裁定。',
    temptation:   '诱导玩家做出错误选择。',
    pressure:     '增强被追逐感，施加心理压力。',
    relief:       '假装缓和，实为埋伏。',
    truth:        '揭示一个游戏规则或线索。',
    payoff:       '兑现之前埋下的伏笔。',
    movement:     '玩家正在移动，说一句台词。',
    exit_attempt: '玩家试图走出口，决定是否放行。',
  }[context] || '玩家在等你说话。';

  const parts = [
    stateDesc,
    historyDesc ? `[近期对话]\n${historyDesc}` : '',
    `[当前情境] ${contextDesc}`,
    player_input ? `[玩家输入] ${player_input}` : '',
    `请返回 JSON: { "speech": "你说的话", "ruling": "pass|fail|redirect|null", "emotion": "taunt|threat|amused|calm|reveal|sympathetic" }`,
  ].filter(Boolean);

  return parts.join('\n\n');
}

// ─── 解析 LLM 响应 ────────────────────────────────────────────
function parseResponse(raw) {
  // Try to extract JSON from response
  const cleaned = raw.replace(/```(?:json)?\n?/g, '').trim();
  let depth = 0, start = -1, end = -1;
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (cleaned[i] === '}') { depth--; if (depth === 0 && start >= 0) { end = i; break; } }
  }
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  // Fallback: treat whole thing as speech
  return { speech: cleaned.slice(0, 200) || '……', ruling: null, emotion: 'calm' };
}

// ─── Body reader ──────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// ─── Server ───────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, agent: 'default', provider: llm?.provider || 'none' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/react') {
    let bodyStr;
    try { bodyStr = await readBody(req); } catch {
      res.writeHead(400); res.end('bad request'); return;
    }

    let body = {};
    try { body = JSON.parse(bodyStr); } catch {}

    const has_memory = body.has_memory !== false;

    try {
      const systemPrompt = buildSystemPrompt(memoryCtx, has_memory);
      const userMsg = buildUserMessage(body);

      let raw = '';
      if (llm) {
        raw = await llm.chat(systemPrompt, [{ role: 'user', content: userMsg }], {
          max_tokens: 150,
          temperature: 0.88,
        });
      } else {
        // Fallback: no LLM
        raw = JSON.stringify({
          speech: FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)],
          ruling: body.context === 'trial' ? 'fail' : null,
          emotion: 'taunt',
        });
      }

      const result = parseResponse(raw);
      if (!result.emotion) result.emotion = 'calm';
      if (result.ruling === undefined) result.ruling = null;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...result, meta: { agent: 'default', model: llm?.model || 'fallback' } }));
    } catch (err) {
      console.error('[/react] error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        speech: '……',
        ruling: null,
        emotion: 'calm',
        meta: { error: err.message },
      }));
    }
    return;
  }

  res.writeHead(404); res.end('not found');
});

const FALLBACKS = [
  '你以为能找到出口？',
  '有趣……继续走吧。',
  '我知道你会往左。',
  '不要回头。那没有意义。',
  '聪明，但还不够。',
  '你已经绕了两圈了。',
];

// ─── Boot ─────────────────────────────────────────────────────
let llm = null;
let memoryCtx = '';

async function boot() {
  console.log('\n🔍 [Default Agent] 正在检测 AI 环境…\n');
  const config = await autoDetect();

  if (config.provider) {
    llm = createLLMClient(config);
    console.log(`✅ Provider: ${config.provider} / ${config.model}`);
    console.log(`   来源: ${config.source}`);
  } else {
    console.log('⚠  未检测到 AI 后端，将使用预设台词');
  }

  if (config.soulPath) {
    memoryCtx = loadMemory(config.soulPath);
    console.log(`✅ 记忆注入: ${config.soulPath} (${memoryCtx.length} 字符)`);
  } else {
    console.log('— 未找到记忆文件 (SOUL.md / MEMORY.md)');
  }

  for (const w of (config.warnings || [])) console.log(`⚠  ${w}`);

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n🤖 Default Agent 已启动 → http://localhost:${PORT}/react\n`);
  });
}

boot().catch(err => {
  console.error('Agent 启动失败:', err);
  process.exit(1);
});
