FROM node:22-alpine
LABEL maintainer="TatsuKo Tsukimi"
LABEL description="永久囚禁 · AI迷宫游戏"

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

EXPOSE 3000

ENV PORT=3000
# HOST=0.0.0.0 is required for `docker run -p` port mapping. The container is
# isolated; what matters is which *host* interface you publish to.
# RECOMMENDED: bind the host port to loopback only — this game has no auth,
# serves your scanned workspace content, and spends LLM credits. Don't expose
# it to the LAN unless you know what you're doing.
ENV HOST=0.0.0.0

# Pass your API key at runtime. Bind to loopback on the host:
#   docker run -p 127.0.0.1:3000:3000 -e ANTHROPIC_API_KEY=sk-ant-xxx clawtrap
# Fallback mode (no LLM):
#   docker run -p 127.0.0.1:3000:3000 clawtrap

CMD ["node", "server.js"]
