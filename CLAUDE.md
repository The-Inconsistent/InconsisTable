# InconsisTable: in-person table companion for any RPG or board game

The GM runs the table from a tablet (or, in a game without one, every player runs it together), players use their
phones, a TV can show the shared view. Real dice, cards, miniatures and terrain stay on the table; the app keeps the
bookkeeping. Board games are rulesets on the same engine (`docs/adr/0007-board-games-are-rulesets.md`). The design is
`docs/design.md` (Vietnamese); the current milestone is `docs/p1-plan.md`.

## Principles (binding, carried over from Auspex)

These rules decide reviews. Breaking one blocks a merge.

1. **Rules come from the books, never from memory.** Every rule entry in a ruleset manifest (resource, condition, test,
   initiative, effect, option) carries a `cite` with the printed page. The validator refuses an entry without one, except
   in a homebrew ruleset. Where a book is ambiguous, the decision is written down: in the ruleset's house-decisions file,
   or as a table's `house_rule`. Never decide silently in code.
2. **Book text is never pasted.** Store numbers and mechanics with a page cite. Descriptions are the importer's own short
   summary. The importer reminds them at the field and warns when a description in a `private` pack runs long.
3. **Books never reach the server.** The GM's PDF stays on the GM's device. When a player needs a page, the GM's tablet
   renders the tapped page and the api relays it without storing anything (`book:*` socket events). Printed cards are
   built in the GM's browser from what it already holds; nothing is uploaded.
4. **Content reaches seats only.** Nothing from a pack is served to anyone without a seat. A `gm` entry reaches GM seats
   only. A `private` pack never leaves the rooms its owner runs as GM, and cannot be granted to another user.
5. **The dice and components stay physical.** The app records results and only rolls or deals on random tables. Rolling
   Tests for players is a per-ruleset option that needs a house decision. Cards, tokens and boards stay on the table:
   the app keeps their counts and secrets, never simulates them.
6. **The server decides.** One mutation path. Counters take deltas and are clamped on the server. Players see only what
   the table's view lets them see. The only writes outside it are owner-scoped REST: a user importing their own
   rulesets and packs (`/api/rulesets`, `/api/packs`, the pack library), creating a room, the admin console, and
   a user's own sign-in, sign-out and sign-in methods (house decision #35).
7. **Shortcuts are marked:** `// ponytail: <ceiling>, <upgrade path>`.
8. **It serves a real table.** Readable at arm's length, no chat, phones never pull players away from the table. Each
   World gets a look made with care.

InconsisTable **ships no game content**. Every ruleset and pack is imported by its users. Never commit book text,
stat blocks, art or PDFs to this repo.

## Stack

Bun (package manager, runtime, test runner; never npm or pnpm), Turborepo, TypeScript 5.9 (do not upgrade: TS 7 breaks
the Next and Nest toolchains), Next.js 16 + React 19, NestJS on Bun, Socket.IO, Drizzle ORM, **Postgres 18**, zod 4,
Auth: device identity (an `it_device` cookie per browser) through `@inconsistable/auth`; on HTTPS deployments, accounts
through InconsisID with `@the-inconsistent/client` (ADR 0005, `docs/deploy.md` Sign-in).

## Layout

```
apps/api/src/        NestJS on Bun, run from source. One folder per feature, each owning its `*.schema.ts`:
  core/              db (Postgres 18, migrations at boot), errors, sql helpers (uuidv7 ids), rate limits
  auth/              seats: membership (+ held characters), tokens (guest, screen), invites, ownership transfer;
                     sign-in through InconsisID (sign-in.*), the api's own sessions and the identity links
  campaign/          rooms and sessions, lobby, create (REST), the session event log, the room's ruleset and packs
                     (`campaign.setRuleset/attachPack`, the seat-scoped `GET /api/campaigns/:id/rules`)
  actor/             actors and their typed value rows
  codex/             codex entries and their listed readers
  ruleset/           imported rulesets (owner-scoped REST import), versions, pools
  pack/              imported content packs: immutable versions, one row per entry, quota, export, takedown
  admin/             OPEN AS ADMIN housekeeping (admin key), the admin event log
  table/             the socket: gateway (queue, per-seat views, book relay, kicks), dispatch (authorize), loaders
  test-call/         Tests the GM calls: calls, called characters, reported rolls (physical dice, the server resolves)
apps/api/test/       smoke.test.ts: end-to-end against a running api and Postgres 18
apps/web/            Next.js 16: lobby, invite, join, the table page (GM app, player app, table screen)
packages/core-schema seats, permissions (canInCampaign), the core Action union, snapshots, per-seat views, book relay
packages/rules-engine manifests, expressions, dice, primitives, viewer views (no game content)
packages/auth        device identity and sign-in constants (cookie names, secret, AuthUser, platform roles)
```

