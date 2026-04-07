#!/bin/bash
# AI MAZE 自动化 playtest — 记录 trial/lure/evidence 实际效果
# 用法: bash scripts/playtest.sh

BASE="http://localhost:3000"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="/tmp/ai-maze-playtest-$(date +%Y%m%d-%H%M%S).log"

echo "=== AI MAZE Playtest ===" | tee "$LOG"
echo "Time: $(date)" | tee -a "$LOG"
echo "" | tee -a "$LOG"

# Helper: pretty print JSON
jp() { python3 -m json.tool 2>/dev/null || cat; }

# 1. Start villain session (MUST be called first to create v2 session)
echo "--- [1] Starting villain session ---" | tee -a "$LOG"
START=$(curl -s "$BASE/api/villain/start" -X POST -H "Content-Type: application/json" \
  -d '{"playerId":"playtest"}')
echo "$START" | jp | tee -a "$LOG"
GAME_ID=$(echo "$START" | python3 -c "import sys,json; print(json.load(sys.stdin).get('gameId',''))" 2>/dev/null)
echo "Game ID: $GAME_ID" | tee -a "$LOG"
echo "" | tee -a "$LOG"
sleep 2

# 2. Get opening card
echo "--- [2] Opening card ---" | tee -a "$LOG"
curl -s "$BASE/api/card" -X POST -H "Content-Type: application/json" \
  -d "{\"gameId\":\"$GAME_ID\",\"steps\":1,\"hp\":3,\"forced_role\":\"relief\"}" | jp | tee -a "$LOG"
echo "" | tee -a "$LOG"
sleep 2

# 3. A few more cards
for step in 3 5; do
  echo "--- [3] Card at step $step ---" | tee -a "$LOG"
  curl -s "$BASE/api/card" -X POST -H "Content-Type: application/json" \
    -d "{\"gameId\":\"$GAME_ID\",\"steps\":$step,\"hp\":3,\"forced_role\":\"temptation\"}" | jp | tee -a "$LOG"
  echo "" | tee -a "$LOG"
  sleep 2
done

# 4. Request trials and log evidence
for trial_num in 1 2 3; do
  echo "==============================" | tee -a "$LOG"
  echo "--- [4] Trial #$trial_num request ---" | tee -a "$LOG"
  TRIAL=$(curl -s "$BASE/api/fill/trial" -X POST -H "Content-Type: application/json" \
    -d "{\"gameId\":\"$GAME_ID\",\"steps\":$((trial_num * 5 + 5)),\"hp\":3,\"difficulty\":\"medium\",\"trial_number\":$trial_num}")
  echo "$TRIAL" | jp | tee -a "$LOG"
  echo "" | tee -a "$LOG"
  
  # Extract fields
  PROMPT=$(echo "$TRIAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('prompt',''))" 2>/dev/null)
  EVIDENCE=$(echo "$TRIAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('evidence',''))" 2>/dev/null)
  SOURCE=$(echo "$TRIAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('_source',''))" 2>/dev/null)
  EVAL=$(echo "$TRIAL" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('evaluation_guide',''))" 2>/dev/null)
  
  echo "  📋 PROMPT: $PROMPT" | tee -a "$LOG"
  echo "  🔍 EVIDENCE: $EVIDENCE" | tee -a "$LOG"
  echo "  📏 EVAL: $EVAL" | tee -a "$LOG"
  echo "  🏷️ SOURCE: $SOURCE" | tee -a "$LOG"
  echo "" | tee -a "$LOG"
  
  # Submit a thoughtful answer
  ANSWER="我不太记得具体细节了，但这件事确实让我思考了很久。每次面对类似的选择我都会犹豫，因为我不确定自己的判断是否正确。"
  echo "--- [4b] Submitting answer for trial #$trial_num ---" | tee -a "$LOG"
  echo "  Answer: $ANSWER" | tee -a "$LOG"
  JUDGE=$(curl -s "$BASE/api/judge/answer" -X POST -H "Content-Type: application/json" \
    -d "{\"gameId\":\"$GAME_ID\",\"trial_prompt\":$(echo "$PROMPT" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().strip()))'),\"player_input\":\"$ANSWER\",\"steps\":$((trial_num * 5 + 5)),\"hp\":3,\"fail_count\":0,\"trial_number\":$trial_num}")
  echo "$JUDGE" | jp | tee -a "$LOG"
  
  # Extract judgment details
  JUDGMENT=$(echo "$JUDGE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'judgment={d.get(\"judgment\",\"\")}, hit={d.get(\"hit\",\"\")}, feedback={d.get(\"feedback\",\"\")}, agent={d.get(\"_agent\",\"fallback\")}')" 2>/dev/null)
  echo "  ⚖️ $JUDGMENT" | tee -a "$LOG"
  echo "" | tee -a "$LOG"
  sleep 3
done

# 5. Check fact-db state
echo "==============================" | tee -a "$LOG"
echo "--- [5] fact-db state check ---" | tee -a "$LOG"
cd "$ROOT_DIR"
node -e "
const db = JSON.parse(require('fs').readFileSync('./data/fact-db.json','utf8'));
const withUse = db.chunks.filter(c => c.useCount > 0);
const withHit = db.chunks.filter(c => (c.hitCount||0) > 0);
const withMiss = db.chunks.filter(c => (c.missCount||0) > 0);
console.log('globalCallCounter:', db.globalCallCounter);
console.log('Chunks with useCount > 0:', withUse.length);
console.log('Chunks with hitCount > 0:', withHit.length);  
console.log('Chunks with missCount > 0:', withMiss.length);
if (withUse.length > 0) {
  console.log('Sample used:');
  withUse.slice(0,5).forEach(c => console.log('  '+c.id, 'use='+c.useCount, 'hit='+(c.hitCount||0), 'miss='+(c.missCount||0)));
}
" | tee -a "$LOG"

# 6. Check server logs for errors
echo "" | tee -a "$LOG"
echo "--- [6] Server logs (relevant) ---" | tee -a "$LOG"
grep -i "maze-agent\|trial\|v2\|error\|warn\|fact-db\|session.*start" /tmp/ai-maze-server.log | tail -30 | tee -a "$LOG"

echo "" | tee -a "$LOG"
echo "=== Playtest complete ===" | tee -a "$LOG"
echo "Full log: $LOG"
