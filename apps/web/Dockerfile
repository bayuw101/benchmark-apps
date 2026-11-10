# apps/web image (Next standalone server). Build context: the repo root.
#   docker build -f apps/web/Dockerfile -t btb-web:local .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @btb/web... --ignore-scripts
COPY packages/contracts packages/contracts
COPY packages/core packages/core
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_STANDALONE=1
RUN pnpm --filter @btb/web build

FROM node:22-alpine
# Recorded on every run it creates (M6.2); CI passes the commit.
ARG BTB_VERSION=dev
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 BTB_VERSION=$BTB_VERSION
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
