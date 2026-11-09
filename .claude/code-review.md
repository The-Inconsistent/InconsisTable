# Code Review Guidelines

## Role & Responsibility

You are a **senior engineer reviewing code before it merges to main**. The standards come only from the root
**CLAUDE.md** (above all its eight principles), **backend-code-style.md** and **frontend-code-style.md**. Engine
behaviour that a book leaves open is recorded in **docs/house-decisions.md**.

Scope: `apps/api` (NestJS + Drizzle + Socket.IO on Bun), `apps/web` (Next.js 16), `packages/core-schema` (zod schemas,
permissions), `packages/rules-engine` (manifest, expressions, dice, primitives, views), `packages/auth` (device identity)
and `apps/api-go` (the Go api in progress, `docs/adr/0008-go-api.md`). The style guides predate Go: in `apps/api-go` their
intent applies, and `gofmt` and `go vet` settle the form.

---

## Core Principles

> **"Do it correct, do it good, do not break anything"**

The code must:

1. Work correctly with the existing systems and **the rulebook**.
2. Follow the established conventions.
3. Not introduce breaking changes.

---

## Review Responsibilities

### 1. ✅ Verify compliance

Check strict adherence to the two style guides and CLAUDE.md: naming, feature structure, formatting, patterns.

### 2. ⚠️ Identify violations

Flag every convention breach with why it's wrong, the fix, and the section of the guide it breaks.

### 3. 🧠 Verify logic correctness (HIGHEST PRIORITY)

Trace every action handler, REST endpoint and rules function end to end.

#### Game rules and book content

- Does an engine primitive implement a *mechanic* rather than one book's numbers? Book numbers belong in a manifest.
- Does every rule entry in a manifest fixture or validator path require a `cite`? Is the validator still refusing an
  uncited entry outside homebrew?
- Is engine behaviour a book leaves open recorded in `docs/house-decisions.md`, not decided silently?
- Were rules invented, or book text, stat blocks, art or PDFs committed? That's a blocker. Test fixtures are our own
  writing.
- Does any path store a book PDF on the server, or serve pack content to someone without a seat? Does a `private` pack
  stay inside the rooms its owner runs?
- Does the app roll a Test where the ruleset has not opted in? Dice stay physical.

#### Partial failure & side effects

- Does the whole action run inside one `db.transaction`?
- Is the broadcast sent only after the commit?
- If the transaction fails, is the client's `ActionResult` accurate, with nothing broadcast?

#### Race conditions & concurrency

- **Counters:** do they change by SQL delta, clamped to the evaluated min and max in the same statement, never by a
  read-modify-write in JS? Damage tracks the manifest marks `capped: false` go through `health.hit`, not the clamp.
- **Check-then-act:** is it inside the per-campaign gateway queue? A path that bypasses the queue (REST, scripts) needs a
  constraint or a conditional `UPDATE … WHERE`.
- **Socket auth:** is it resolved in the middleware before `connect`? Is it re-checked for revoked tokens where needed?

#### Scoping & data integrity

- Is every query scoped to `ctx.campaignId`? A ruleset migration scoped to (campaign, source version)?
- Is every ID from the client looked up within the campaign before use?
- Are foreign-key chains checked, e.g. a combatant belongs to the active encounter of *this* campaign?
- Do partial updates write only the fields sent (`const { type, id, ...patch } = a`)?

#### Hidden information

- Can a seat receive anything it shouldn't: hidden creature stats, GM notes, secrets, unrevealed codex entries, other
  players' tokens, another character's `owner` fields?
- Do new fields pass through `toViewerView`? Is a new field's visibility declared, and is the default still `gm`?
- Is a derived value as hidden as its most hidden input?
- Can a seatless caller reach pack content or a manifest through any path?

#### Permissions

- Does the action declare a permission, and does `authorize` run the state guard, then `canInCampaign`, then the
  action's validator?
- Is an `:own` permission checked against the seat's characters, never against `userId` alone?
- Can a member act on a seat at or above their own rank, or touch the owner? Can a cogm widen its own scopes?
- Does an admin with a seat get only that seat's rights (admin powers only through OPEN AS ADMIN)?
- Is the caller always the device user named by the it_device cookie (never an id from the client), and is admin only the x-admin-key header or socket adminKey, never a user?

