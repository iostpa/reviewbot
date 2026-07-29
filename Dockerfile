FROM node:24-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"
RUN corepack enable

FROM base AS prod

WORKDIR /app
COPY pnpm-lock.yaml ./
RUN pnpm fetch --prod

COPY . .

FROM base
COPY --from=prod /app/node_modules ./node_modules
COPY --from=prod /app/src ./src
CMD ["node", "src"]