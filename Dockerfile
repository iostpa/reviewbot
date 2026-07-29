FROM ghcr.io/pnpm/pnpm:11
RUN pnpm runtime set node 26 -g
WORKDIR /app
COPY . .
RUN pnpm install
CMD ["pnpm", "run", "server"]
