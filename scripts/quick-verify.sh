#!/bin/bash
# 快速验证脚本：跑 5 轮，服务器必须已在运行
set -uo pipefail
cd "$(dirname "$0")"/.."

BASE="http://127.0.0.1:3000"
ROUNDS=5
MAX_STEPS=30
LOG_BASE="test-logs"

# 复用 real-playtest.sh 的函数
source <(sed -n '/^timestamp()/,/^# ═══.*MAIN/p' scripts/real-playtest.sh | head -n -1)

rm -rf "$LOG_BASE/round-"*

for round in $(seq 1 $ROUNDS); do
  echo ""
  echo "━━━ Round $round / $ROUNDS ━━━"
  play_one_round "$round"
  sleep 1
done

echo ""
echo "=== VERIFY RESULTS ==="
for r in $(seq 1 $ROUNDS); do
  s=$(cat "$LOG_BASE/round-${r}/stats.json" 2>/dev/null)
  hp=$(echo "$s" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['finalHp'])" 2>/dev/null)
  drn=$(echo "$s" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['cards']['drain'])" 2>/dev/null)
  tri=$(echo "$s" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['trials']['total'])" 2>/dev/null)
  pss=$(echo "$s" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['trials']['pass'])" 2>/dev/null)
  fal=$(echo "$s" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['trials']['fail'])" 2>/dev/null)
  printf "R%d: HP=%s drain=%s trials=%s(pass=%s fail=%s)\n" $r "$hp" "$drn" "$tri" "$pss" "$fal"
done
