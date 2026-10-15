# Deploying InconsisTable

This guide is for whoever hosts a private InconsisTable. The repo gives you two container images, a compose file with
Postgres 18, and a health check. It does not choose a host: TLS, DNS, the domain and any CI/CD are yours.

> **Do not expose this deployment publicly until issues #15 to #19 (the security fixes) are merged.** Until then, run
> it only on a private network.

## What runs

| Service    | Image                       | Public?                              |
| ---------- | --------------------------- | ------------------------------------ |
| `web`      | `deploy/web.Containerfile`  | Yes: the only service to publish     |
| `api`      | `deploy/api.Containerfile`  | No: reached by the web over the network |
| `postgres` | `postgres:18`               | No                                   |

The web proxies `/api` and `/socket.io` to the api, so the browser sees one origin and **only the web needs to be
reachable from outside**. Put your TLS terminator or reverse proxy in front of the web (port 3000 in the container).

## Quick start (compose)

From the repo root:

```bash
cp deploy/postgres.env.example deploy/postgres.env
cp deploy/api.env.example deploy/api.env
cp deploy/web.env.example deploy/web.env      # edit all three; none of them is committed
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...   # build arg, see below
docker compose -f deploy/compose.yaml up -d --build    # podman compose works too
```

`WEB_PORT` (default 3000) sets the host port of the web. The api waits for Postgres to be healthy, and the web waits for
the api's health check. Secrets come only from the `*.env` files; no image contains one.

## Build arguments (web image)

Next.js fixes these at build time, so changing them means rebuilding the web image:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: the Clerk **production** publishable key (`pk_live_...`). Required.
- `API_ORIGIN`: where the web proxies `/api` and `/socket.io`. Defaults to `http://api:4000` (the compose service). Change
  it only if the api lives elsewhere.
- `NEXT_PUBLIC_DEV_HOST` must stay unset (see below).

## Environment variables

### Api (`deploy/api.env`)

| Variable           | Production rule                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`     | `postgres://<user>:<password>@postgres:5432/<db>`; must match `postgres.env`. Postgres 18 is required.              |
| `ADMIN_KEY`        | Required. A long random secret (32+ characters, e.g. `openssl rand -hex 32`); the api refuses to boot with a shorter one or `change-me`. Used by admin scripts, and its actions are logged as actor `admin-key`. |
| `WEB_ORIGIN`       | The real public origin of the web, with scheme and no trailing slash (`https://table.example.com`). Comma separated for several. Sets CORS and the Clerk token's allowed origin, so a wrong value signs everyone out. |
| `PORT`             | `4000`. Keep it; the web image and the health check assume it.                                                       |
| `CLERK_SECRET_KEY` | The production secret key (`sk_live_...`).                                                                           |
| `CLERK_JWT_KEY`    | The instance's JWT public key (Clerk Dashboard, API keys). Lets the api verify sessions without a network call.     |
| `CLERK_WEBHOOK_SECRET` | The signing secret (`whsec_...`) of the Clerk webhook endpoint `/api/webhooks/clerk` (see "Clerk production"). Requests without a valid Svix signature are refused. |
| `TRUST_CF`         | `1` **only** if the web sits behind Cloudflare, so rate limits see the real client IP from `CF-Connecting-IP`. Leave empty otherwise: any client can forge that header when no Cloudflare is in front. |
| `CLERK_TEST_SECRET`| **Never set in production.** The api refuses to start if it is set (the image runs with `NODE_ENV=production`).     |

### Web (`deploy/web.env`)

| Variable                | Production rule                                                  |
| ----------------------- | ---------------------------------------------------------------- |
| `CLERK_SECRET_KEY`      | The same production secret key (`sk_live_...`).                  |
| `DEV_ORIGINS`           | **Never set in production.** Dev server only.                    |
| `NEXT_PUBLIC_DEV_HOST`  | **Never set in production** (and never pass it as a build arg). It rewrites QR codes and invite links to a LAN address; in production they must carry the real hostname, which they do when it is unset. |

### Postgres (`deploy/postgres.env`)

`POSTGRES_USER`, `POSTGRES_PASSWORD` (long and random), `POSTGRES_DB`.

## Clerk production

1. In the Clerk Dashboard, create a **production** instance (a development instance is not for real players).
2. Set the instance's domain to your real domain and add the DNS records Clerk lists.
3. Copy the keys: the publishable key goes into the web build arg, the secret key into `api.env` and `web.env`, and the
   JWT public key into `CLERK_JWT_KEY`.
4. Keep sign-up **restricted** (Dashboard, User & authentication, Restrictions: sign-up mode "Restricted"). This keeps the
   deployment invite-only: only people you invite from the Dashboard can sign in.
5. Make yourself admin: on your user in the Dashboard, set **public metadata** to `{ "role": "admin" }`. To let someone
   open rooms, give them `{ "role": "creator" }`. Roles change only in the Dashboard; the app never edits them.
6. Add a webhook endpoint (Dashboard, Webhooks): URL `https://<your host>/api/webhooks/clerk`, events `user.updated` and
   `user.deleted`. Copy its signing secret (`whsec_...`) into `CLERK_WEBHOOK_SECRET`. A user whose role or lock changes,
   or who is deleted, then loses their open table connections at once instead of at their next reconnect. Without the
   secret the endpoint answers 503 and changes wait for the reconnect.

## Health check

`GET /api/health` on the api (and through the web at `/api/health`) is unauthenticated. It pings the database and answers
`200`, or `503` when the database is down; the body says nothing else. The compose file uses it for the api's
healthcheck; point your platform's liveness probe at it.

## Migrations

They run at api boot, before it starts listening. Do not run them by hand. A failed migration stops the api, and the
health check never turns green.

## Data and backups

Postgres keeps its data on the named volume `pgdata` (mounted at `/var/lib/postgresql`), so a restart or an image upgrade
loses nothing. The volume is the only state: back it up. For example, a nightly
`docker compose -f deploy/compose.yaml exec -T postgres pg_dump -U <user> <db> | gzip > backup.sql.gz`, stored off the
host, and a restore test now and then. The api keeps nothing on disk. Books never reach the server, so there are none to
back up.