## Commands

```bash
bun install
bun run dev:db              # Postgres 18 in Docker on localhost:5435
                            # no Docker: podman run -d --name inconsistable-pg -e POSTGRES_USER=it
                            #   -e POSTGRES_PASSWORD=it -e POSTGRES_DB=it
                            #   -p 127.0.0.1:5435:5432 -v inconsistable_pgdata:/var/lib/postgresql
                            #   docker.io/library/postgres:18
bun run dev:api             # api on :4000 (apps/api/.env, see .env.example)
bun run dev:web             # web on :3000 (apps/web/.env.local is optional)
aspire run                  # optional: Postgres 18 → api → web with a dashboard; TypeScript AppHost
                            # (aspire-apphost/apphost.mts), no .NET SDK. Stop the compose Postgres first: same port
                            # With Podman: ASPIRE_CONTAINER_RUNTIME=podman aspire run
bun run typecheck           # packages + api + web (with test, the Husky pre-commit hook)
bun run lint
bun run format              # Prettier, width 120; skips *.md
bun run test                # unit tests
bun run test:smoke          # end-to-end; needs dev:db and dev:api with ADMIN_KEY set (the suite gets the same value)
bun run seed                # sample data through the running api (idempotent); keep it in the local database, rerun
                            #   after a reset. Then open localhost:3000/dev/seed to become the sample GM
cd apps/api && bun run db:generate   # after editing any src/**/*.schema.ts
```

Pre-release: the migration may be regenerated from scratch (delete `apps/api/drizzle/`, `db:generate`,
`docker compose down -v`). Once there is real data, add migrations instead.

## Data rules

- JSONB only for documents read and written whole: ruleset manifests, pack entry bodies, stat snapshots, the session
  event log, themes, house-rule patches, builder drafts, small zod-validated codex documents. Anything filtered,
  joined, counted by delta, or referenced by a foreign key is a column or a table.
- Values of ruleset-declared fields, resources and conditions are typed rows keyed by `actor_id` (`docs/design.md` §5.4).
- Every query is scoped to `ctx.campaignId`. Never trust ids from the client.
- Every device is an anonymous user (`it_device` cookie, table `device`), and its `app_user.role` is `creator` by
  default. With sign-in on (`IDP_SIGN_IN`), a signed-in browser is the account's user instead (`__Host-it_session`,
  `deviceUser` reads it first), and that user's role is `creator` only when the ID token says so. Admin is the shared
  `ADMIN_KEY` (header `x-admin-key`, or the socket `adminKey`), never a user; the token's `admin` role grants nothing
  yet. The room owner is `campaign.owner_user_id`, not a role. Deploy is local/LAN only until the security fixes land
  (`docs/house-decisions.md`, `docs/deploy.md`).
- Every write (POST, PATCH, DELETE) carries `Sec-Fetch-Site: same-origin` or an `Origin` in `WEB_ORIGIN`
  (`core/csrf.ts`); the back-channel logout is the only exception.

## Standards

These are binding: follow them when writing code and use them when reviewing.
- **Backend:** `.claude/backend-code-style.md`.
- **Frontend:** `.claude/frontend-code-style.md`.
- **Reviews:** `.claude/code-review.md` (checklist and block-merge rules).
- **Review procedure:** the `/review` command (`.claude/commands/review.md`), which falls back to the local diff when
  there's no PR.
- **Multi-file investigation:** the `codebase-navigator` agent.
- **Delegating planned work:** the `plan-executor` agent (Sonnet, effort medium), prompted with the `delegate` skill.
- **Open engine choices:** `docs/house-decisions.md`.

## Git

The trunk is `main`. Work happens on a branch and lands through a pull request.

## Agent skills

### Issue tracker

GitHub Issues of The-Inconsistent/InconsisTable, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` and `docs/adr/`, alongside `docs/design.md` and `docs/house-decisions.md`. See
`docs/agents/domain.md`.
