# Backend (Go · pgx · Postgres 18) Code Style Guidelines

> Sibling to [frontend-code-style.md](./frontend-code-style.md). The philosophy is the same on both sides: strong typing,
> one source of truth, explicit structure, testability. Stack: **Go 1.27** (`apps/api-go`), **pgx v5** with hand-written
> SQL on **PostgreSQL 18**, Socket.IO through **`zishang520/socket.io`**, and `go test`. Architecture and the binding
> principles are in the root `CLAUDE.md`; why the api is Go is `docs/adr/0008-go-api.md`.

## General Principles

- **Formatting and vetting:** `gofmt` and `go vet` are clean (CI fails otherwise). Match the surrounding code.
- **Imports:** three groups, separated by a blank line: the standard library, third-party modules, then this module
  (`github.com/The-Inconsistent/InconsisTable/apps/api-go/...`). `coreschema` is imported as `cs`.
- **Naming:** Go's own: `MixedCaps`, exported only when another package uses it. File names are lower case, by what the
  file holds (`actions.go`, `http.go`, `signin_rules.go`), not prefixed with the package name.
- **Comments:** packages and exported names have a doc comment, saying why as well as what. A comment that ports
  TypeScript behaviour names the file it mirrors.
- **Untrusted input:** socket payloads, REST bodies, imported files and `jsonb` read back are decoded JSON (`any`) and go
  through `internal/schema` (the zod twin) before use. A type assertion on unparsed input uses the two-value form
  (`v, _ := x.(string)`), never one that can panic.
- **Shortcuts are marked:** `// ponytail: <ceiling>, <upgrade path>`.

## Structure

One package per feature under `internal/` (`auth`, `campaign`, `actor`, `encounter`, `codex`, `ruleset`, `pack`,
`admin`, `game`, `testcall`, `table`, `view`), each with its SQL, its actions and its HTTP handlers. `internal/core` is
what every feature leans on (database, HTTP helpers, CSRF, rate limits). `cmd/api/main.go` only wires: routes, limits,
services. No layer packages (`models`, `handlers`, `repositories`).

- **Twins:** `internal/engine`, `internal/coreschema` and `internal/schema` reproduce `packages/rules-engine`,
  `packages/core-schema` and zod; `internal/view` reproduces `vectors/reference`. A change to one side is made to both,
  with inputs added to `vectors/*.ts` (`bun run test:go`).
- **Closed sets** are defined once: a typed string constant set (`cs.SeatKind`) or one slice in `coreschema`
  (`actorKinds`, `memberRoles`), written from the TypeScript enum and held equal by the vectors.
- **Thin transports.** The gateway and the HTTP handlers parse, resolve the caller (`cs.Ctx`) and call a function. A
  handler that needs the database for tests takes it as a function (`table.deps`), so the transport is tested without one.

## Database

- **Raw SQL through pgx.** Data functions take `context.Context`, then a `core.Conn` (a pool or a transaction alike) or
  a `pgx.Tx`. `pgx.ErrNoRows` is checked with `errors.Is`.
- **One action is one transaction:** `table.ApplyAction` runs inside `core.InTx`; handlers never open their own.
- **Migrations** are SQL files in `apps/api-go/migrations`, embedded and applied at boot (`core.RunMigrations`). A schema
  change is a new hand-written file, numbered after the last. A file that has been applied anywhere is never edited.

## Errors

- A refusal the client should see is a `*coreschema.Error` (`cs.Fail(code, params)`): its code is a key of the refusal
  table, the same one the web translates. REST answers it as 400 through `core.Serve`; a REST refusal with another status
  is `core.Refuse(status, code)`. The socket acks it.
- Anything else is an internal error: logged, answered with a generic message, never a stack trace or SQL text.
- **Recover:** every REST handler runs through `core.Serve` and every socket handler behind `guard`, both of which
  recover a panic, log it and answer `serverError` or 500. A goroutine that serves a request starts behind `guard` too.

