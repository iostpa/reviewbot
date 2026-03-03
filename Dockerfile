FROM oven/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install
COPY . .
CMD ["bun", "run", "server"]