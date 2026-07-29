FROM ghcr.io/pnpm/pnpm:11
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
CMD ["pnpm", "run", "server"]
