# Deploying InconsisTable

This guide covers two ways to host InconsisTable:

- **On a LAN** (the quick start below): a machine at the table or on a home network, with `deploy/compose.yaml`.
- **On a public VPS** (the VPS section): Caddy, InconsisID and the app from prebuilt images, with
  `deploy/vps/compose.yaml`.

> **The LAN stack is never public.** Without sign-in, every browser is an anonymous user named by a cookie
> (`it_device`), and anyone who can reach the web can make rooms and import rulesets into their own anonymous user. Run
> `deploy/compose.yaml` only on this machine or on a LAN you trust, never behind a public address, a tunnel or a port
> forward.
>
> **The VPS stack waits on one fix.** The security fixes (#15 to #19) have landed, and InconsisID provides accounts
> (ADR 0005). But with `IDP_SIGN_IN=1`, an anonymous device is still a `creator`, and pack and ruleset imports check no
> role. Until anonymous users can no longer start rooms or import, keep the VPS's DNS records unpublished.

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
export NODE_AUTH_TOKEN=$(gh auth token)        # needs read:packages: the api uses @the-inconsistent/inconsisid
docker compose -f deploy/compose.yaml up -d --build    # podman compose works too
```

The token reaches `bun install` as a build secret (`npm_token`), so no image layer keeps it.

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
`inconsistable-dev` client in development) and set in `apps/api/.env`: `IDP_SIGN_IN=1`, `IDP_DEV_HTTP=1`,
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
health check never turns green.

## VPS (Dockhand + Caddy)

The public stack is `deploy/vps/compose.yaml`: Caddy, web, api, InconsisID and Postgres 18 on one host. The images are
built by `.github/workflows/publish-images.yml` on every merge to `main` (`ghcr.io/the-inconsistent/inconsistable-api`
and `-web`, tagged `sha-<short>` and `main`). InconsisID's image comes from its own repo. The VPS never builds anything.

```
Internet ─▶ :80/:443 Caddy ─┬─▶ web:3000 ── /api, /socket.io ──▶ api:4000 ─▶ postgres (it)
                            └─▶ idp:4100 ──────────────────────────────────▶ postgres (it_auth)
SSH :22 ─▶ host;  Dockhand on 127.0.0.1:4444 only, through an SSH tunnel
```

**Size:** 2 vCPU, 4 GB RAM, 40 GB NVMe, x86_64 (the images are amd64), plus a 2 GB swap file. Steady use is about
1.6 to 2.3 GB of RAM:

| Part | RAM steady | `mem_limit` |
| --- | --- | --- |
| OS + Docker | ~500 MB | |
| Postgres 18 | ~400–600 MB | 1 GB |
| api | ~200–350 MB | 768 MB |
| web | ~150–250 MB | 512 MB |
| InconsisID | ≤ 256 MB | 256 MB |
| Caddy | ~40 MB | 128 MB |
| Dockhand | ~150 MB | |

Pick the region nearest the table: every phone holds a live socket. 8 GB only pays if images are built on the host or
another app moves in.

### One-time host setup

1. **Access.** Create a sudo user with an SSH key, then set `PermitRootLogin no` and `PasswordAuthentication no`. Run
   `ufw allow 22,80,443/tcp && ufw allow 443/udp && ufw enable`, turn on `unattended-upgrades`, and add a 2 GB swap
   file.
2. **Docker and Dockhand.** Install Docker Engine with the compose plugin (2.23.1 or later, for inline `configs`).
   Run Dockhand with its port bound to `127.0.0.1:4444`, and reach it with `ssh -L 4444:localhost:4444 <host>`.
3. **Registry.** In Dockhand, add `ghcr.io` with a token that has `read:packages` and nothing else.
4. **Secrets.** Make them on your own machine, then copy them into `/srv/inconsis/secrets` (the directory `0700`
   root, the files `0444`; each container mounts only its own):

   | File | What |
   | --- | --- |
   | `postgres_password` | the `it` superuser's password (`openssl rand -hex 32`) |
   | `idp_db_password` | the `it_idp` role's password (`openssl rand -hex 32`) |
   | `op_jwks.json`, `op_cookie_keys.json` | InconsisID's signing and cookie keys (InconsisID `deploy/README.md`) |
   | `idp_client_jwk.json` | this app's private client JWK; its public half goes in InconsisID's `clients/inconsistable.ts` |

5. **InconsisID client.** Open a PR on InconsisID that registers `inconsistable` with:
   - the redirect URI `https://<TABLE_HOST>/api/auth/callback`;
   - the post-logout redirect `https://<TABLE_HOST>/`;
   - the back-channel URI `https://<TABLE_HOST>/api/auth/backchannel-logout`.
6. **DNS.** Add two A records, `TABLE_HOST` and `AUTH_HOST`, pointing at the VPS. In Cloudflare, use DNS only (grey
   cloud). Caddy gets the certificates, and with no proxy in front, leave `TRUST_CF` unset.
7. **Stack.** In Dockhand, add a git stack for this repo at `deploy/vps/compose.yaml` with the env named at the top of
   that file:
   - `TABLE_HOST`, `AUTH_HOST`, `APP_TAG`, `IDP_TAG`;
   - `DATABASE_URL`, with the `postgres_password` value in it (hex is safe in a URL);
   - `ADMIN_KEY`.

   Then deploy. The first boot of the empty volume creates the `it_auth` database and its role.
8. **Cron** (root):
   ```
   0 3 * * *  /srv/inconsis/backup.sh
   0 4 * * 0  docker image prune -af --filter until=168h
   ```
   `backup.sh` is `deploy/vps/backup.sh`, copied to the host. It keeps 7 days of `pg_dump -Fc` files for `it` and
   `it_auth` in `/srv/inconsis/backups`.
9. **Off-host copy.** Your own machine pulls it, so the VPS holds no credential to anything else, for example nightly
   `rsync -a <host>:/srv/inconsis/backups/ ~/backups/inconsis/`. Restore one into a scratch database now and then.

**Upgrading:** set `APP_TAG` or `IDP_TAG` to the new tag in Dockhand, then "Pull & redeploy". Migrations run at the
api's boot (see Migrations), so back up first.

## Data and backups

Postgres keeps its data on the named volume `pgdata` (mounted at `/var/lib/postgresql`), so a restart or an image upgrade
loses nothing. The volume is the only state: back it up. For example, a nightly
`docker compose -f deploy/compose.yaml exec -T postgres pg_dump -U <user> <db> | gzip > backup.sql.gz`, stored off the
host, and a restore test now and then. The api keeps nothing on disk. Books never reach the server, so there are none to
back up.
