# agent/default — 默认 Agent 参考实现

这是最简单的本地 Agent 实现，供快速上手和自定义参考。

## 功能

- 实现 `POST /react` endpoint（见 `AGENT.md` 接口规范）
- 使用 `server/provider.js` 的 `autoDetect()` 自动检测 LLM 后端
- 读取 `~/.openclaw/workspace/MEMORY.md` + `SOUL.md` 作为记忆注入
- 返回符合规范的 `{ speech, ruling, emotion, meta }` JSON

## 启动

```bash
cd agent/default
node server.js
# 默认监听 :4000
```

然后启动主游戏服务器，指向此 Agent：

```bash
AGENT_URL=http://localhost:4000 node server.js
```

## 自定义

复制 `agent/default/server.js` 到你自己的目录，修改 `buildPrompt()` 和 `parseResponse()` 函数即可。

Agent 可以用任何语言实现，只要能响应 `POST /react` 并返回正确格式的 JSON。

## 依赖

无外部 npm 依赖，使用 Node.js 原生模块 + 项目内 `server/provider.js`。
