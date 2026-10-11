# Handoff: from the cloud session to a local one

The cloud session designed InconsisTable and built P0. It could not run Aspire or open the web in a browser, because
the org proxy blocks `aspire.dev` and the CLI downloads, and the web needs real Clerk keys. Those steps are left for a
local machine. Read `CLAUDE.md` first: its eight principles are binding. Then read this file.

## Decisions already made

Do not reopen these.

- **Name:** InconsisTable, repo `The-Inconsistent/InconsisTable`. It is an in-person table companion for any RPG,
  carried over from Auspex (`The-Inconsistent/auspex_gm`, Wrath & Glory).
- **Content:**
  - The platform ships no game content. Every ruleset and pack is imported by its users.
  - The first ruleset to support is the 5e SRD (P1).
  - The app is not monetised yet.
- **Auspex's principles hold** (`CLAUDE.md` §Principles):
  - Rules carry a printed-page cite, and no book text is pasted.
  - Books never reach the server; the `book:*` relay stores nothing.
  - Content reaches seats only, and a `private` pack never leaves its owner's rooms.
  - The dice stay physical, the server decides, and shortcuts are marked `// ponytail:`.
- **Roles:**
  - Platform roles live in Clerk `publicMetadata.role` (`user | creator | moderator | admin`) and change only in the
    Dashboard.
  - The room owner is `campaign.owner_user_id`, not a role.
  - Seats are `gm | cogm | player`. Co-GM scopes are `combat`, `codex`, `codex.secrets`, `party` and `session`.
  - Token seats are `player` (guest QR) and `screen` (the TV, read-only).
- **Admin access:** a seated admin gets only their seat. OPEN AS ADMIN, with no seat, is logged in `admin_event`.
- **Data:**
  - Postgres 18, with uuidv7 ids.
  - JSONB only for documents read and written whole.
  - Actor values are typed rows (`actor_field`, `actor_resource`, `actor_condition`, `actor_choice`, `actor_link`).
- **Actor kinds:** `pc`, `companion`, `npc`, `creature`, `group`, `vehicle` and `hazard`. The ruleset's `entity_type`
  decides an actor's fields.
- **Maps:** there will be maps, but only as a memory aid for physical play. This is not an online VTT.
- **Legal note:** hosting what users import is generally covered by safe harbours (DMCA §512, EU DSA art. 6) when there
  is notice-and-takedown, no public spread, and no knowing facilitation. Ask a lawyer before going public. Until pack
  grants and per-route gates exist, keep Clerk **Invite-only**.

## Where things are

- **Design:** `docs/design.md` (Vietnamese), covering principles, domain, RBAC, the multi-character and co-GM UI,
  maps, the rules engine, data model, flows, roadmap and risks.
  - The P0 plan is `docs/p0-plan.md`.
  - Open engine choices are in `docs/house-decisions.md`.
- **Design page (private):** https://claude.ai/artifact/31MyqCkGc6AUExCRtAE3rH
- **The Auspex spike:** `docs/spikes/universal-rpg-platform.md` and `docs/spikes/inconsistable-p0-plan.md` on
  `auspex_gm` branch `claude/youthful-fermi-5xt6kq`. Nothing new is needed there.
- **P0 code:** branch `claude/p0-skeleton`, PR https://github.com/The-Inconsistent/InconsisTable/pull/1, based on `main`.
  Commits:
  1. `.claude/` carried over from Auspex: `/review`, the review checklist, the style guides and `codebase-navigator`.
  2. Tooling, `packages/auth`, and `packages/core-schema` (seats, `canInCampaign`, the Action union, per-seat views).
  3. `apps/api`: schema, seats and permissions, invites, owner transfer, admin lock, book relay, smoke test.
  4. `packages/rules-engine`: manifests, its own Pratt expression parser, dice, primitives, viewer views.
  5. `apps/web`: lobby, invites, the GM app with PARTY, the player app, the table screen.
  6. The Aspire AppHost (`aspire-apphost/apphost.mts`, `aspire.config.json`). **Never run.**

### Checks that passed in the cloud

