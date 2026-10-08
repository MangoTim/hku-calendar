# syntax=docker/dockerfile:1.7
# HKU ENGG Intranet demo — single combined port (api + React bundle).
# Build with oven/bun:1.3 (matches local dev), runs as bun:1.3-slim.
# Listens on $PORT (default 8093), serves /api/* + /health + static dist/.
# DB stays on 192.168.147.103 — env vars below.

ARG BUN_VERSION=1.3

# ---------- Stage 1: install + build ----------
FROM oven/bun:${BUN_VERSION} AS builder
WORKDIR /app

# Frontend deps (React, Vite, types)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Backend deps (Express, pg)
COPY server/package.json server/bun.lock ./server/
RUN cd server && bun install --frozen-lockfile

# Source + build the React bundle (vite → ./dist)
COPY . .
RUN bun run build

# ---------- Stage 2: runtime ----------
FROM oven/bun:${BUN_VERSION}-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8093 \
    DB_HOST=192.168.147.103 \
    DB_PORT=5432 \
    DB_USER=postgres \
    DB_NAME=engg_intranet

# Bundle artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/index.html ./index.html
COPY --from=builder /app/src ./src
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/vite.config.ts ./vite.config.ts

# Backup snapshots (volume-mounted in run command)
RUN mkdir -p /app/backups
VOLUME ["/app/backups"]

EXPOSE 8093

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e 'fetch("http://127.0.0.1:"+(process.env.PORT||8093)+"/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'

CMD ["bun", "run", "server/src/index.ts"]
