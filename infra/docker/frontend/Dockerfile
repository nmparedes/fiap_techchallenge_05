FROM node:24.15.0-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY apps/frontend/package.json apps/frontend/tsconfig.json apps/frontend/index.html apps/frontend/

RUN npm ci --workspace=@fiap-x/frontend --include-workspace-root=true --no-audit

COPY apps/frontend/src apps/frontend/src

ARG VITE_AUTH_API_BASE_URL=http://localhost:3001
ARG VITE_VIDEO_API_BASE_URL=http://localhost:3002
ARG VITE_NOTIFICATION_API_BASE_URL=http://localhost:3004
ENV VITE_AUTH_API_BASE_URL=${VITE_AUTH_API_BASE_URL} \
    VITE_VIDEO_API_BASE_URL=${VITE_VIDEO_API_BASE_URL} \
    VITE_NOTIFICATION_API_BASE_URL=${VITE_NOTIFICATION_API_BASE_URL}

RUN npm run build --workspace=@fiap-x/frontend

FROM node:24.15.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    FRONTEND_HOST=0.0.0.0 \
    FRONTEND_PORT=8080
WORKDIR /app

COPY --from=build /app/apps/frontend/dist ./dist
COPY infra/docker/frontend/server.mjs ./server.mjs

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then(response => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

USER node
CMD ["node", "server.mjs"]
