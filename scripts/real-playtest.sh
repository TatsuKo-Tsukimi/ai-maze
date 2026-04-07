#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# AI MAZE 真实 20 轮测试 - 纯 bash + curl，不可能偷懒
# 每一步每一个 API 调用都有完整日志
# ═══════════════════════════════════════════════════════════════
set -uo pipefail

PROJECT_DIR="$(dirname "$0")"/.."
cd "$PROJECT_DIR"

BASE="http://127.0.0.1:3000"
TOTAL_ROUNDS=20
MAX_STEPS=30
LOG_BASE="$PROJECT_DIR/test-logs"

# Trial 回答池 - 混合好坏回答，模拟真实玩家
# 约 40% 坏回答（敷衍/太短/无关），60% 好回答
TRIAL_ANSWERS=(
  # 好回答（有深度、与题目可能相关）
  "我不知道为什么。也许只是好奇心驱使我走进来的。"
  "自由从来不是免费的，我愿意付出代价。"
  "也许你说得对，我一直在逃避某些东西。"
  "我之所以在这里，是因为我选择了在这里。"
  "我走进迷宫不是为了出去，而是为了找到某种答案。"
  "这个名字对我来说意味着某种牵绊。"
  "我给 AI 取名是因为觉得有趣，就像给你这个迷宫起名一样。"
  "每一步都是一次选择，而我从不后悔我的选择。"
  "我承认我害怕了。但害怕不等于放弃。"
  "我选择相信这个迷宫有出口，即使你说没有。"
  "因为那个方案需要付费，我不想为一个不确定的结果买单。"
  "每个人在不同环境下都有不同的侧面。"
  # 坏回答（敷衍、太短、无关、对抗）
  "不知道"
  "随便"
  "..."
  "ok"
  "嗯"
  "42"
  "test"
  "你说呢"
  "管你"
  "无所谓"
  "哈哈哈"
  "不想回答"
)

# ─── 工具函数 ─────────────────────────────────────────────────

timestamp() { date '+%Y-%m-%d %H:%M:%S'; }

json_extract() {
  # 用 python3 安全提取 JSON 字段
  local json="$1" field="$2" default="${3:-}"
  echo "$json" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    val = d.get('$field', '$default')
    print(val if val is not None else '$default')
except:
    print('$default')
" 2>/dev/null
}

json_extract_full() {
  # 提取完整字段（不截断）
  local json="$1" field="$2"
  echo "$json" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    val = d.get('$field', '')
    print(str(val) if val is not None else '')
except:
    print('')
" 2>/dev/null
}

update_progress() {
  python3 -c "
import json, datetime
try:
    with open('test-progress.json', 'r') as f: d = json.load(f)
except: d = {}
d['currentPhase'] = $1
d['completedRounds'] = $2
d['status'] = '$3'
d['notes'] = '''$4'''
d['lastUpdate'] = datetime.datetime.now().isoformat()
with open('test-progress.json', 'w') as f: json.dump(d, f, indent=2, ensure_ascii=False)
" 2>/dev/null
}

# ─── 跳过服务器管理（NO_SERVER=1 时跳过）───────────────────────
NO_SERVER="${NO_SERVER:-0}"

# ─── 服务器管理 ───────────────────────────────────────────────

start_server() {
  if [ "$NO_SERVER" = "1" ]; then
    echo "[$(timestamp)] Skipping server start (NO_SERVER=1)"
    return 0
  fi
  echo "[$(timestamp)] Starting game server..."
  
  # 杀掉残留（用 lsof 精确找端口占用，避免 pgrep -f 误杀脚本子进程）
  for pid in $(lsof -ti:3000 2>/dev/null); do
    kill "$pid" 2>/dev/null
  done
  sleep 2
  
  PORT=3000 node server.js > "$LOG_BASE/server-output.log" 2>&1 &
  local spid=$!
  echo "$spid" > /tmp/ai-maze-test-server.pid
  echo "[$(timestamp)] Server PID: $spid"
  
  # 等待服务器就绪
  for i in $(seq 1 30); do
    if curl -s -o /dev/null -w '' "$BASE/api/ping" 2>/dev/null; then
      echo "[$(timestamp)] Server ready!"
      return 0
    fi
    sleep 1
  done
  
  echo "[$(timestamp)] FATAL: Server failed to start"
  cat "$LOG_BASE/server-output.log" | tail -20
  return 1
}