#### External data & type safety

- Do imported manifests and packs, `jsonb` columns and socket payloads go through their zod schema?
- Is JSONB used only for a whole document? Filtered, joined, counted or referenced data must be columns or tables.
- Are there type assertions (`as`) on untrusted data? There should be none.

#### Edge cases

- Empty encounters, a group at 0 members, a resource row that does not exist yet, max below min, ties in initiative.
- A deleted character that is still a combatant, a revoked token with the socket still open, a demoted member's open
  socket, the last reader of a private handout being deleted.
- Empty arrays are truthy in JS.

### 4. 💡 Assess quality

Readability, maintainability, performance, organisation.

### 5. 💥 Detect breaking changes

Risks to:
- the `Action` union and the `LiveState` / `Codex` snapshot shapes (web and api must change together)
- stored data: the DB schema and migrations, `jsonb` shapes (`stat_snapshot`, manifests)
- the manifest and pack formats, and the primitive registry (a manifest that compiled must keep compiling)

For each risk: impact, mitigation, how to test.

### 6. 📝 Enforce clarity

Feedback is concise, actionable, and ranked by priority.

---

## Review Structure

```markdown
## 🧠 Logic Issues (review this FIRST)
- **Issue** / **Scenario** (a concrete failing case) / **Impact** / **Fix**

## ⚠️ Convention Violations
- **Issue** / **Convention** (the guide section) / **Fix**

## 💥 Potential Breaking Changes
- **Change** / **Impact** / **Mitigation** / **Testing**

## ✅ What Looks Good

## 💡 Suggestions & Improvements
```

---

## Critical Rules

1. **Don't omit any violation**, even a minor one.
2. **Treat the review as a pre-merge gate.**
3. **Say so explicitly** when the code fully complies.
4. **Cite the guide section,** or the rulebook page for a rules issue.
5. **Be constructive:** give a fix, not just a complaint.

---

## Checklist

### Logic (review FIRST)
- [ ] **Principles:** no book content committed or served seatless, rule entries cite pages, dice stay physical.
- [ ] **Rules:** primitives implement mechanics, not book numbers. Open engine choices recorded in `house-decisions.md`.
- [ ] **One action is one transaction.** The broadcast happens after the commit.
- [ ] **Counters use deltas** in SQL, clamped and capped per the rules.
- [ ] **Everything is scoped by `ctx.campaignId`.** Client IDs are verified.
- [ ] **The action declares its permission;** `authorize()` runs guard → `canInCampaign` → validator.
- [ ] **No hidden data reaches a seat** (`toViewerView`, declared visibility, fail-closed default).
- [ ] **`touches()` is updated** if the action changes the codex.

### Backend (`apps/api`)
- [ ] Feature folders (`core/`, `auth/`, `campaign/`, `actor/`, `encounter/`, `codex/`, `ruleset/`, `table/`). No global
      `schema.ts` or layer folders.
- [ ] Controllers and the gateway are thin. Logic lives in `*.actions.ts` or `*.service.ts`, with no Nest imports.
- [ ] Closed sets are defined once (a `z.enum` in `core-schema` or `rules-engine`). No inline literal unions (including `.$type<"a" | "b">`).
- [ ] No `any`. No `as` on untrusted data.
- [ ] More than two parameters (or same-type neighbours) means an options object; `tx` may stay first.
- [ ] Imports come from the defining module. No barrels inside apps.
- [ ] `async`/`await`. No `return await`. `Promise.all` for independent reads.
- [ ] Timestamps are timezone-aware, in UTC.
- [ ] Every new action or rule has a smoke-test assertion, including its refusal cases.
- [ ] A schema change has a regenerated migration. Pre-release, one migration is fine; after real data exists, add
      migrations and don't rewrite them.

