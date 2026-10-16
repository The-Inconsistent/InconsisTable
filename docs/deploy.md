# Deploying InconsisTable

This guide is for whoever hosts a private InconsisTable on a machine at the table or on a home network. The repo gives
you two container images, a compose file with Postgres 18, and a health check. It does not choose a host.

> **There are no accounts, so there is no public deployment.** Every browser is an anonymous user named by a cookie
> (`it_device`), and anyone who can reach the web can make rooms and import rulesets into their own anonymous user. Run
> it only on this machine or on a LAN you trust, never behind a public address, a tunnel or a port forward. Public
> hosting waits for an auth provider (`docs/house-decisions.md`, "No accounts until a provider is chosen"), and for
> issues #15 to #19 (the security fixes).

## What runs

| Service    | Image                       | Reachable from                          |
| ---------- | --------------------------- | --------------------------------------- |
| `web`      | `deploy/web.Containerfile`  | This machine, or the LAN interface only |
| `api`      | `deploy/api.Containerfile`  | No: reached by the web over the network |
| `postgres` | `postgres:18`               | No                                      |

The web proxies `/api` and `/socket.io` to the api, so the browser sees one origin and **only the web publishes a
port**. The compose file binds it to `127.0.0.1` by default. To let phones and a TV at the table reach it, set
`BIND_ADDR` to this machine's LAN address (for example `192.168.1.10`). Never `0.0.0.0`, never a public interface.

## Quick start (compose)

From the repo root:

```bash
cp deploy/postgres.env.example deploy/postgres.env
cp deploy/api.env.example deploy/api.env
cp deploy/web.env.example deploy/web.env      # edit them; none of them is committed
export BIND_ADDR=192.168.1.10                  # optional: the LAN address phones use (default 127.0.0.1)
docker compose -f deploy/compose.yaml up -d --build    # podman compose works too
```

`WEB_PORT` (default 3000) sets the host port of the web. The api waits for Postgres to be healthy, and the web waits for
the api's health check. Secrets come only from the `*.env` files; no image contains one.

The guest QR cookie (`it_token`) is set by the api with `Secure` when it runs with `NODE_ENV=production`, which a
browser drops on plain http. On a LAN without TLS, guest QR joins therefore need a TLS terminator in front of the web,
or an api started with `NODE_ENV=development`. The device cookie is not affected: the web sets `Secure` only when the
request is https.

## Build arguments (web image)

Next.js fixes these at build time, so changing them means rebuilding the web image:

- `API_ORIGIN`: where the web proxies `/api` and `/socket.io`. Defaults to `http://api:4000` (the compose service). Change
  it only if the api lives elsewhere.
- `NEXT_PUBLIC_DEV_HOST` must stay unset (see below).

## Environment variables

### Api (`deploy/api.env`)

| Variable       | Rule                                                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | `postgres://<user>:<password>@postgres:5432/<db>`; must match `postgres.env`. Postgres 18 is required.                                                                                                                                                                              |
| `ADMIN_KEY`    | Optional. The only admin there is: the `/admin` page asks for it, scripts send it as `x-admin-key`, and the socket takes it as `adminKey`. Unset turns the admin page off. If set, a long random secret (32+ characters, e.g. `openssl rand -hex 32`); the api refuses to boot with a shorter one or `change-me`. Its actions are logged as actor `admin-key`. |
| `WEB_ORIGIN`   | The address the web is opened at, with scheme and no trailing slash (`http://192.168.1.10:3000`). Comma separated for several. Sets the socket's CORS.                                                                                                                              |
| `PORT`         | `4000`. Keep it; the web image and the health check assume it.                                                                                                                                                                                                                       |
| `TRUST_CF`     | `1` **only** if the web sits behind Cloudflare, so rate limits see the real client IP from `CF-Connecting-IP`. Leave empty otherwise: any client can forge that header when no Cloudflare is in front.                                                                              |

### Web (`deploy/web.env`)

The web needs no secret yet.

| Variable               | Rule                                                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEV_ORIGINS`          | **Never set** in a deployment. Dev server only.                                                                                                                                                       |
| `NEXT_PUBLIC_DEV_HOST` | **Never set** in a deployment (and never pass it as a build arg). It rewrites QR codes and invite links to a LAN address; in a deployment they must carry the real hostname, which they do when it is unset. |

### Postgres (`deploy/postgres.env`)

`POSTGRES_USER`, `POSTGRES_PASSWORD` (long and random), `POSTGRES_DB`.

## Identity

Each browser gets an `it_device` cookie from the web (httpOnly, one year). Clearing it, or opening the app in another
browser, makes a new anonymous user with no rooms. A GM who loses the cookie loses the rooms they own; keep the
database backed up and, until a provider exists, treat a GM's device as their account.

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
