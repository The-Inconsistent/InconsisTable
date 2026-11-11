# The api moves to Go, the web keeps a TypeScript engine

Status: accepted. The flip is done (2026-11-11): the Go api in `apps/api-go` is the api, and `apps/api` is deleted. See
"After the flip" at the end.

## Context

The api is NestJS on Bun: about 7,700 lines in `apps/api/src`, plus `packages/rules-engine` (about 5,100) and
`packages/core-schema` (about 1,450), which it shares with the web. The product owner wants Go for long-term ownership.
No performance or deployment problem drives this, so nothing here is justified by speed.

The web runs the engine in the browser too (`sheet-view.tsx`, `lib/builder`, `lib/roll-slots`), and principle 6 says the
server decides. If the browser and the server disagree, a sheet shows one number and the table resolves another.

A throwaway spike tested the risky parts on 2026-11-07, with Go 1.27.3.

## Decision

**Two engines, held identical by shared vectors.** The api gets a Go engine. The web keeps `packages/rules-engine`.
TypeScript generates test vectors, and CI fails when Go disagrees with them.

| Measured | TypeScript, whole engine | Go WASM, about a tenth of the engine |
| --- | --- | --- |
| Bundle, gzip | 116 KB (with zod) | 1.43 MB (1.05 MB brotli) |
| One expression, on one desktop | 11 µs | 164 µs, JSON scope included |
| Load | synchronous | asynchronous, about 100 ms, and the sheet computes during render |

WASM would give one engine, but it costs phones over 12 times the download for a fraction of the code. TinyGo was not
tried.

**The spike's vectors.** 43,838 vectors (16,118 expressions, 27,648 `dice.sumVsTarget` cases, 47 canonical JSON, the
rest hashes and dice shapes) gave 57,326 checks, and 2 failed. Six deliberate bugs in the Go code were all caught, so the
harness can see drift. The Go engine has to reproduce JavaScript in these places:

- Numbers stay `float64` with safe-integer checks, because arithmetic near 2^53 has to overflow where JavaScript does.
- `==` on lists and records is identity, so containers are pointers.
- Source positions and the length cap count UTF-16 units, and `\s` is JavaScript's whitespace set.
- Canonical JSON prints numbers the ES way (`1e+21`), sorts keys by UTF-16 units, and escapes nothing beyond
  `JSON.stringify`.

**Lone surrogates will be refused.** Those 2 failures are strings holding a lone surrogate: `encoding/json` replaces it
with U+FFFD, so the content hash changes. The Go api must refuse such strings at the boundary rather than store altered
text. That check is not built yet, and is marked in `pack_hash.go`. Before cutover, check that no stored row holds one.

**The socket stays Socket.IO, through `zishang520/socket.io` v3.** The web's client and `use-table.ts` do not change. The
same client script ran against socket.io on Bun and against the Go library under the race detector: refusal, handshake
auth and cookies, upgrade, both directions of ack, a 3 MB page, ack timeout, per-seat views and 64,000 broadcasts all
matched, with no race reported. Three differences need handling:

- **Kicks.** `disconnectSockets(true)` lost the disconnect packet: the client saw `transport close` on at least one socket
  in 25 of 30 rounds (Node 0 of 30), and `use-table` only reloads on `io server disconnect`. `disconnectSockets(false)` was
  clean in 30 of 30. The Go api kicks with `false`, then closes the transport itself after a grace period, so a client
  cannot stay connected by ignoring the packet. A Go test sees the packet first and the close after the 200 ms grace
  (`internal/table`).
- **Oversized frames.** The Go library drops the frame but the client only leaves at the ping timeout, about 45 s later.
  The Go api has to close such a connection itself, promptly, because the smoke suite will require it once
  The-Inconsistent/InconsisTable#81 lands. Over a websocket the library's read limit already closes with 1009, within
  milliseconds. Over polling it answers 413 but keeps the session, and a body sent without a length is cut short and
  dropped in silence; the gateway reads each polling POST first and closes the session when it is over the limit. Go
  tests cover both transports, each closing within 2 s.
- **Panics.** A panic in an event handler kills the process. Every handler runs behind a `recover`.

