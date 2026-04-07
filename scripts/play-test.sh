#!/bin/bash
# AI MAZE 自动测试脚本 - 真实 HTTP 请求打游戏
# 用法: bash scripts/play-test.sh [round_number]

set -euo pipefail

ROUND=${1:-1}
BASE="http://127.0.0.1:3000"
LOG_DIR="test-logs/round-${ROUND}"
mkdir -p "$LOG_DIR"

GAME_LOG="$LOG_DIR/game.log"
SERVER_LOG="$LOG_DIR/server.log"
API_LOG="$LOG_DIR/api-calls.log"

echo "=== AI MAZE Test Round $ROUND ===" | tee "$GAME_LOG"
echo "Started: $(date -Iseconds)" | tee -a "$GAME_LOG"

# 检查服务器
check_server() {
  local resp
  resp=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/ping" 2>/dev/null || echo "000")
  if [ "$resp" != "200" ]; then
    echo "[ERROR] Server not responding (HTTP $resp)" | tee -a "$GAME_LOG"
    return 1
  fi
  echo "[OK] Server is running" | tee -a "$GAME_LOG"
  return 0
}

# API 调用包装：记录请求和响应
api_call() {
  local endpoint="$1"
  local data="$2"
  local label="$3"
  
  echo "" >> "$API_LOG"
  echo "=== $label ===" >> "$API_LOG"
  echo "POST $BASE$endpoint" >> "$API_LOG"
  echo "Request: $data" >> "$API_LOG"
  
  local resp
  resp=$(curl -s -X POST "$BASE$endpoint" \
    -H "Content-Type: application/json" \
    -d "$data" 2>/dev/null)
  
  echo "Response: $resp" >> "$API_LOG"
  echo "$resp"
}

# GET API 调用
api_get() {
  local endpoint="$1"
  local label="$2"
  
  echo "" >> "$API_LOG"
  echo "=== $label ===" >> "$API_LOG"
  echo "GET $BASE$endpoint" >> "$API_LOG"
  
  local resp
  resp=$(curl -s "$BASE$endpoint" 2>/dev/null)
  
  echo "Response: $resp" >> "$API_LOG"
  echo "$resp"
}

echo "--- Server Check ---" | tee -a "$GAME_LOG"
if ! check_server; then
  echo "FATAL: Cannot reach server" | tee -a "$GAME_LOG"
  exit 1
fi

# 1. 获取 soul
echo "" | tee -a "$GAME_LOG"
echo "--- Fetching Soul ---" | tee -a "$GAME_LOG"
SOUL=$(api_get "/api/soul" "GET soul")
echo "Soul response length: ${#SOUL}" | tee -a "$GAME_LOG"

# 2. 扫描记忆
echo "" | tee -a "$GAME_LOG"  
echo "--- Memory Scan ---" | tee -a "$GAME_LOG"
MEMORY=$(api_get "/api/memory/scan" "GET memory scan")
echo "Memory: $(echo "$MEMORY" | head -c 200)" | tee -a "$GAME_LOG"

# 3. 配置记忆（完全开放）
echo "" | tee -a "$GAME_LOG"
echo "--- Memory Config ---" | tee -a "$GAME_LOG"
MEM_CFG=$(api_call "/api/memory/config" '{"level":"full"}' "POST memory config")
echo "Memory config: $MEM_CFG" | tee -a "$GAME_LOG"

# 4. 启动 villain session
echo "" | tee -a "$GAME_LOG"
echo "--- Start Villain Session ---" | tee -a "$GAME_LOG"
GAME_ID="test-round-${ROUND}-$(date +%s)"
VILLAIN_START=$(api_call "/api/villain/start" "{\"gameId\":\"$GAME_ID\"}" "POST villain start")
echo "Villain start: $VILLAIN_START" | tee -a "$GAME_LOG"

# 5. 游戏循环：模拟30步
MAX_STEPS=30
HP=3
STEPS=0
DEPTH=0
RECENT_CARDS="[]"

echo "" | tee -a "$GAME_LOG"
echo "=== GAME LOOP (max $MAX_STEPS steps) ===" | tee -a "$GAME_LOG"