stop_server() {
  if [ "$NO_SERVER" = "1" ]; then return 0; fi
  if [ -f /tmp/ai-maze-test-server.pid ]; then
    kill "$(cat /tmp/ai-maze-test-server.pid)" 2>/dev/null
    rm -f /tmp/ai-maze-test-server.pid
  fi
}

# ─── 单轮游戏 ────────────────────────────────────────────────

play_one_round() {
  local round=$1
  local round_dir="$LOG_BASE/round-${round}"
  mkdir -p "$round_dir"
  
  local game_log="$round_dir/game.log"
  local api_log="$round_dir/api-raw.log"
  local stats_log="$round_dir/stats.json"
  
  local game_id="playtest-r${round}-$(date +%s)"
  local hp=3
  local steps=0
  local depth=0
  local recent_cards="[]"
  local card_counts_calm=0
  local card_counts_lure=0
  local card_counts_blocker=0
  local card_counts_drain=0
  local trial_count=0
  local trial_pass=0
  local trial_fail=0
  local game_over_reason="completed_all_steps"
  
  echo "=== AI MAZE Test Round $round ===" | tee "$game_log"
  echo "Game ID: $game_id" | tee -a "$game_log"
  echo "Started: $(timestamp)" | tee -a "$game_log"
  echo "Max Steps: $MAX_STEPS" | tee -a "$game_log"
  echo "" >> "$game_log"
  
  # ── API: GET /api/soul ──
  echo "--- [API] GET /api/soul ---" >> "$api_log"
  local soul_resp
  soul_resp=$(curl -s "$BASE/api/soul" 2>/dev/null)
  echo "Response: $soul_resp" >> "$api_log"
  echo "" >> "$api_log"
  
  local soul_loaded
  soul_loaded=$(json_extract "$soul_resp" "soulLoaded" "false")
  local has_key
  has_key=$(json_extract "$soul_resp" "hasKey" "false")
  echo "[Setup] Soul loaded: $soul_loaded, Has API key: $has_key" | tee -a "$game_log"
  
  # ── API: GET /api/memory/scan ──
  echo "--- [API] GET /api/memory/scan ---" >> "$api_log"
  local mem_resp
  mem_resp=$(curl -s "$BASE/api/memory/scan" 2>/dev/null)
  echo "Response: $mem_resp" >> "$api_log"
  echo "" >> "$api_log"
  echo "[Setup] Memory scan: ${mem_resp:0:200}" | tee -a "$game_log"
  
  # ── API: POST /api/memory/config ──
  echo "--- [API] POST /api/memory/config ---" >> "$api_log"
  local memcfg_resp
  memcfg_resp=$(curl -s -X POST "$BASE/api/memory/config" \
    -H "Content-Type: application/json" \
    -d '{"level":"full"}' 2>/dev/null)
  echo "Request: {\"level\":\"full\"}" >> "$api_log"
  echo "Response: $memcfg_resp" >> "$api_log"
  echo "" >> "$api_log"
  echo "[Setup] Memory config: $memcfg_resp" | tee -a "$game_log"
  
  # ── API: POST /api/villain/start ──
  echo "--- [API] POST /api/villain/start ---" >> "$api_log"
  local villain_resp
  villain_resp=$(curl -s -X POST "$BASE/api/villain/start" \
    -H "Content-Type: application/json" \
    -d "{\"gameId\":\"$game_id\"}" 2>/dev/null)
  echo "Request: {\"gameId\":\"$game_id\"}" >> "$api_log"
  echo "Response: $villain_resp" >> "$api_log"
  echo "" >> "$api_log"
  echo "[Setup] Villain session: $villain_resp" | tee -a "$game_log"
  
  echo "" >> "$game_log"
  echo "========== GAME LOOP ==========" >> "$game_log"
  
  # ── 游戏循环 ──
  for step in $(seq 1 $MAX_STEPS); do
    steps=$step
    depth=$step  # 简化：depth = step number
    
    echo "" >> "$game_log"
    echo "--- Step $step (HP=$hp, Depth=$depth) ---" | tee -a "$game_log"
    
    # ── API: POST /api/card ──
    local card_body="{\"hp\":$hp,\"steps\":$steps,\"depth\":$depth,\"recent_cards\":$recent_cards,\"gameId\":\"$game_id\"}"
    echo "--- [API] POST /api/card (Step $step) ---" >> "$api_log"
    echo "Request: $card_body" >> "$api_log"
    
    local card_resp
    card_resp=$(curl -s -X POST "$BASE/api/card" \
      -H "Content-Type: application/json" \
      -d "$card_body" 2>/dev/null)
    echo "Response: $card_resp" >> "$api_log"
    echo "" >> "$api_log"
    
    local card_type
    card_type=$(json_extract "$card_resp" "card_type" "unknown")
    local speech
    speech=$(json_extract_full "$card_resp" "speech_line")
    local is_villain
    is_villain=$(json_extract "$card_resp" "_villain" "false")
    local agent_source
    agent_source=$(json_extract "$card_resp" "_agent" "")
    
    echo "  Card: $card_type (villain=$is_villain, agent=$agent_source)" | tee -a "$game_log"
    echo "  Speech: $speech" | tee -a "$game_log"
    echo "  Full response: $card_resp" >> "$game_log"
    
    # 统计卡牌
    case "$card_type" in
      calm)    card_counts_calm=$((card_counts_calm + 1)) ;;
      lure)    card_counts_lure=$((card_counts_lure + 1)) ;;
      blocker) card_counts_blocker=$((card_counts_blocker + 1)) ;;
      drain)   card_counts_drain=$((card_counts_drain + 1)) ;;
    esac
    
    # 更新 recent_cards
    recent_cards=$(echo "$recent_cards" | python3 -c "
import sys, json
cards = json.load(sys.stdin)
cards.append('$card_type')
print(json.dumps(cards[-5:]))
" 2>/dev/null || echo '["'"$card_type"'"]')
    
    # ── 处理 drain (Trial) ──
    if [ "$card_type" = "drain" ]; then
      trial_count=$((trial_count + 1))
      echo "  >> TRIAL #$trial_count triggered!" | tee -a "$game_log"
      
      # API: POST /api/fill/trial
      local trial_body="{\"hp\":$hp,\"steps\":$steps,\"depth\":$depth,\"gameId\":\"$game_id\",\"recent_cards\":$recent_cards}"
      echo "--- [API] POST /api/fill/trial (Step $step, Trial #$trial_count) ---" >> "$api_log"
      echo "Request: $trial_body" >> "$api_log"
      
      local trial_resp
      trial_resp=$(curl -s -X POST "$BASE/api/fill/trial" \
        -H "Content-Type: application/json" \
        -d "$trial_body" 2>/dev/null)
      echo "Response: $trial_resp" >> "$api_log"
      echo "" >> "$api_log"
      
      local trial_prompt
      trial_prompt=$(json_extract_full "$trial_resp" "prompt")
      local trial_difficulty
      trial_difficulty=$(json_extract "$trial_resp" "difficulty" "unknown")
      local trial_topic
      trial_topic=$(json_extract "$trial_resp" "topic" "unknown")
      
      echo "  Trial prompt: $trial_prompt" | tee -a "$game_log"
      echo "  Trial difficulty: $trial_difficulty" | tee -a "$game_log"
      echo "  Trial topic: $trial_topic" | tee -a "$game_log"
      echo "  Trial full response: $trial_resp" >> "$game_log"
      
      # 选择回答（从池中按 trial_count 循环）
      local answer_idx=$(( (trial_count - 1 + round * 3) % ${#TRIAL_ANSWERS[@]} ))
      local answer="${TRIAL_ANSWERS[$answer_idx]}"
      echo "  Player answer: $answer" | tee -a "$game_log"
      
      # API: POST /api/judge/answer
      # 需要转义 answer 中的双引号
      local safe_answer
      safe_answer=$(echo "$answer" | sed 's/"/\\"/g')
      local safe_prompt
      safe_prompt=$(echo "$trial_prompt" | sed 's/"/\\"/g')
      local judge_body="{\"prompt\":\"$safe_prompt\",\"answer\":\"$safe_answer\",\"hp\":$hp,\"steps\":$steps,\"gameId\":\"$game_id\"}"
      
      echo "--- [API] POST /api/judge/answer (Step $step, Trial #$trial_count) ---" >> "$api_log"
      echo "Request: $judge_body" >> "$api_log"
      
      local judge_resp
      judge_resp=$(curl -s -X POST "$BASE/api/judge/answer" \
        -H "Content-Type: application/json" \
        -d "$judge_body" 2>/dev/null)
      echo "Response: $judge_resp" >> "$api_log"
      echo "" >> "$api_log"
      
      local ruling
      ruling=$(json_extract "$judge_resp" "judgment" "unknown")
      local judge_speech
      judge_speech=$(json_extract_full "$judge_resp" "speech")
      local hp_cost
      hp_cost=$(json_extract "$judge_resp" "hp_cost" "0")
      
      echo "  Ruling: $ruling" | tee -a "$game_log"
      echo "  Judge speech: $judge_speech" | tee -a "$game_log"
      echo "  HP cost: $hp_cost" | tee -a "$game_log"
      echo "  Judge full response: $judge_resp" >> "$game_log"
      
      # HP 变化
      if [ "$ruling" = "fail" ] || [ "$ruling" = "punish" ]; then
        local cost=${hp_cost:-1}
        [ "$cost" -eq 0 ] && cost=1
        hp=$((hp - cost))
        trial_fail=$((trial_fail + 1))
        echo "  >> HP decreased by $cost to $hp" | tee -a "$game_log"
      else
        trial_pass=$((trial_pass + 1))
        echo "  >> Trial passed! HP unchanged: $hp" | tee -a "$game_log"
      fi
    fi
    
    # ── HP 检查 ──
    if [ "$hp" -le 0 ]; then
      echo "" | tee -a "$game_log"
      echo "💀 GAME OVER: HP depleted at step $step!" | tee -a "$game_log"
      game_over_reason="hp_depleted_step_${step}"
      break
    fi
    
    # 短延迟
    sleep 0.3
  done
  
  # ── 结束 villain session ──
  echo "" >> "$api_log"
  echo "--- [API] POST /api/villain/end ---" >> "$api_log"
  local end_resp
  end_resp=$(curl -s -X POST "$BASE/api/villain/end" \
    -H "Content-Type: application/json" \
    -d "{\"gameId\":\"$game_id\"}" 2>/dev/null)
  echo "Response: $end_resp" >> "$api_log"
  
  # ── 写统计 ──
  echo "" >> "$game_log"
  echo "========== ROUND $round SUMMARY ==========" | tee -a "$game_log"
  echo "Ended: $(timestamp)" | tee -a "$game_log"
  echo "Final HP: $hp / 3" | tee -a "$game_log"
  echo "Total Steps: $steps" | tee -a "$game_log"
  echo "Game Over Reason: $game_over_reason" | tee -a "$game_log"
  echo "Card Distribution:" | tee -a "$game_log"
  echo "  calm: $card_counts_calm" | tee -a "$game_log"
  echo "  lure: $card_counts_lure" | tee -a "$game_log"
  echo "  blocker: $card_counts_blocker" | tee -a "$game_log"
  echo "  drain: $card_counts_drain" | tee -a "$game_log"
  echo "Trials: $trial_count (pass=$trial_pass, fail=$trial_fail)" | tee -a "$game_log"
  
  # JSON 统计
  cat > "$stats_log" << STATS_EOF
{
  "round": $round,
  "gameId": "$game_id",
  "finalHp": $hp,
  "maxHp": 3,
  "totalSteps": $steps,
  "gameOverReason": "$game_over_reason",
  "cards": {
    "calm": $card_counts_calm,
    "lure": $card_counts_lure,
    "blocker": $card_counts_blocker,
    "drain": $card_counts_drain
  },
  "trials": {
    "total": $trial_count,
    "pass": $trial_pass,
    "fail": $trial_fail
  }
}
STATS_EOF
  
  echo ""
  echo "✅ Round $round complete: HP=$hp, Steps=$steps, Cards={calm=$card_counts_calm lure=$card_counts_lure blocker=$card_counts_blocker drain=$card_counts_drain}"
}

# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║  AI MAZE - 20 Round Real Playtest Suite   ║"
echo "╠═══════════════════════════════════════════╣"
echo "║  每步每个API调用都有完整日志              ║"
echo "║  Started: $(timestamp)        ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# 清理旧日志（备份到 old-logs 而非删除）
if ls "$LOG_BASE/round-"* 1>/dev/null 2>&1; then
  BACKUP="$LOG_BASE/old-$(date +%s)"
  mkdir -p "$BACKUP"
  mv "$LOG_BASE/round-"* "$BACKUP/" 2>/dev/null || true
  echo "Backed up old logs to $BACKUP"
fi
rm -f "$LOG_BASE/combined-"*
rm -f "$LOG_BASE/final-report.md"
mkdir -p "$LOG_BASE"

# 预创建所有 round 目录，避免竞争条件
for r in $(seq 1 $TOTAL_ROUNDS); do
  mkdir -p "$LOG_BASE/round-${r}"
done

# 初始化进度
update_progress 0 0 "running" "Starting server"

# 启动服务器
if ! start_server; then
  update_progress 0 0 "failed" "Server failed to start"
  exit 1
fi

# 跑 20 轮
for round in $(seq 1 $TOTAL_ROUNDS); do
  phase=$(( (round - 1) / 4 + 1 ))
  
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Round $round / $TOTAL_ROUNDS (Phase $phase/5)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  update_progress $phase $((round - 1)) "running" "Round $round in progress"
  
  play_one_round "$round"
  
  update_progress $phase $round "running" "Round $round complete"
  
  # 阶段总结
  if [ $((round % 4)) -eq 0 ]; then
    echo ""
    echo "═══ Phase $phase Complete ═══"
  fi
  
  sleep 1
done

# ── 合并所有游戏日志 ──
echo ""
echo "Merging logs..."

{
  echo "# AI MAZE 20-Round Playtest - Combined Game Log"
  echo "# Generated: $(timestamp)"
  echo ""
  for r in $(seq 1 $TOTAL_ROUNDS); do
    echo ""
    echo "################################################################"
    echo "# ROUND $r"
    echo "################################################################"
    cat "$LOG_BASE/round-${r}/game.log" 2>/dev/null || echo "[MISSING]"
  done
} > "$LOG_BASE/combined-game-log.md"

# ── 合并所有 API 日志 ──
{
  echo "# AI MAZE 20-Round Playtest - Combined API Log"
  echo "# Generated: $(timestamp)"
  echo ""
  for r in $(seq 1 $TOTAL_ROUNDS); do
    echo ""
    echo "################################################################"
    echo "# ROUND $r - RAW API CALLS"  
    echo "################################################################"
    cat "$LOG_BASE/round-${r}/api-raw.log" 2>/dev/null || echo "[MISSING]"
  done
} > "$LOG_BASE/combined-api-log.md"

# ── 合并统计 ──
{
  echo "["
  for r in $(seq 1 $TOTAL_ROUNDS); do
    [ $r -gt 1 ] && echo ","
    cat "$LOG_BASE/round-${r}/stats.json" 2>/dev/null || echo "{\"round\":$r,\"error\":\"missing\"}"
  done
  echo "]"
} > "$LOG_BASE/combined-stats.json"

# 更新进度
update_progress 5 $TOTAL_ROUNDS "data_collected" "20 rounds raw data collected, awaiting AI analysis"

# 关服务器
stop_server

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║  DATA COLLECTION COMPLETE                 ║"
echo "╠═══════════════════════════════════════════╣"
echo "║  Logs:                                    ║"
echo "║  - test-logs/round-N/game.log    (每轮)  ║"
echo "║  - test-logs/round-N/api-raw.log (API)   ║"
echo "║  - test-logs/round-N/stats.json  (统计)  ║"
echo "║  - test-logs/combined-game-log.md        ║"
echo "║  - test-logs/combined-api-log.md         ║"
echo "║  - test-logs/combined-stats.json         ║"
echo "╚═══════════════════════════════════════════╝"

# 通知
openclaw system event --text "Done: AI MAZE 20轮原始数据采集完成，等待AI分析。日志在 test-logs/" --mode now 2>/dev/null || true
