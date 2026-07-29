FROM ghcr.io/pnpm/pnpm:11
RUN pnpm runtime set node 22 -g
WORKDIR /app
COPY . .
RUN pnpm approve-builds --all
RUN pnpm install --frozen-lockfile
CMD ["pnpm", "run", "server"]