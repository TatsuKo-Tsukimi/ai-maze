#!/usr/bin/env bash
# smoke-test.sh — Minimal project health check (npm test entry point)
set -uo pipefail
cd "$(dirname "$0")/.."

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1"; }

echo "🔍 AI Maze Smoke Test"
echo "====================="

# 1. JS syntax check (all .js files)
echo ""
echo "1) JS Syntax Check"
errors=0
while IFS= read -r f; do
  if ! node --check "$f" 2>/dev/null; then
    fail "$f has syntax errors"
    errors=$((errors + 1))
  fi
done < <(find . -name '*.js' -not -path './node_modules/*' -not -path './.git/*')
if [ "$errors" -eq 0 ]; then pass "All JS files pass syntax check"; fi

# 2. Required files exist
echo ""
echo "2) Required Files"
for f in server.js index.html styles.css package.json .gitignore AGENT.md; do
  if [ -f "$f" ]; then pass "$f exists"; else fail "$f missing"; fi
done

# 3. Server modules importable
echo ""
echo "3) Server Module Import"
for mod in routes prompts llm-helpers memory trial-dedup provider session-memory villain-memory \
           file-scanner vision-cache fact-db archivist judge maze-agent; do
  if node -e "require('./server/$mod')" 2>/dev/null; then
    pass "server/$mod imports OK"
  else
    fail "server/$mod import failed"
  fi
done

# 4. Key frontend JS files exist
echo ""
echo "4) Frontend JS Files"
for f in js/core.js js/mechanics.js js/render.js js/lure-viewer.js js/overlays.js js/trials.js js/endgame.js; do
  if [ -f "$f" ]; then pass "$f exists"; else fail "$f missing"; fi
done

# 5. No secrets in tracked files
echo ""
echo "5) Secret Leak Check"
if grep -rq 'sk-[a-zA-Z0-9]\{20,\}\|ghp_[a-zA-Z0-9]\{36\}' --include='*.js' --include='*.json' --include='*.md' . 2>/dev/null; then
  fail "Possible API key found in tracked files!"
else
  pass "No API keys detected in source"
fi

# 6. lure-cache.json not tracked
echo ""
echo "6) Git Hygiene"
if git ls-files --error-unmatch lure-cache.json >/dev/null 2>&1; then
  fail "lure-cache.json is still tracked by git"
else
  pass "lure-cache.json not in git"
fi

# 7. v2 architecture check — maze-agent is the primary LLM path
echo ""
echo "7) v2 Architecture"
if grep -q "mazeAgent.sendEvent" server/routes.js; then
  pass "v2 maze-agent path active in routes"
else
  fail "v2 maze-agent path missing"
fi
if grep -q "buildEventMessage" server/maze-agent.js; then
  pass "buildEventMessage exported from maze-agent"
else
  fail "buildEventMessage missing from maze-agent"
fi
if grep -q "fallbackCard\|fallbackJudge\|getNextFixedTrial" server/routes.js; then
  pass "Static fallbacks present"
else
  fail "Static fallbacks missing"
fi
if ! grep -q "require.*agent-session" server/routes.js; then
  pass "No agent-session dependency in routes"
else
  fail "agent-session still imported in routes"
fi
# villain-memory is expected; only reject the old standalone villain module
if grep "require.*villain" server/routes.js | grep -qv "villain-memory"; then
  fail "old standalone villain module imported in routes"
else
  pass "No old villain module in routes (villain-memory OK)"
fi

# Summary
echo ""
echo "====================="
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then exit 1; fi
echo "🎉 All checks passed!"
