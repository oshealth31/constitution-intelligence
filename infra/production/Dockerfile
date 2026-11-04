# syntax=docker/dockerfile:1.7
# Production images for Constitution Intelligence. One file, two targets:
#   docker build -f infra/production/Dockerfile --target api -t constitution-api:<git-sha> .
#   docker build -f infra/production/Dockerfile --target web -t constitution-web:<git-sha> \
#     --build-arg API_INTERNAL_URL=http://api:4000 .
# Both run as the unprivileged "node" user, contain no secrets and no development tools,
# and are configured entirely by environment variables and mounted secret files.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# ---- Build everything once -----------------------------------------------------------------
FROM base AS build
# Where the web app forwards /api/v1/* (fixed when the web app is built).
ARG API_INTERNAL_URL=http://api:4000
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:packages \
 && pnpm --filter @constitution/api run build \
 && API_INTERNAL_URL="$API_INTERNAL_URL" pnpm --filter @constitution/web run build
# Standalone folders with production dependencies only.
RUN pnpm --filter @constitution/api deploy --prod --legacy /out/api \
 && rm -rf /out/api/dist && cp -r apps/api/dist /out/api/dist \
 && rm -rf /out/api/data && cp -r apps/api/data /out/api/data \
 && pnpm --filter @constitution/web deploy --prod --legacy /out/web \
 && rm -rf /out/web/.next && cp -r apps/web/.next /out/web/.next \
 && rm -rf /out/web/.next/cache

# ---- API -----------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4000 \
    STORAGE_LOCAL_DIR=/var/lib/constitution/storage
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
RUN mkdir -p /var/lib/constitution/storage && chown node:node /var/lib/constitution/storage
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations run separately, with the migration account (constitution_migrator):  node dist/cli/migrate.js
CMD ["node", "dist/main.js"]

# ---- Web -----------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /out/web ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]

# ---- Operations: backups, restores, exports ------------------------------------------------
# PostgreSQL 16 client tools (same major version as the server) plus gpg for encryption.
FROM pgvector/pgvector:pg16 AS ops
RUN apt-get update \
 && apt-get install -y --no-install-recommends gnupg \
 && rm -rf /var/lib/apt/lists/*
COPY ops/backup.sh ops/restore.sh ops/export-organisation.sh /ops/
RUN chmod 0755 /ops/*.sh
ENTRYPOINT []
CMD ["/ops/backup.sh"]
