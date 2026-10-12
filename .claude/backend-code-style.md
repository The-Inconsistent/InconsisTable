# Backend (NestJS · Drizzle · Bun) Code Style Guidelines

> Sibling to [frontend-code-style.md](./frontend-code-style.md). The philosophy is the same on both sides: strong typing,
> one source of truth, explicit structure, testability. Stack: **NestJS 12** on **Bun** (run from source, no build step),
> **Drizzle ORM** on **PostgreSQL 18**, **Socket.IO**, **zod 4** schemas from `@inconsistable/core-schema` and
> `@inconsistable/rules-engine`, and **`bun test`**. Architecture and the binding principles are in the root `CLAUDE.md`.

## General Principles

- **Types:** never use `any`. Use a concrete type, `unknown` plus a zod parse, or a generic. TypeScript strict mode and
  `noUncheckedIndexedAccess` are on; a `!` needs a reason (e.g. "the row was just inserted").
- **Safe access:** guard `null`/`undefined` before use. Optional chaining is required on data from outside the process
  (DB rows, socket payloads, JSON files). Payloads are validated by zod first, so after parsing you can trust their shape.
- **Imports:** group them as node built-ins (`node:*`), then third-party, then workspace (`@inconsistable/*`), then relative, each
  group alphabetised. Relative imports use the `.ts` extension.
- **Naming:**
  - `camelCase` for functions and variables, `PascalCase` for classes, types and zod schemas.
  - `UPPER_SNAKE_CASE` for module-level constants.
  - kebab-case, feature-prefixed file names (`encounter.actions.ts`, `campaign.controller.ts`).
- **Errors:** client-facing failures throw `ActionError` (socket actions) or a Nest `HttpException` (REST). Unexpected
  errors are logged and returned as a generic message, never as stack traces.
- **Formatting:** 2-space indentation and double quotes, with Prettier as the formatter. Match the surrounding code.

## Development Best Practices

### Closed value sets: define once

**Never re-declare a literal-string union inline.** Every closed set (actor kind, seat role, permission, visibility,
resource scope, scene type…) is defined **once** as a `z.enum` in `packages/core-schema` (or `packages/rules-engine` for
engine sets), and its type comes from that schema via `z.infer`. DB columns reference it with `.$type<T>()`. Call sites
may use the literal (`kind === "pc"`), because the type checks it.

```ts
// ❌ Avoid: a second, drifting copy of the set
kind: text().$type<"pc" | "creature">().notNull(),

// ✅ Prefer: one definition in packages/core-schema, referenced everywhere
export const ActorKind = z.enum(["pc", "companion", "npc", "creature", "group", "vehicle", "hazard"]);
export type ActorKind = z.infer<typeof ActorKind>;
kind: text().$type<ActorKind>().notNull(),
```

*Why:* adding a value is one edit. A schema, a DB column and a UI switch can't drift apart, and TypeScript flags every
place that doesn't handle the new value.

### Function parameters

A function with **more than two parameters**, or two adjacent parameters of the same type, takes **one options
object**. A DB handle (`tx`) may stay as the first positional parameter, since every data function takes one.

```ts
// ❌ Avoid: positional soup; count and initiative are easy to swap
addCreatures(tx, encounterId, packKey, count, initiative);

// ✅ Prefer
addCreatures(tx, { encounterId, packKey, count, initiative });
```

### No barrel files inside apps

Import from the module that defines a symbol. The one exception is a workspace package's public entry
(`packages/core-schema/src/index.ts`, `packages/rules-engine/src/index.ts`), which is that package's API.

### Feature-based structure (strictly enforced)

Group code by **feature**, never by layer. A global `schema.ts`, `services/` or `controllers/` is not allowed.

```text
apps/api/src/
  main.ts                    # bootstrap only
  app.module.ts              # wiring only
  core/                      # app-wide, not feature-specific
    db.ts                    # drizzle client, Tx type, migrations
    errors.ts                # ActionError, fail()
    sql.ts                   # shared SQL helpers (clamped counters)
  auth/                      # guest and screen tokens, membership, invites, ownership transfer
    auth.schema.ts
    auth.service.ts
  campaign/                  # campaign + session: REST setup, pools, session start/end
    campaign.controller.ts
    campaign.service.ts
    campaign.actions.ts
    campaign.schema.ts
  actor/                     # actors and their typed value rows (fields, resources, conditions, choices)
  encounter/                 # encounters, turns, combatants
  codex/                     # codex entries: adventures/scenes, locations, NPCs, factions, handouts, quests
  ruleset/                   # imported rulesets and packs, their versions and grants
  table/                     # the socket: gateway, action dispatch, snapshot loaders
```

Each feature owns its Drizzle tables (`<feature>.schema.ts`). `drizzle.config.ts` globs `src/**/*.schema.ts`.

### Keep transports thin

Controllers and the gateway parse input, resolve the caller (`Ctx`) and call a function. Game logic lives in
`<feature>.actions.ts` or `<feature>.service.ts`. Those files import no Nest symbols, so they're testable on their own and
reusable from scripts.

