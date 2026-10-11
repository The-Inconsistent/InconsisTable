# InconsisTable: in-person table companion for any RPG

The GM runs the table from a tablet, players use their phones, a TV can show the shared view. Real dice, miniatures and
terrain stay on the table; the app keeps the bookkeeping. The design is `docs/design.md` (Vietnamese); the current
milestone is `docs/p0-plan.md`.

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
5. **The dice stay physical.** The app records results and only rolls on random tables. Rolling Tests for players is a
   per-ruleset option that needs a house decision.
6. **The server decides.** One mutation path. Counters take deltas and are clamped on the server. Players see only what
   the table's view lets them see.
7. **Shortcuts are marked:** `// ponytail: <ceiling>, <upgrade path>`.
8. **It serves a real table.** Readable at arm's length, no chat, phones never pull players away from the table. Each
   World gets a look made with care.

InconsisTable **ships no game content**. Every ruleset and pack is imported by its users. Never commit book text,
stat blocks, art or PDFs to this repo.

## Stack

Bun (package manager, runtime, test runner; never npm or pnpm), Turborepo, TypeScript 5.9 (do not upgrade: TS 7 breaks
the Next and Nest toolchains), Next.js 16 + React 19, NestJS on Bun, Socket.IO, Drizzle ORM, **Postgres 18**, zod 4,
Clerk (only through `@inconsistable/auth`).

## Data rules

- JSONB only for documents read and written whole: ruleset manifests, pack entry bodies, stat snapshots, the session
  event log, themes, house-rule patches, builder drafts, small zod-validated codex documents. Anything filtered,
  joined, counted by delta, or referenced by a foreign key is a column or a table.
- Values of ruleset-declared fields, resources and conditions are typed rows keyed by `actor_id` (`docs/design.md` §5.4).
- Every query is scoped to `ctx.campaignId`. Never trust ids from the client.
- Platform roles live in Clerk and are changed only in the Clerk Dashboard. The room owner is
  `campaign.owner_user_id`, not a role.

## Git

The trunk is `main`. Work happens on a branch and lands through a pull request.
