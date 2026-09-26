FROM node:24.15.0-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY packages/config/package.json packages/config/tsconfig.json packages/config/
COPY packages/contracts/package.json packages/contracts/tsconfig.json packages/contracts/
COPY packages/infrastructure/package.json packages/infrastructure/tsconfig.json packages/infrastructure/
COPY packages/observability/package.json packages/observability/tsconfig.json packages/observability/
COPY apps/auth-service/package.json apps/auth-service/tsconfig.json apps/auth-service/

RUN npm ci --workspace=@fiap-x/auth-service --include-workspace-root=true --no-audit

COPY packages/config/src packages/config/src
COPY packages/contracts/src packages/contracts/src
COPY packages/infrastructure/src packages/infrastructure/src
COPY packages/observability/src packages/observability/src
COPY apps/auth-service/src apps/auth-service/src

RUN npm run build --workspace=@fiap-x/config \
    && npm run build --workspace=@fiap-x/contracts \
    && npm run build --workspace=@fiap-x/infrastructure \
    && npm run build --workspace=@fiap-x/observability \
    && npm run build --workspace=@fiap-x/auth-service

FROM node:24.15.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/infrastructure/package.json packages/infrastructure/
COPY packages/observability/package.json packages/observability/
COPY apps/auth-service/package.json apps/auth-service/

RUN npm ci --omit=dev --workspace=@fiap-x/auth-service --include-workspace-root=false --ignore-scripts --no-audit \
    && npm cache clean --force

COPY --from=build /app/packages/config/dist packages/config/dist
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/infrastructure/dist packages/infrastructure/dist
COPY --from=build /app/packages/observability/dist packages/observability/dist
COPY --from=build /app/apps/auth-service/dist apps/auth-service/dist

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health/live').then(response => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

USER node
CMD ["node", "apps/auth-service/dist/main.js"]
