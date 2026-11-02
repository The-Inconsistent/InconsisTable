# Build from the repo root:
#   podman build --secret id=npm_token,env=NODE_AUTH_TOKEN -f deploy/web.Containerfile -t inconsistable-web .
# The token reads @the-inconsistent packages on GitHub Packages (.npmrc); as a build secret it never lands in a layer.
# NEXT_PUBLIC_* values are baked into the client bundle at build time. Never pass NEXT_PUBLIC_DEV_HOST.
FROM oven/bun:1.3.14-slim AS build
WORKDIR /app
COPY . .
RUN --mount=type=secret,id=npm_token NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token)" bun install --frozen-lockfile
# Rewrites are fixed at build time, so API_ORIGIN is a build arg too (the compose service name by default).
ARG API_ORIGIN=http://api:4000
ENV API_ORIGIN=$API_ORIGIN
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun --filter @inconsistable/web build

FROM node:22-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