**The cut is one flip, not a proxy.** `apps/api-go` grows beside `apps/api` against the same Postgres schema, and is not
deployed until `apps/api/test/smoke.test.ts` passes against it. That suite is the spec, and it no longer imports api
source. It also reads and writes Postgres directly and runs with sign-in off, so it is not the whole gate: what only the
unit tests in `apps/api/src` cover, sign-in above all, gets Go tests before the flip. No traffic is split between two apis.

**What the flip keeps.** `apps/api` and its Nest and Drizzle code are deleted, but three things in that folder outlive it:

- The smoke suite and the seed move to a package of their own, which keeps `pg` and `socket.io-client`.
- The SQL migrations in `apps/api/drizzle` move to `apps/api-go`, which applies them at boot and treats the ones Drizzle
  already recorded as applied.
- From then on a schema change is a new SQL file written by hand, because `db:generate` goes with Drizzle.

**Order.** Engine, then core and device auth and the gateway, then features folder by folder, then sign-in last with a
security review against `docs/research/auth-service-security.md` and ASVS.

## Consequences

- Every engine change is written twice from now on, including every primitive the Wrath & Glory port adds. That cost
  does not end. This is the main price of the decision.
- Design D3 (`docs/design.md`) changes: api primitives are Go, and a QuickJS sandbox would need a Go host.
- Zod stays the contract for the web. `internal/schema` reproduces the zod behaviour these schemas use, including its
  wording, because importers read manifest refusals. Each schema is written out a second time in Go, and vectors check
  both on broken input. Problems about JSON object keys come back in sorted order, since decoded JSON has lost the order
  they were written in. Op input still uses the older readers in `op_input.go`, which match on refusal code only, since
  the api sends clients the code and the message only as detail (`ruleset.run.ts`). Socket actions and the book events
  are ported the same way (`coreschema/actions.go`): vectors match accept or refuse, and the parsed output with its
  defaults, but not the refusal text, which travels as `detail` only.
- Sign-in uses the Go twin of `@the-inconsistent/inconsisid`, `github.com/The-Inconsistent/InconsisID/packages/inconsisid-go`
  v0.2.2. Both SDKs store the same transaction JSON, so a sign-in started on one api finishes on the other. InconsisID
  is a private repository: CI needs `GOPRIVATE=github.com/The-Inconsistent` and a token that can read it (the
  workflow's own token reads only this repository), as the SDK's README shows.
- `zishang520/socket.io` becomes a dependency the table cannot run without. It is a small project (last release
  2026-09-22). If it stalls, the fallback is plain WebSocket and a change to `use-table.ts`.
- Bun remains for the web, the seed and the smoke suite. CI needs a Go toolchain.

## After the flip

The smoke suite passed 54 of 54 against the Go api, and `apps/api` went. What moved where:

- The smoke suite, its fixture and the seed: `apps/smoke` (`@inconsistable/smoke`), with `pg` and `socket.io-client`.
  `bun run test:smoke` and `bun run seed` run it against `API_URL` as before.
- The SQL migrations: `apps/api-go/migrations`, embedded in the binary (`migrations.FS`). The api records each file by
  name in `schema_migration`; a database the Nest api migrated counts the five files Drizzle recorded (by their journal
  time, `migrations.Drizzle`) as applied. A schema change is a new hand-written SQL file there.
- The TypeScript seat view (`apps/api/src/view`, with its test): `apps/api-go/vectors/reference`, the reference
  `vectors/table.ts` runs and `internal/view` is held to. A change to what a seat sees is made in both.
- The folder stays `apps/api-go`, not renamed to `apps/api`, to keep the churn down.
- CI and the api image need a token that can read InconsisID: the secret `INCONSISID_READ_TOKEN` (CI) and the build
  secret `inconsisid_token` (`deploy/compose.yaml`, `docs/deploy.md`).

The Nest api's unit tests in `apps/api/src` went with it, the seat view's excepted. What only they covered was to get Go
tests before the flip (above); the flip itself did not audit that again. Comments in the Go code that name a file under `apps/api/src` point at the Nest api as it was at
commit `7970a32`, the last one that has it.
