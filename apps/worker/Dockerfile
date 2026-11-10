# apps/worker image. Build context: the repo root (infra/local/docker-compose.yml does this).
#   docker build -f apps/worker/Dockerfile -t btb-worker:local .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @btb/worker... --ignore-scripts
COPY packages/contracts packages/contracts
COPY packages/core packages/core
COPY apps/worker apps/worker
RUN pnpm --filter @btb/worker build

FROM node:22-alpine
# Recorded on every run it starts (M6.2); CI passes the commit.
ARG BTB_VERSION=dev
ENV NODE_ENV=production BTB_VERSION=$BTB_VERSION
WORKDIR /app
COPY --from=build /repo/apps/worker/dist ./
# uid 1000, so a mounted kubeconfig owned by the host user (mode 600) stays readable.
USER node
CMD ["node", "--enable-source-maps", "main.mjs"]
