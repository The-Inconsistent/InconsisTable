# Build from the repo root: podman build -f deploy/api.Containerfile -t inconsistable-api .
FROM oven/bun:1.3.14-slim
ENV NODE_ENV=production
WORKDIR /app
COPY . .
# Frozen lockfile; only the api and the workspace packages it uses. The api runs from source: no build step.
RUN bun install --frozen-lockfile --production --filter @inconsistable/api && chown -R bun:bun /app
USER bun
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["bun", "src/main.ts"]
