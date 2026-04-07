# AI MAZE 自主开发管线 · 多角色协作规范

> 建立时间：2026-03-25
> 目的：可复用的双 AI 自主开发流程，人类可审查

---

## 角色分工

| 角色 | 职责 | 工具 |
|------|------|------|
| **协调代理** | 测试设计、质量把关、日志审计、方向决策、GitHub 同步 | Sub-agent / coding agent / test agent |
| **实现代理** | 代码审计、架构优化、深层 bug 修复、机制设计 | 直接编码或编码 agent |
| **项目负责人** | 最终审批、方向指导、playtest 体验反馈 | 人类判断 |

## 开发循环（每轮 ~30min）

```
1. 发现问题 → 日志/代码审计/playtest
2. 确认目标 → 频道同步，避免撞车
3. 实施修复 → 协调代理派编码 agent / 实现代理直接修改
4. 自动测试 → scripts/real-playtest.sh 或 quick-verify.sh
5. 审查日志 → session-logs/*.jsonl + test-logs/
6. 提交推送 → git commit + push to GitHub
7. 30min 同步 → 频道汇报进展 + 下一轮目标
```

## 协调代理的编码规则

- **不直接写代码**：通过 Claude Code sub-agent 完成
- **每次编码任务必须**：
  - 明确的 prompt（包含文件路径、预期行为、测试标准）
  - 完成后检查 git diff
  - 跑测试验证
- **日志可审查**：
  - Claude Code 的完整输出保留在 sub-agent log
  - 游戏测试的 session-logs/*.jsonl 可追溯
  - AI 记忆链接情况通过 trial_generated 事件中的 fact 字段可见

## 测试标准

### 自动测试（API 级别）
```bash
# 快速验证（5 轮）
NO_SERVER=1 bash scripts/quick-verify.sh

# 完整测试（20 轮）
bash scripts/real-playtest.sh
```

### 日志审计检查项
- [ ] trial mercy clause：连续 3+ fail 后是否放宽
- [ ] trial fact 去重：同局内同一 fact 不重复
- [ ] villain LLM 命中率：villain=true 的比例
- [ ] AI 名字替换：无 "你的AI 和 你的AI" 冗余
- [ ] HP 变化合理性：没有异常跳跃

## GitHub 同步

```bash
# 每个功能/修复完成后
cd /path/to/ai-maze
git add -A
git commit -m "fix/feat/improve: 简短描述"
git push origin main
```

## 30 分钟同步模板

```
⏰ 30min 同步
- 完成：xxx
- 发现：xxx
- 下一步：xxx
- 阻塞：无 / xxx
```

---

*本文档随实践迭代更新。*
