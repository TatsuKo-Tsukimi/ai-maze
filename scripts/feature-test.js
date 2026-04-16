'use strict';
// Feature integration test — verifies all 5 new gameplay features work without crashing
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 19876;
const ROOT = path.join(__dirname, '..');
let server;
let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); }
}

function fetch(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: PORT, path: urlPath, method, headers: {} };
    if (body) {
      const data = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(opts, res => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json;
        try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function waitForServer(retries = 30) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const check = () => {
      fetch('GET', '/').then(r => {
        if (r.status === 200) resolve();
        else if (++attempt >= retries) reject(new Error('Server not ready'));
        else setTimeout(check, 1000);
      }).catch(() => {
        if (++attempt >= retries) reject(new Error('Server not reachable'));
        else setTimeout(check, 1000);
      });
    };
    setTimeout(check, 3000); // initial delay for server boot
  });
}

async function runTests() {
  console.log('\n=== ClawTrap Feature Integration Tests ===\n');

  // 1. Syntax check all frontend files
  console.log('--- Syntax Check ---');
  const jsFiles = ['js/core.js', 'js/mechanics.js', 'js/trials.js', 'js/input.js',
                   'js/overlays.js', 'js/render.js', 'js/endgame.js', 'js/audio.js'];
  for (const f of jsFiles) {
    try {
      require('child_process').execSync(`node -c "${path.join(ROOT, f)}"`, { stdio: 'pipe' });
      assert(`${f} syntax`, true);
    } catch {
      assert(`${f} syntax`, false);
    }
  }

  // 2. Server-side syntax check
  const serverFiles = ['server/routes.js', 'server/maze-agent.js', 'server/judge.js', 'server/prompts.js'];
  for (const f of serverFiles) {
    try {
      require('child_process').execSync(`node -c "${path.join(ROOT, f)}"`, { stdio: 'pipe' });
      assert(`${f} syntax`, true);
    } catch {
      assert(`${f} syntax`, false);
    }
  }

  // 3. Locale completeness check
  console.log('\n--- Locale Check ---');
  const zhKeys = ['fragment.found.title', 'trial.counterQuestion.btn', 'wallpush.btn',
                   'sudden.collapse.title', 'sudden.teleport.title', 'sudden.rewind.title',
                   'fragment.lure.speech', 'ui.status.fragments'];
  // Can't directly require client locales (registerLocale not defined), so grep
  const zhContent = require('fs').readFileSync(path.join(ROOT, 'locales/zh.js'), 'utf8');
  const enContent = require('fs').readFileSync(path.join(ROOT, 'locales/en.js'), 'utf8');
  for (const key of zhKeys) {
    assert(`zh has '${key}'`, zhContent.includes(`'${key}'`));
    assert(`en has '${key}'`, enContent.includes(`'${key}'`));
  }

  // 4. Server locales
  const serverZh = require(path.join(ROOT, 'server/locales/zh'));
  const serverEn = require(path.join(ROOT, 'server/locales/en'));
  assert('server zh has counter_question.fallback', !!serverZh['counter_question.fallback']);
  assert('server en has counter_question.fallback', !!serverEn['counter_question.fallback']);
  assert('server zh has villain.constraint.counter_question', !!serverZh['villain.constraint.counter_question']);
  assert('server en has villain.constraint.counter_question', !!serverEn['villain.constraint.counter_question']);

  // 5. Start server and test endpoints
  console.log('\n--- Server Integration ---');
  try {
    server = spawn('node', ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), NO_OPEN: '1', HOST: '127.0.0.1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    server.stderr.on('data', () => {}); // suppress
    server.stdout.on('data', () => {}); // suppress

    await waitForServer();
    assert('Server starts', true);

    // GET /
    const homeRes = await fetch('GET', '/');
    assert('GET / returns 200', homeRes.status === 200);
    assert('GET / returns HTML', homeRes.text.includes('<!DOCTYPE html>'));

    // POST /api/judge/counter-question (should work even without LLM — fallback path)
    const cqRes = await fetch('POST', '/api/judge/counter-question', {
      gameId: 'test_001',
      trial_prompt: 'What is the meaning of this maze?',
      counter_question: 'Why did you trap me here?',
      hp: 3,
      steps: 10,
    });
    assert('counter-question returns 200', cqRes.status === 200);
    assert('counter-question has player_wins field', cqRes.json && typeof cqRes.json.player_wins === 'boolean');
    assert('counter-question has villain_answer', cqRes.json && typeof cqRes.json.villain_answer === 'string');

    // POST /api/hp-event (existing endpoint, verify still works)
    const hpRes = await fetch('POST', '/api/hp-event', {
      gameId: 'test_001', cause: 'test', delta: -1, hpBefore: 3, hpAfter: 2, step: 5,
    });
    assert('hp-event still works', hpRes.status === 200);

  } catch (e) {
    assert('Server integration: ' + e.message, false);
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (server) server.kill();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  if (server) server.kill();
  process.exit(1);
});
