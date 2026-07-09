FROM oven/bun:1.3.14-alpine AS build
WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN bun install --frozen-lockfile
RUN bun run --cwd apps/web build
RUN bun run --cwd apps/server build

FROM oven/bun:1.3.14-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["bun", "apps/server/src/server.ts"]