## Development Best Practices

### One mutation path

Every game change is an `Action` handled in this order:

1. **Validate** with the action's schema (`coreschema/actions.go`, the twin of `packages/core-schema/src/actions.ts`).
2. **Authorise** in `table.ApplyAction`: the state guard (archived games), then `canInCampaign` with the permission the
   action declares in `cs.ActionPerms`, then the action's own checks.
3. **Apply** inside the transaction.
4. **Rebroadcast** the snapshots that `TouchesOf(action)` reports, stamped with the campaign's `state_version`.

**Adding a core action** touches: its schema in `packages/core-schema` and `coreschema/actions.go`, its permission in
both permission tables, its handler in the owning package and in `table.handlers` (`TestEveryActionHasAHandler` fails
without one), and `TouchesOf` if it changes the codex.

**Ruleset actions** (`res.adjust`, `turn.op`, `rule.op`, `test.*`) never add a case: the primitive op declares `perm`,
`targets`, `validate`, `apply` and `touches`, and every delta it returns is checked against `targets` and the field's
`editableBy` before it is written.

Owner-scoped REST (the library, rulesets, packs) lives outside a campaign: every write there carries a unique constraint
or an `UPDATE … WHERE` that checks what it read.

### Scope every query

Every read and write filters by the caller's `ctx.CampaignID`, directly or through a parent row that has been checked.
**Never trust an ID from the client.** Look the row up scoped to the campaign and fail if it's missing.

### Atomic writes and concurrency

- Counters change by **delta** in SQL (`GREATEST`/`LEAST` around `col + $n`, capped where the rules cap them). Never
  read-modify-write in Go.
- Actions for one campaign are serialised by the gateway queue (`table.Serial`). A check-then-act inside a handler is
  safe only because of that queue; anything reached another way (REST, scripts) needs a DB constraint or a conditional
  `UPDATE … WHERE`.

### Rules come from the books

InconsisTable ships no rules: rules arrive in imported manifests, and every rule entry carries a `cite` with its printed
page (the validator refuses one without, except in homebrew). Engine primitives implement *mechanics*, never a specific
book's numbers; where the engine has to choose a behaviour a book leaves open, the choice is written in
`docs/house-decisions.md`, not made silently in code.

### Never leak hidden data

Anything sent to a seat goes through `internal/view`, which applies declared visibility (`gm`, `owner`, `party`,
`public`) and then the ruleset's view. Visibility is fail-closed: an undeclared field is `gm`. A derived value is as
hidden as its most hidden input. Pack content reaches seats only: a `gm` entry only GM seats, and a `private` pack never
leaves the rooms its owner runs. Book PDFs never reach the server (`book:*` relays one rendered page, stores nothing).

## Data Handling

- **Time:** `timestamptz` columns, `time.Time` in Go, UTC.
- **JSONB only for whole documents** (manifests, pack entry bodies, stat snapshots, the session event log, themes,
  house-rule patches, builder drafts). Anything filtered, joined, changed by delta or referenced by a foreign key is a
  column or a table; ruleset-declared values are typed rows keyed by `actor_id`. Ids are `uuidv7()`.

## Testing

- **Go:** `go test` next to the code. Database tests use `internal/core/dbtest` (the database `TEST_DATABASE_URL` names,
  migrated; a test that can works in a rolled-back `dbtest.Tx`) and skip without it. `bun run test:go` runs them with the vectors.
- **End-to-end:** `apps/smoke/test/smoke.test.ts` drives a real GM and player over Socket.IO against a running api and
  Postgres. Every new action or rule gets an assertion there, including its refusal cases.
- **Engine:** manifest fixtures are written by us for tests and contain no book text.

## Gates

`gofmt -l` empty, `go vet ./...`, `bun run test:go`, and the repo's `bun run typecheck`, `lint`, `format:check`, `test`.
