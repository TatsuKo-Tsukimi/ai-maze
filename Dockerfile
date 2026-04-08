FROM node:22-alpine
LABEL maintainer="TatsuKo Tsukimi"
LABEL description="永久囚禁 · AI迷宫游戏"

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .

EXPOSE 3000

ENV PORT=3000
ENV HOST=0.0.0.0

# Pass your API key at runtime:
#   docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-xxx ai-maze
# Or use without AI for fallback mode:
#   docker run -p 3000:3000 ai-maze

CMD ["node", "server.js"]