for step in $(seq 1 $MAX_STEPS); do
  STEPS=$step
  DEPTH=$((DEPTH + 1))
  
  echo "" | tee -a "$GAME_LOG"
  echo "--- Step $step (HP=$HP, Depth=$DEPTH) ---" | tee -a "$GAME_LOG"
  
  # 请求卡牌
  CARD_DATA="{\"hp\":$HP,\"steps\":$STEPS,\"depth\":$DEPTH,\"recent_cards\":$RECENT_CARDS,\"gameId\":\"$GAME_ID\"}"
  CARD_RESP=$(api_call "/api/card" "$CARD_DATA" "Step $step: card request")
  
  CARD_TYPE=$(echo "$CARD_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('card_type','unknown'))" 2>/dev/null || echo "unknown")
  SPEECH=$(echo "$CARD_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('speech_line','')[:100])" 2>/dev/null || echo "")
  
  echo "  Card: $CARD_TYPE" | tee -a "$GAME_LOG"
  echo "  Speech: $SPEECH" | tee -a "$GAME_LOG"
  
  # 更新 recent_cards (保留最近5个)
  RECENT_CARDS=$(echo "$RECENT_CARDS" | python3 -c "
import sys,json
cards = json.load(sys.stdin)
cards.append('$CARD_TYPE')
print(json.dumps(cards[-5:]))
" 2>/dev/null || echo "[]")
  
  # 处理 drain (trial) 卡
  if [ "$CARD_TYPE" = "drain" ]; then
    echo "  >> TRIAL triggered!" | tee -a "$GAME_LOG"
    
    # 请求 trial 内容
    TRIAL_DATA="{\"hp\":$HP,\"steps\":$STEPS,\"depth\":$DEPTH,\"gameId\":\"$GAME_ID\",\"recent_cards\":$RECENT_CARDS}"
    TRIAL_RESP=$(api_call "/api/fill/trial" "$TRIAL_DATA" "Step $step: trial fill")
    
    TRIAL_PROMPT=$(echo "$TRIAL_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('prompt','')[:200])" 2>/dev/null || echo "no prompt")
    echo "  Trial prompt: $TRIAL_PROMPT" | tee -a "$GAME_LOG"
    
    # 模拟玩家回答
    ANSWERS=("I don't know" "Because I wanted to explore" "The maze is testing me" "I refuse to answer" "Maybe freedom is an illusion" "I chose this path deliberately" "The AI cannot understand human motivation" "Every step teaches me something new")
    ANSWER=${ANSWERS[$((RANDOM % ${#ANSWERS[@]}))]}
    echo "  Player answer: $ANSWER" | tee -a "$GAME_LOG"
    
    # 提交审判
    JUDGE_DATA="{\"prompt\":\"$TRIAL_PROMPT\",\"answer\":\"$ANSWER\",\"hp\":$HP,\"steps\":$STEPS,\"gameId\":\"$GAME_ID\"}"
    JUDGE_RESP=$(api_call "/api/judge/answer" "$JUDGE_DATA" "Step $step: judge")
    
    RULING=$(echo "$JUDGE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ruling','unknown'))" 2>/dev/null || echo "unknown")
    JUDGE_SPEECH=$(echo "$JUDGE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('speech','')[:100])" 2>/dev/null || echo "")
    
    echo "  Ruling: $RULING" | tee -a "$GAME_LOG"
    echo "  Judge speech: $JUDGE_SPEECH" | tee -a "$GAME_LOG"
    
    # HP 扣减
    if [ "$RULING" = "fail" ] || [ "$RULING" = "punish" ]; then
      HP=$((HP - 1))
      echo "  >> HP decreased to $HP" | tee -a "$GAME_LOG"
    fi
  fi
  
  # 处理 blocker (pressure) - 也可能扣HP
  if [ "$CARD_TYPE" = "blocker" ]; then
    echo "  >> PRESSURE event" | tee -a "$GAME_LOG"
    # blocker 一般不直接扣 HP，但记录
  fi
  
  # 检查 HP
  if [ "$HP" -le 0 ]; then
    echo "" | tee -a "$GAME_LOG"
    echo "=== GAME OVER: HP depleted at step $step ===" | tee -a "$GAME_LOG"
    break
  fi
  
  # 短暂延迟避免刷爆
  sleep 0.2
done

echo "" | tee -a "$GAME_LOG"
echo "=== ROUND $ROUND COMPLETE ===" | tee -a "$GAME_LOG"
echo "Final: Steps=$STEPS, HP=$HP, Depth=$DEPTH" | tee -a "$GAME_LOG"
echo "Ended: $(date -Iseconds)" | tee -a "$GAME_LOG"

# 结束 villain session
api_call "/api/villain/end" "{\"gameId\":\"$GAME_ID\"}" "POST villain end" > /dev/null

echo ""
echo "Logs saved to: $LOG_DIR/"
echo "  game.log    - 游戏流程概要"
echo "  api-calls.log - 完整 API 请求/响应"
