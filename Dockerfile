FROM oven/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
CMD ["bun", "run", "server"]