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
export INCONSISID_READ_TOKEN=...               # a token that can read The-Inconsistent/InconsisID (see below)
docker compose -f deploy/compose.yaml up -d --build    # podman compose works too
```

The api is the Go binary built from `apps/api-go` (`docs/adr/0008-go-api.md`). Its sign-in SDK,
`github.com/The-Inconsistent/InconsisID/packages/inconsisid-go`, is a private Go module, so building the api image needs
a GitHub token with read access to that repository in `INCONSISID_READ_TOKEN`. Compose hands it to the build as a
BuildKit secret (`inconsisid_token`), mounted for the module download only: it is never written to a layer, and the
image holds only the binary. Building by hand: `docker build --secret id=inconsisid_token,env=INCONSISID_READ_TOKEN -f
deploy/api.Containerfile .` from the repo root.

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
| `WEB_ORIGIN`   | The address the web is opened at, with scheme and no trailing slash (`http://192.168.1.10:3000`). Comma separated for several. Sets the socket's CORS, and which `Origin` a write may carry when the client sends no `Sec-Fetch-Site` (browsers do; see Sign-in). |
| `PORT`         | `4000`. Keep it; the web image and the health check assume it.                                                                                                                                                                                                                       |
| `TRUST_CF`     | `1` **only** if the web sits behind Cloudflare, so rate limits see the real client IP from `CF-Connecting-IP`. Leave empty otherwise: any client can forge that header when no Cloudflare is in front.                                                                              |
| `IDP_SIGN_IN` | Optional. `1` turns sign-in through InconsisID on (see Sign-in below); unset or `0` keeps every browser anonymous and ignores the other `IDP_` variables. Once on, a missing or unsafe value refuses to boot. |
| `IDP_ISSUER` | The identity provider's issuer, exactly as its discovery says (`https://auth.example`, no trailing slash). https only. |
| `IDP_CLIENT_ID` | This deployment's client id, as registered in InconsisID's `clients/`. |
| `IDP_REDIRECT_URI` | `<web origin>/api/auth/callback`, exactly as registered. https only. Its origin is where sign-in works: the sign-in form must be posted from it, and the post-logout redirect is its `/`. |
| `IDP_CLIENT_JWK_FILE` | Path to this client's private ES256 JWK (`kty` `EC`, `crv` `P-256`, `kid`, `x`, `y`, `d`), mounted as a secret file; never an environment variable. Its public half is in the client registration. |
| `IDP_DEV_HTTP` | **Never set** in a deployment. Development only: allows `http://localhost` for the issuer and the redirect URI, and is refused when `NODE_ENV=production`. |

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

## Sign-in

Accounts come from InconsisID, our OpenID Provider (ADR 0005, house decision #33), and exist only on HTTPS deployments.
With `IDP_SIGN_IN` unset nothing changes: every browser is anonymous. With it on, the lobby shows **Sign in**, which
goes to InconsisID (a passkey, or a recovery code) and back to the lobby signed in; **Sign out** ends the session here
and asks InconsisID to end its own.

- **Register the client first.** A PR on InconsisID adds `clients/<name>.ts` with the public half of the key, the redirect
  URI, `<web origin>/` as the post-logout redirect, and `<web origin>/api/auth/backchannel-logout` as the back-channel
  URI.
- **Expose the back-channel URI publicly.** InconsisID refuses to deliver logout tokens to loopback or private addresses.
  Without delivery, an account disabled or demoted at InconsisID stays signed in here until its session ends.
- **Sessions** are the api's own: an httpOnly `__Host-it_session` cookie, 30 days idle and 90 days at most. Signing out,
  or a logout token from InconsisID, deletes the session and disconnects its table sockets at once.
- **Writes need the web's own origin.** Every POST, PATCH and DELETE must carry `Sec-Fetch-Site: same-origin` (browsers
  send it), or an `Origin` listed in `WEB_ORIGIN`; only the back-channel logout is exempt. A script calling the api
  sends one of the two.
- **Roles** come from the ID token at each sign-in: `creator` lets the account start rooms; `admin` grants nothing yet.
  InconsisID makes every new account a `creator`; an account whose `creator` is revoked there (`bun run admin revoke
  <sub> creator` on the InconsisID host) cannot start rooms from its next sign-in. Signing in on a device leaves that device's anonymous
  user and its rooms untouched; signing out returns the device to it.

**Locally:** run InconsisID (`bun run dev:db`, `bun run keys:dev`, `bun run dev` in its checkout; it registers the
`inconsistable-dev` client in development) and set in `apps/api-go/.env`: `IDP_SIGN_IN=1`, `IDP_DEV_HTTP=1`,
`IDP_ISSUER=http://localhost:4100`, `IDP_CLIENT_ID=inconsistable-dev`,
`IDP_REDIRECT_URI=http://localhost:3000/api/auth/callback` and `IDP_CLIENT_JWK_FILE=<InconsisID checkout>/.secrets/inconsistable_dev_client_jwk.json`.
Open the web at `http://localhost:3000` (Chromium keeps the `Secure` cookies on localhost); at a LAN address over http
sign-in is refused. Logout tokens are never delivered to localhost; `bun run logout-token inconsistable-dev <sub> <sid>`
in the InconsisID checkout prints one to POST to `/api/auth/backchannel-logout` by hand.

## Health check

`GET /api/health` on the api (and through the web at `/api/health`) is unauthenticated. It pings the database and answers
`200`, or `503` when the database is down; the body says nothing else. The compose file uses it for the api's
healthcheck; point your platform's liveness probe at it.

## Migrations

They run at api boot, before it starts listening. Do not run them by hand. A failed migration stops the api, and the
health check never turns green. The SQL files (`apps/api-go/migrations`) are built into the binary and recorded by name
in the table `schema_migration`. A database the NestJS api migrated keeps working: the files Drizzle recorded in
`drizzle.__drizzle_migrations` count as applied and are not run again.

## Data and backups

Postgres keeps its data on the named volume `pgdata` (mounted at `/var/lib/postgresql`), so a restart or an image upgrade
loses nothing. The volume is the only state: back it up. For example, a nightly
`docker compose -f deploy/compose.yaml exec -T postgres pg_dump -U <user> <db> | gzip > backup.sql.gz`, stored off the
host, and a restore test now and then. The api keeps nothing on disk. Books never reach the server, so there are none to
back up.
