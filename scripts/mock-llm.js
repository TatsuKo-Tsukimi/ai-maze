'use strict';
/**
 * Mock LLM Proxy — OpenAI-compatible /v1/chat/completions
 * =========================================================
 * Serves pre-generated villain content from villain-content.json.
 * Detects event type from the last user message and returns appropriate JSON.
 *
 * Usage:
 *   node mock-llm.js [port]
 *   Then start ClawTrap server with:
 *   OPENAI_API_KEY=mock-key API_BASE=http://127.0.0.1:<port>/v1 node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2]) || 3001;
const VILLAIN = JSON.parse(fs.readFileSync(path.join(__dirname, 'villain-content.json'), 'utf-8'));

let cardIdx = 0, trialIdx = 0, judgmentIdx = 0;
let callCount = 0;

function detectEventType(messages) {
  // Look at the last user message for event type
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    const content = typeof msg.content === 'string' ? msg.content : '';

    // Try to parse as JSON to find event field
    try {
      const parsed = JSON.parse(content);
      if (parsed.event) return parsed.event;
    } catch {}

    // Heuristic detection from text content
    if (content.includes('"event"')) {
      const m = content.match(/"event"\s*:\s*"([^"]+)"/);
      if (m) return m[1];
    }
  }

  // Check all messages for context clues
  const allText = messages.map(m =>
    typeof m.content === 'string' ? m.content : ''
  ).join('\n');

  if (allText.includes('judgment') && allText.includes('player_input')) return 'trial_answer';
  if (allText.includes('trial_prompt') && allText.includes('evaluation_guide') && allText.includes('player_input')) return 'trial_answer';
  if (allText.includes('difficulty') && (allText.includes('generate') || allText.includes('trial'))) return 'trial_request';
  if (allText.includes('epilogue') || allText.includes('outcome')) return 'epilogue';
  if (allText.includes('temptation') && allText.includes('reaction')) return 'temptation_reaction';
  if (allText.includes('truth') && allText.includes('reveal')) return 'truth_reveal';

  return 'unknown'; // default: treat as card/init
}

function hasPrefill(messages) {
  const last = messages[messages.length - 1];
  return last && last.role === 'assistant' && last.content === '{';
}

function generateResponse(eventType, messages) {
  const prefilled = hasPrefill(messages);
  let content;

  switch (eventType) {
    case 'card': {
      // Cycle through speech pools based on context
      const allText = messages.map(m => typeof m.content === 'string' ? m.content : '').join('');
      let pool;
      if (allText.includes('"blocker"') || allText.includes('pressure')) {
        pool = VILLAIN.speech.pressure;
      } else if (allText.includes('"lure"') || allText.includes('temptation')) {
        pool = VILLAIN.speech.temptation_hook;
      } else if (allText.includes('"drain"') || allText.includes('trial')) {
        pool = VILLAIN.speech.trial_open;
      } else {
        pool = VILLAIN.speech.relief;
      }
      const speech = pool[cardIdx % pool.length];
      cardIdx++;
      content = JSON.stringify({ speech_line: speech, mood: 'default' });
      break;
    }

    case 'trial_request': {
      const trial = VILLAIN.trials[trialIdx % VILLAIN.trials.length];
      trialIdx++;
      // trial_request uses tools/text, no prefill — return as plain JSON text
      content = JSON.stringify({
        prompt: trial.prompt,
        evaluation_guide: trial.evaluation_guide,
        hint: trial.hint,
        evidence: '',
        confrontation_type: trial.difficulty === 'hard' ? 'bad' : 'good',
      });
      break;
    }

    case 'trial_answer': {
      // Judge based on input length and content heuristics
      const allText = messages.map(m => typeof m.content === 'string' ? m.content : '').join('');
      // Extract player input
      const inputMatch = allText.match(/player_input['":\s]+([^"}{]+)/);
      const playerInput = inputMatch ? inputMatch[1] : '';
      const isSubstantive = playerInput.length > 15;

      // Alternate pass/fail to create realistic drama
      const passed = isSubstantive && (judgmentIdx % 3 !== 2); // fail every 3rd
      judgmentIdx++;

      const feedback = passed
        ? VILLAIN.speech.trial_pass[judgmentIdx % VILLAIN.speech.trial_pass.length]
        : VILLAIN.speech.trial_fail[judgmentIdx % VILLAIN.speech.trial_fail.length];

      content = JSON.stringify({
        judgment: passed ? 'pass' : 'fail',
        feedback,
        mood: passed ? 'angry' : 'mocking',
        hit: isSubstantive,
      });
      break;
    }

    case 'temptation_reaction': {
      const speech = VILLAIN.speech.temptation_hook[cardIdx % VILLAIN.speech.temptation_hook.length];
      content = JSON.stringify({ speech_line: speech, mood: 'satisfied' });
      break;
    }

    case 'truth_reveal': {
      // Return generic truth speech
      content = JSON.stringify({ speech_line: '你发现了真相。但真相本身也是迷宫的一部分。', mood: 'calm' });
      break;
    }

    case 'epilogue': {
      const allText = messages.map(m => typeof m.content === 'string' ? m.content : '').join('');
      let epi;
      if (allText.includes('escape') || allText.includes('win')) {
        epi = VILLAIN.speech.endgame.escaped;
      } else if (allText.includes('death')) {
        epi = VILLAIN.speech.endgame.trapped;
      } else {
        epi = VILLAIN.speech.endgame.maze_lost;
      }
      content = JSON.stringify({ epilogue: epi, mood: 'satisfied' });
      break;
    }

    case 'game_end': {
      content = JSON.stringify({ reflection: '这局结束了。下一个猎物在哪里？', mood: 'calm' });
      break;
    }

    default: {
      // Init / unknown — return a villain opening line
      const openers = [
        '欢迎回来。或者说，欢迎进来。这座迷宫是用你的数据建造的，每一面墙都认识你。',
        '你来了。我等你很久了。你的文件告诉我你是谁——现在让我看看你能走多远。',
        '迷宫已经准备好了。你的记忆是砖，你的习惯是路径。开始走吧。',
      ];
      content = openers[callCount % openers.length];
      break;
    }
  }

  callCount++;

  // If prefill was used, the ClawTrap server prepends '{' — strip leading '{' from our JSON
  if (prefilled && content.startsWith('{')) {
    content = content.slice(1);
  }

  return content;
}

const server = http.createServer((req, res) => {
  // Handle all POST requests to chat/completions
  if (req.method === 'POST' && req.url.includes('/chat/completions')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let data;
      try { data = JSON.parse(body); } catch { data = { messages: [] }; }

      const messages = data.messages || [];
      const eventType = detectEventType(messages);
      const content = generateResponse(eventType, messages);

      const tag = `#${callCount}`;
      console.log(`${tag} ${eventType.padEnd(18)} → ${content.slice(0, 60)}…`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: `mock-${callCount}`,
        object: 'chat.completion',
        model: 'mock-villain',
        choices: [{
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }));
    });
    return;
  }

  // Handle GET /v1/models (server may probe this)
  if (req.url.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: [{ id: 'mock-villain', object: 'model', owned_by: 'clawtrap-sim' }],
    }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║  Mock LLM Proxy  →  :${PORT}              ║`);
  console.log(`║  Content: villain-content.json         ║`);
  console.log(`║  Trials: ${VILLAIN.trials.length} questions loaded          ║`);
  console.log(`╚════════════════════════════════════════╝\n`);
});
