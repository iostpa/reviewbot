# taken from https://depot.dev/docs/container-builds/optimal-dockerfiles/node-pnpm-dockerfile with some modifications
# syntax=docker/dockerfile:1
FROM node:lts AS build
RUN corepack enable
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app
COPY pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm fetch
COPY package.json ./
RUN pnpm approve-builds --all
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --offline
COPY . .
RUN pnpm build
FROM node:lts AS runtime
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -m -d /app -s /bin/false appuser
WORKDIR /app
COPY --from=build --chown=appuser:appgroup /app ./
ENV NODE_ENV=production \
    NODE_OPTIONS="--enable-source-maps"
USER appuser
ENTRYPOINT ["pnpm", "run", "server"]