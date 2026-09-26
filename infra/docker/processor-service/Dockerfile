FROM node:24.15.0-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY packages/config/package.json packages/config/tsconfig.json packages/config/
COPY packages/contracts/package.json packages/contracts/tsconfig.json packages/contracts/
COPY packages/infrastructure/package.json packages/infrastructure/tsconfig.json packages/infrastructure/
COPY packages/observability/package.json packages/observability/tsconfig.json packages/observability/
COPY apps/processor-service/package.json apps/processor-service/tsconfig.json apps/processor-service/

RUN npm ci --workspace=@fiap-x/processor-service --include-workspace-root=true --no-audit

COPY packages/config/src packages/config/src
COPY packages/contracts/src packages/contracts/src
COPY packages/infrastructure/src packages/infrastructure/src
COPY packages/observability/src packages/observability/src
COPY apps/processor-service/src apps/processor-service/src

RUN npm run build --workspace=@fiap-x/config \
    && npm run build --workspace=@fiap-x/contracts \
    && npm run build --workspace=@fiap-x/infrastructure \
    && npm run build --workspace=@fiap-x/observability \
    && npm run build --workspace=@fiap-x/processor-service

FROM node:24.15.0-bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg \
    && ffmpeg -version \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PROCESSOR_PORT=3003 \
    VIDEO_STORAGE_ROOT=/data/videos
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/infrastructure/package.json packages/infrastructure/
COPY packages/observability/package.json packages/observability/
COPY apps/processor-service/package.json apps/processor-service/

RUN npm ci --omit=dev --workspace=@fiap-x/processor-service --include-workspace-root=false --ignore-scripts --no-audit \
    && npm cache clean --force \
    && mkdir -p /data/videos \
    && chown node:node /data/videos

COPY --from=build /app/packages/config/dist packages/config/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/infrastructure/dist packages/infrastructure/dist
COPY --from=build /app/packages/observability/dist packages/observability/dist
COPY --from=build /app/apps/processor-service/dist apps/processor-service/dist

EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3003/health/live').then(response => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

USER node
CMD ["node", "apps/processor-service/dist/main.js"]
