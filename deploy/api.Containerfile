# syntax=docker/dockerfile:1
# Build from the repo root, with a token that can read The-Inconsistent/InconsisID (the sign-in SDK is a private Go
# module):
#   INCONSISID_READ_TOKEN=... docker build --secret id=inconsisid_token,env=INCONSISID_READ_TOKEN \
#     -f deploy/api.Containerfile -t inconsistable-api .
# (podman: --secret id=inconsisid_token,src=<a file holding the token>)
# The token is a BuildKit secret: mounted for the one download step, never written to a layer or the image.
FROM golang:1.27 AS build
ENV GOPRIVATE=github.com/The-Inconsistent CGO_ENABLED=0
WORKDIR /src
COPY apps/api-go/go.mod apps/api-go/go.sum ./
# git reads the token from the environment of this step only (GIT_CONFIG_*), so no .gitconfig keeps it.
RUN --mount=type=secret,id=inconsisid_token,required=true \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="url.https://x-access-token:$(cat /run/secrets/inconsisid_token)@github.com/.insteadOf" \
    GIT_CONFIG_VALUE_0="https://github.com/" \
    go mod download
COPY apps/api-go/ ./
# The migrations are embedded: the binary is the whole api.
RUN go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

# Alpine for its CA certificates (sign-in reaches the provider over https) and busybox wget (the health check).
FROM alpine:3
COPY --from=build /out/api /usr/local/bin/api
USER nobody
ENV NODE_ENV=production
EXPOSE 4000
CMD ["api"]
