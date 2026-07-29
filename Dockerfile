FROM node:24-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"
RUN corepack enable

FROM base AS prod

COPY pnpm-lock.yaml /app
WORKDIR /app
RUN pnpm fetch --prod

COPY . /app

FROM base
COPY --from=prod /app/node_modules /app/node_modules
COPY --from=prod /app/dist /app/dist
CMD ["pnpm", "run", "server"]