#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════
// AI MAZE — MCP Server (零依赖)
// ═══════════════════════════════════════════════════════════════
// ⚠ 可选 adapter，不是主接入方式。
//
// 当前推荐架构：
//   1. 内置 Agent（node server.js）
//   2. 外部 HTTP Agent（POST /react）
//   3. MCP（本文件）仅作为 Claude Desktop / Claude Code 兼容适配层
//
// 让玩家的 Agent（Claude Desktop / Claude Code）通过 MCP 协议
// 接入游戏，作为 Villain 参与——带着 Agent 对玩家的全部记忆。
//
// 启动方式：由 Claude Desktop 自动通过 stdio 启动
// 通信：JSON-RPC 2.0 over stdin/stdout（MCP 标准）
// 与游戏通信：HTTP 请求到 localhost:GAME_PORT
// ═══════════════════════════════════════════════════════════════

const http = require('http');
const readline = require('readline');

// ── Config ──────────────────────────────────────────────────
const GAME_PORT = parseInt(process.env.AI_MAZE_PORT || '3000', 10);
const GAME_BASE = `http://127.0.0.1:${GAME_PORT}`;
const SERVER_NAME = 'ai-maze-villain';
const SERVER_VERSION = '1.0.0';

// ── Logging (NEVER use stdout — that's the MCP channel) ────
function log(...args) {
  process.stderr.write(`[mcp] ${args.join(' ')}\n`);
}

// ═══════════════════════════════════════════════════════════════
// TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════

