# syntax=docker/dockerfile:1

# node:sqlite (встроенный SQLite) нужен без флагов — берём ту же ветку Node,
# что и локальная разработка.
FROM node:26-bookworm-slim

WORKDIR /app

# зависимости отдельным слоем — пока не меняется lock-файл, слой кэшируется
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# SQLite-база, блобы версии файлов, vault'ы пользователей, аватары — на томе
VOLUME ["/app/data", "/app/vaults", "/app/uploads"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
