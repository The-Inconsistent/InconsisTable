# Build from the repo root, with a token that reads @the-inconsistent packages on GitHub Packages:
#   podman build --secret id=npm_token,env=NODE_AUTH_TOKEN -f deploy/api.Containerfile -t inconsistable-api .
FROM oven/bun:1.3.14-slim
ENV NODE_ENV=production
WORKDIR /app
COPY . .
# Frozen lockfile; only the api and the workspace packages it uses. The api runs from source: no build step.
# The token is a build secret read by .npmrc, so it never lands in a layer.
RUN --mount=type=secret,id=npm_token NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token)" bun install --frozen-lockfile --production --filter @inconsistable/api && chown -R bun:bun /app
USER bun
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["bun", "src/main.ts"]
