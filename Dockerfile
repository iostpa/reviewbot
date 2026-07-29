FROM ghcr.io/pnpm/pnpm:11
RUN pnpm runtime set node 24 -g
RUN pnpm install -g node-gyp
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
CMD ["pnpm", "run", "server"]
