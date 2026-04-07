# AI MAZE — MCP 配置指南

> ⚠ MCP 是**可选方案之一**，不是主接入方式。
>
> 当前推荐顺序：
> 1. **内置 Agent**：直接 `node server.js`
> 2. **外部 Agent**：`AGENT_URL=http://localhost:4000 node server.js`
> 3. **MCP 模式**：用于 Claude Desktop / Claude Code 适配
>
> 如果你只是想最快跑起来，请优先用前两种。


> **⚠ 可选方案：** MCP 是 Agent 接入的可选方式之一，主要面向 Claude Desktop / Claude Code 用户。
> 推荐的默认接入方式是 HTTP `/react` 接口，详见 `design/agent-integration-v1.md` 和 `AGENT.md`。

## 快速开始

### 1. 启动游戏服务器

```bash
cd ai-maze
node server.js
```

浏览器打开 `http://localhost:3000`

### 2. 配置 Claude Desktop

编辑 Claude Desktop 配置文件：

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

添加以下内容：

```json
{
  "mcpServers": {
    "ai-maze-villain": {
      "command": "node",
      "args": ["/你的路径/ai-maze/mcp-server.js"],
      "env": {
        "AI_MAZE_PORT": "3000"
      }
    }
  }
}
```

> 把 `/你的路径/` 替换为你的实际项目路径。

### 3. 重启 Claude Desktop

重启后，Claude 会自动加载 AI Maze MCP 工具。

### 4. 开始游戏

在 Claude Desktop 中对 Claude 说：

> "来玩 AI 迷宫。你是迷宫的 Villain，我是被困的玩家。先用 get_game_state 看看我在哪里，然后开始你的游戏。"

Claude 会：
- 读取你的 SOUL.md（如果有的话）
- 查看游戏状态
- 作为 Villain 开始打卡牌、出题、说话
- 用它对你的全部记忆来制作个性化的考验

## Claude Code 用户

如果你用的是 Claude Code，可以在项目目录下运行：

```bash
claude mcp add ai-maze-villain node /你的路径/ai-maze/mcp-server.js
```

然后在 Claude Code 对话中启动游戏。

## 工作原理

```
┌──────────────┐     stdio/JSON-RPC     ┌──────────────┐
│ Claude Agent  │ ←──────────────────── │  MCP Server   │
│ (Desktop/Code)│ ────────────────────→ │ (mcp-server.js)│
│  带完整记忆    │      MCP Protocol     │               │
└──────────────┘                        └───────┬───────┘
                                                │ HTTP
                                        ┌───────┴───────┐
                                        │  Game Server   │
                                        │  (server.js)   │
                                        │  :3000         │
                                        └───────┬───────┘
                                                │ SSE/HTTP
                                        ┌───────┴───────┐
                                        │  Browser UI    │
                                        │  (玩家界面)     │
                                        └──────────────┘
```

- **Claude Agent** 在 Claude Desktop/Code 中运行，带着对玩家的完整记忆
- **MCP Server** 通过 stdio 与 Agent 通信，通过 HTTP 与游戏通信
- **Game Server** 管理游戏状态，通过 SSE 实时推送 Agent 动作到浏览器
- **Browser** 渲染迷宫，接收 Agent 的实时操控

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AI_MAZE_PORT` | `3000` | 游戏服务器端口 |