- `bun run typecheck`, `bun run lint` and `bun run format:check` were clean.
- `bun run test`: 96 unit tests passed.
- `bun run test:smoke`: 8/8 against Postgres 18, with `CLERK_TEST_SECRET`.
- `next build` passed, with placeholder Clerk keys.
- `db:generate` reported no drift.

## Steps for the local session, in order

1. **Check out the branch.** Run `git fetch origin claude/p0-skeleton && git checkout claude/p0-skeleton`, then
   `bun install`.
2. **Clerk.** The user has already set Clerk up, so do not re-run `clerk init`. Just check that it fits the repo:
   - Apps never list `@clerk/*` as a dependency; only `packages/auth` does. If `clerk init` added `@clerk/nextjs` to
     `apps/web/package.json`, remove it, along with any `ClerkProvider` it generated (`packages/auth/src/react.tsx`
     already wraps it).
   - The env files follow `apps/api/.env.example` and `apps/web/.env.example`. Don't print or commit them.
     - api: `CLERK_SECRET_KEY`, plus `CLERK_JWT_KEY` (PEM).
     - web: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, plus `CLERK_SECRET_KEY`.
   - **Session token claims** (Dashboard → Sessions): `packages/auth/src/api.ts` reads these:
     `{ "metadata": "{{user.public_metadata}}", "name": "{{user.full_name}}", "username": "{{user.username}}" }`
   - Access mode is **Invite-only**.
   - To start rooms, your user needs public metadata `{ "role": "creator" }`, or `{ "role": "admin" }` to also reach the
     admin page.
   - `apps/web/proxy.ts` already lets `/__clerk/*` through: only `_next`, `api/`, `socket.io` and static files are
     excluded.
3. **Aspire.** Stop the compose Postgres first, since both use port 5435. Then run `aspire run`.
   - The AppHost has never run, so fix whatever breaks in `aspire-apphost/` and commit the fix.
   - The fallback without Aspire is `bun run dev:db`, `bun run dev:api` and `bun run dev:web`.
   - Note that `apps/api/.env` in the cloud used `PORT=4100`, while the web proxies to `:4000`. Keep them in step.
4. **Smoke test.** Run `bun run test:smoke` against the running api; it needs `CLERK_TEST_SECRET` in `apps/api/.env`.
5. **Browser test** (tablet as GM, phone as player):
   1. Sign in, then CREATE a room.
   2. In PARTY, add a character and show the Room QR.
   3. On the phone, scan it and claim the character, signed in or as a guest.
   4. Show a Guest QR and join with it.
   5. Show a Screen QR and open it on a third tab; it should be read-only.
   6. Start and end a session.
   7. Appoint a co-GM, tick scopes, and check that their tabs follow `canInCampaign`.
   8. Archive the room, then unarchive it.
   9. Offer the room to a co-GM, then accept as that co-GM.
6. **Review PR #1** with `/review`, which uses `.claude/code-review.md`. Fix what blocks, push, and merge into `main`.
7. **Plan P1:** 5e SRD playable for a whole session. That means:
   - the ruleset and pack importer (cites required);
   - actors and the builder;
   - the play sheet;
   - the combat tracker;
   - server-side undo.

## Not done yet

- The Clerk `user.updated` webhook, to kick a user whose role or lock changed. `TableGateway.kickUser` is ready for it.
- The co-GM and multi-character UI beyond PARTY's basics is planned for P2.
- **Open product question:** should the GM see an "Admin accessed" line? It would reverse Auspex's #178.
- **Backlog** from the design review (scored 50, dropped from the doc):
  - X-card anonymity;
  - sandbox script limits;
  - the cost of EAV snapshots;
  - `session_event` retention.

## Gotchas

- Use Bun only, never npm or pnpm. TypeScript stays on 5.9.
- Never bypass the Husky pre-commit hook (typecheck and test). Never commit `.env`, keys, book text, stat blocks, art or
  PDFs.
- Docker Postgres 18 listens on `127.0.0.1:5435`, with user, password and database all `it`.
- The schema is pre-release: to change it, delete `apps/api/drizzle/`, run `db:generate` and `docker compose down -v`.
- `pkill -f "bun src/main.ts"` can kill your own shell, so stop the api by its PID instead.