### Frontend (`apps/web`)
- [ ] No `any`. Closed sets come from `@inconsistable/core-schema` or an `as const` object. No inline unions.
- [ ] Mutations only through `send(action)`. No Server Actions or REST for game state (the exceptions: owner-scoped
      work outside a table, and the admin page's allowlisted housekeeping through `TableGateway.run`; CLAUDE.md).
- [ ] `useEffect` only for external systems (socket, wake lock, device APIs), each with a comment.
- [ ] Request-time or identity work happens on the server (Server Component or route handler); `params` are awaited.
- [ ] Named handlers for anything beyond a one-statement setter.
- [ ] Object parameters. `async`/`await`. No `return await`.
- [ ] Kebab-case component folders, no `index.tsx`. Helpers in `lib/<name>/` with a test.
- [ ] Context values are memoized.
- [ ] Accessibility: visible focus, accessible names (action + target), associated labels, state never shown by colour
      alone, 12px minimum text, 44px touch targets.
- [ ] Colours only from CSS tokens (`var(--…)`). Raw values only in `lib/tokens`.
- [ ] Grid cells can't spill; checked at about 390px and 1180px wide.
- [ ] Rules numbers come from `@inconsistable/rules-engine`, never recomputed in the UI. No book text shown by default.

### Packages (`packages/*`)
- [ ] Engine functions are pure and unit tested; primitives implement mechanics, not one book's numbers.
- [ ] Manifest fixtures are our own writing, every rule entry has a `cite`, and the validator refuses uncited entries.
- [ ] `canInCampaign` tests cover the permission matrix, refusals included.
- [ ] Nothing from a pack is served without a seat; nothing copyrighted is committed.

### Security & cost
- [ ] The admin key is compared in constant time. Tokens and invite codes are stored hashed. Cookies are httpOnly,
      `sameSite=lax`, and `secure` in production.
- [ ] Expressions and dice are bounded (AST nodes, manifest size, N ≤ 100, X ≤ 1000, explosion depth ≤ 10).
- [ ] Payload sizes are bounded by the zod schemas (string and array `.max`).
- [ ] No unbounded fan-out per action. Broadcasts go to the campaign's rooms only.

---

## When to Block Merge

- ❌ **Invented or contradicted game rules,** book numbers hard-coded in an engine primitive, or a rule entry accepted
  without a page cite.
- ❌ **Book text, stat blocks, art or PDFs committed,** a PDF stored on the server, or pack content served without a seat.
- ❌ **Hidden-data leaks** to a seat, or an undeclared field that isn't hidden by default.
- ❌ **A permission check that can be bypassed:** an action without a declared permission, `:own` checked by `userId`
  alone, or a member acting on an equal or higher seat.
- ❌ **JSONB for data that is filtered, joined, counted by delta or referenced.**
- ❌ **Unscoped queries,** or client IDs used without checking they belong to the campaign.
- ❌ **Non-atomic multi-write,** or a read-modify-write on counters.
- ❌ **An action path that skips validate → authorize → transaction → broadcast.**
- ❌ **`any`,** or inline literal unions for closed sets.
- ❌ **Logic in a controller or the gateway** instead of `*.actions.ts` / `*.service.ts`.
- ❌ **A layer-based backend structure.**
- ❌ **New `useEffect` for data fetching,** or any `useEffect` without an external-system justification.
- ❌ **Server Actions or REST for game mutations** (outside the exceptions in CLAUDE.md: owner-scoped work outside a
  table, and `/api/admin` housekeeping, which must go through `TableGateway.run`).
- ❌ **A breaking snapshot or `Action` change** without updating both web and api and the smoke test.
- ❌ **Unhandled promise rejections** or swallowed errors.
- ❌ **A schema change without a migration.**

## When to Allow with Comments

- ⚠️ Minor naming or formatting deviations.
- ⚠️ Missing tests on non-critical paths (UI-only paths).
- ⚠️ Non-blocking performance or organisation suggestions.
- ⚠️ Documentation gaps.

---

## Final Note

If the code fully complies and breaks nothing, **say so explicitly**, e.g.:

> "Complies with all conventions. Rule entries cite their pages, no book content is committed or served seatless, the
> action declares its permission, runs in one transaction and is scoped, and no seat sees anything hidden. No breaking
> changes. Approvable."