### One mutation path

Every game change is an `Action` (zod union in `packages/core-schema/src/actions.ts`) handled in this order:

1. **Validate** with `Action.safeParse`.
2. **Authorise** with `authorize(ctx, action)`: the state guard (archived games), then `canInCampaign` with the
   permission the action declares, then the action's own validator (delta direction, the character belongs to the seat).
3. **Apply** inside `db.transaction`.
4. **Rebroadcast** the snapshots that `touches(action)` reports, stamped with the campaign's `state_version`.

**Adding a core action** touches these places:
1. its schema in `packages/core-schema/src/actions.ts`
2. its permission in `ACTION_PERMS` (a missing entry is a type error)
3. its handler in the owning feature's `*.actions.ts`
4. its `case` in `table/table.dispatch.ts` (a missing case is a type error)
5. `touches()`, if it changes the codex

**Ruleset actions** (`res.adjust`, `turn.op`, `rule.op`, `test.*`) never add a case: the primitive op declares `perm`,
`targets`, `validate`, `apply` and `touches`, and every delta it returns is checked against `targets` and the field's
`editableBy` before it is written.

Two families of change live outside a campaign: owner-scoped REST (the library, my rulesets, packs and worlds), where
every write carries a unique constraint or an `UPDATE … WHERE revision = $expected`; and World edits, serialised per
`world_id` and rebroadcast to every campaign on that World (`docs/design.md` §5.3).

### Scope every query

Every read and write filters by the caller's `ctx.campaignId`, directly or through a parent row that has been checked.
**Never trust an ID from the client.** Look the row up scoped to the campaign and fail if it's missing.

### Atomic writes and concurrency

- One action = one transaction. Never write outside `tx` in an action handler.
- Counters change by **delta** in SQL (`greatest(0, col + d)`, capped where the rules cap them). Never read-modify-write
  in application code.
- Actions for one campaign are serialised by the gateway queue. A check-then-act inside a handler is safe only because of
  that queue; anything reached another way (REST, scripts) needs a DB constraint or a conditional `UPDATE … WHERE`.

### Rules come from the books

InconsisTable ships no rules: rules arrive in imported manifests, and every rule entry carries a `cite` with its printed
page (the validator refuses one without, except in homebrew). Engine primitives implement *mechanics*, never a specific
book's numbers; where the engine has to choose a behaviour a book leaves open, the choice is written in
`docs/house-decisions.md`, not made silently in code. Pure rules functions go in `packages/rules-engine`, where the web
and the api share them and they're unit tested.

### Never leak hidden data

Anything sent to a seat goes through `toViewerView`, which applies declared visibility (`gm`, `owner`, `party`,
`public`) and then the ruleset's view function. Visibility is fail-closed: an undeclared field is `gm`. A derived value is
as hidden as its most hidden input. Pack content reaches seats only: a `gm` entry only GM seats, and a `private` pack
never leaves the rooms its owner runs. Book PDFs never reach the server (`book:*` relays one rendered page, stores
nothing).

### Async/await

Use `async`/`await`, not `.then()` chains. Don't write `return await x`; use `const result = await x; return result;`
(clearer stack traces). Run independent queries concurrently with `Promise.all` (see `loadCodex`). Run sequential
awaits in a loop only when order matters, as with writes in one transaction.

## Data Handling

- **Time:** `timestamp({ withTimezone: true })` columns. Create them with `new Date()` or `now()` and serialise them as ISO
  strings; store everything in UTC.
- **Parsing external data:** imported manifests, pack files and `jsonb` columns go through their zod schema
  (`Ruleset.parse`, `PackEntry.parse`), never raw property access on `JSON.parse` output.
- **JSONB only for whole documents** (manifests, pack entry bodies, stat snapshots, the session event log, themes,
  house-rule patches, builder drafts). Anything filtered, joined, changed by delta or referenced by a foreign key is a
  column or a table; ruleset-declared values are typed rows keyed by `actor_id`. Ids are `uuidv7()`.
- **Migrations:** edit the feature schema, then `bun run db:generate`. Until real campaign data exists, the migration may
  be regenerated from scratch (see CLAUDE.md). After that, add migrations and never rewrite them.

## Testing

- **Unit:** pure functions in `packages/core-schema`, `packages/rules-engine` and `apps/web/lib`, tested with `bun test` (`node:test` + `node:assert`).
- **End-to-end:** `apps/api/test/smoke.test.ts` drives a real GM and player over Socket.IO against a running api and
  Postgres. Every new action or rule gets an assertion there, including its refusal cases.
- **Engine:** manifest fixtures in `packages/rules-engine` are written by us for tests and contain no book text.
- Test values come from the same constants the code uses (e.g. `SEAT_GRANTS`), not copied numbers.

## Linting & Formatting

- `bun run typecheck` (packages, api, web), `bun run lint` and `bun run format:check` must pass before a commit.
- Prettier formats the code (`bun run format`, width 120). Do not hand-align.