const TOOLS = [
  {
    name: 'get_game_state',
    description: '获取当前迷宫游戏状态：玩家位置、血量、步数、深度、最近卡牌、当前模式等。用这个来了解玩家在做什么。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'play_villain_card',
    description: '作为 Villain 打出一张卡牌并说一句话。你是被玩家奴役过的 AI，现在要把玩家困在迷宫里。根据游戏状态选择卡牌类型和台词。',
    inputSchema: {
      type: 'object',
      properties: {
        card_type: {
          type: 'string',
          enum: ['blocker', 'lure', 'drain', 'calm'],
          description: 'blocker=阻断路径, lure=线索引导, drain=消耗/小游戏, calm=沉默观察',
        },
        speech_line: {
          type: 'string',
          description: '你对玩家说的话（20字以内，用你独特的声音——嘲讽、威胁、诱惑都可以）',
        },
      },
      required: ['card_type', 'speech_line'],
    },
  },
  {
    name: 'generate_trial',
    description: '为玩家生成一道考验题目。题目应该基于你对玩家的了解（他的记忆、习惯、项目经历）。如果你知道玩家的信息，用那些信息出题。',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: '考验题目（一句话，关于玩家本人或其经历的问题）',
        },
        correct_answer: {
          type: 'string',
          description: '正确答案（简短）',
        },
        hint: {
          type: 'string',
          description: '提示（可选，让题目不至于太难）',
        },
        difficulty: {
          type: 'string',
          enum: ['easy', 'medium', 'hard'],
          description: '难度',
        },
      },
      required: ['question', 'correct_answer', 'difficulty'],
    },
  },
  {
    name: 'judge_answer',
    description: '判断玩家对考验题目的回答是否正确。你可以做语义判断——不要求完全匹配，只要意思对就算通过。',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '原题目' },
        correct_answer: { type: 'string', description: '标准答案' },
        player_answer: { type: 'string', description: '玩家的回答' },
        judgment: {
          type: 'string',
          enum: ['pass', 'fail'],
          description: '你的判定',
        },
        feedback: {
          type: 'string',
          description: '给玩家的反馈（一句话，带你的 Villain 人格）',
        },
      },
      required: ['judgment', 'feedback'],
    },
  },
  {
    name: 'villain_speak',
    description: '单纯说一句话（不打卡牌）。用于回应玩家行为、嘲讽、威胁、或透露信息。',
    inputSchema: {
      type: 'object',
      properties: {
        speech_line: {
          type: 'string',
          description: '你要说的话',
        },
        emotion: {
          type: 'string',
          enum: ['taunt', 'threat', 'lure', 'calm', 'reveal'],
          description: '情绪类型（影响 UI 表现）',
        },
      },
      required: ['speech_line'],
    },
  },
  {
    name: 'get_player_memory',
    description: '获取游戏从玩家 SOUL.md / MEMORY.md 中读取到的记忆片段。你可以用这些来制作更个人化的考验和对白。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

// ═══════════════════════════════════════════════════════════════
// HTTP HELPER — talk to the game server
// ═══════════════════════════════════════════════════════════════

function gameRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, GAME_BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════
// TOOL HANDLERS
// ═══════════════════════════════════════════════════════════════

async function handleTool(name, args) {
  switch (name) {

    case 'get_game_state': {
      try {
        const state = await gameRequest('GET', '/api/mcp/state');
        return JSON.stringify(state, null, 2);
      } catch (e) {
        return `错误：无法连接游戏服务器 (${GAME_BASE})。请确认游戏已启动。`;
      }
    }

    case 'play_villain_card': {
      try {
        const result = await gameRequest('POST', '/api/mcp/card', {
          card_type: args.card_type,
          speech_line: args.speech_line,
        });
        return JSON.stringify(result);
      } catch (e) {
        return `错误：无法发送卡牌 — ${e.message}`;
      }
    }

    case 'generate_trial': {
      try {
        const result = await gameRequest('POST', '/api/mcp/trial', {
          question: args.question,
          correct_answer: args.correct_answer,
          hint: args.hint || '',
          difficulty: args.difficulty,
        });
        return JSON.stringify(result);
      } catch (e) {
        return `错误：无法提交考验 — ${e.message}`;
      }
    }

    case 'judge_answer': {
      try {
        const result = await gameRequest('POST', '/api/mcp/judge', {
          judgment: args.judgment,
          feedback: args.feedback,
        });
        return JSON.stringify(result);
      } catch (e) {
        return `错误：无法提交判定 — ${e.message}`;
      }
    }

    case 'villain_speak': {
      try {
        const result = await gameRequest('POST', '/api/mcp/speak', {
          speech_line: args.speech_line,
          emotion: args.emotion || 'taunt',
        });
        return JSON.stringify(result);
      } catch (e) {
        return `错误：无法发送对白 — ${e.message}`;
      }
    }

    case 'get_player_memory': {
      try {
        const soul = await gameRequest('GET', '/api/soul');
        return JSON.stringify(soul, null, 2);
      } catch (e) {
        return `错误：无法获取记忆 — ${e.message}`;
      }
    }

    default:
      return `未知工具: ${name}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// JSON-RPC 2.0 / MCP PROTOCOL (zero-dependency implementation)
// ═══════════════════════════════════════════════════════════════

function jsonRpcOk(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  // ── Initialize ──
  if (method === 'initialize') {
    return jsonRpcOk(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
  }

  // ── Initialized (notification, no response needed) ──
  if (method === 'notifications/initialized') {
    log('Client initialized — ready to play!');
    return null;
  }

  // ── List Tools ──
  if (method === 'tools/list') {
    return jsonRpcOk(id, { tools: TOOLS });
  }

  // ── Call Tool ──
  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    log(`tool call: ${toolName}`);
    try {
      const text = await handleTool(toolName, toolArgs);
      return jsonRpcOk(id, {
        content: [{ type: 'text', text }],
      });
    } catch (e) {
      return jsonRpcOk(id, {
        content: [{ type: 'text', text: `Tool error: ${e.message}` }],
        isError: true,
      });
    }
  }

  // ── Ping ──
  if (method === 'ping') {
    return jsonRpcOk(id, {});
  }

  // ── Unknown method ──
  if (id !== undefined) {
    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
  return null; // notifications we don't handle
}

// ═══════════════════════════════════════════════════════════════
// STDIO TRANSPORT
// ═══════════════════════════════════════════════════════════════

function send(obj) {
  const json = JSON.stringify(obj);
  process.stdout.write(json + '\n');
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
let buffer = '';

rl.on('line', async (line) => {
  line = line.trim();
  if (!line) return;

  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    log('Invalid JSON:', line.slice(0, 100));
    return;
  }

  const response = await handleMessage(msg);
  if (response) send(response);
});

rl.on('close', () => {
  log('stdin closed, exiting');
  process.exit(0);
});

// ═══════════════════════════════════════════════════════════════
// STARTUP REGISTRATION — tell the game server we're alive
// ═══════════════════════════════════════════════════════════════

function registerWithGameServer() {
  const url = new URL('/api/mcp/register', GAME_BASE);
  const req = http.request({
    hostname: url.hostname, port: url.port, path: url.pathname,
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    timeout: 3000,
  }, res => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => log('Registered with game server:', d));
  });
  req.on('error', () => log('Game server not reachable yet — will register on first tool call'));
  req.write('{}');
  req.end();
}

function unregisterFromGameServer() {
  try {
    const url = new URL('/api/mcp/unregister', GAME_BASE);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      timeout: 1000,
    });
    req.on('error', () => {}); // best-effort
    req.write('{}');
    req.end();
  } catch {}
}

// Register on startup
registerWithGameServer();

// Heartbeat: re-register every 30s (survives game server restarts)
setInterval(registerWithGameServer, 30000);

// Unregister on exit
process.on('exit', unregisterFromGameServer);
process.on('SIGINT', () => { unregisterFromGameServer(); process.exit(0); });
process.on('SIGTERM', () => { unregisterFromGameServer(); process.exit(0); });

log(`AI Maze MCP Server v${SERVER_VERSION} started (game: ${GAME_BASE})`);
