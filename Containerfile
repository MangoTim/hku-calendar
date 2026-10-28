# syntax=docker/dockerfile:1.7
# HKU ENGG Intranet demo — single combined port (api + React bundle).
# Build with oven/bun:1.3 (matches local dev), runtime on oven/bun:1.3-alpine.
# Listens on $PORT (default 8093), serves /api/* + /health + static dist/.
# DB stays on 192.168.147.103 — env vars below.

ARG BUN_VERSION=1.3

# ---------- Stage 1: install + build ----------
# The builder stays on the Debian variant on purpose: vite's toolchain
# (lightningcss, rolldown, esbuild) ships platform-native binaries and glibc
# is what they are built against here. Nothing built in this stage is
# executed at runtime, so the builder base can differ from the runtime base.
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
# Alpine, not the Debian slim variant. The Debian base inherited 100
# HIGH/CRITICAL CVEs (3 of them CRITICAL, all in perl-base) from
# oven/bun:1.3-slim, and the client sees every one of them in the Aqua
# console. The alpine base carries 4 HIGH / 0 CRITICAL instead.
# Nothing here is a glibc binary: the shipped code is the vite bundle plus
# pure-JS server deps (cors, express, jose, nodemailer, pg), so musl is safe.
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
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

# Run as the image's non-root 'bun' user (uid 1000). Aqua's `root_user`
# assurance control flags a root-running image as Non-compliant, which fails
# the CI gate on "Image Is Compliant".
#
# NOTE for the rootless deployment on 192.168.147.105 (user `rhai`): the
# container process now runs as uid 1000, which rootless podman maps to a
# subuid — NOT to rhai's own uid. The bind-mounted backups directory must
# therefore be writable by it:
#     chmod 0777 /home/rhai/hku-intranet/backups
# or run with `--userns=keep-id:uid=1000,gid=1000` so the process maps back
# to rhai.
RUN chown -R bun:bun /app
VOLUME ["/app/backups"]

EXPOSE 8093

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e 'fetch("http://127.0.0.1:"+(process.env.PORT||8093)+"/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'

USER bun

CMD ["bun", "run", "server/src/index.ts"]
