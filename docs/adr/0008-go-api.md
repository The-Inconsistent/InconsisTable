# The api moves to Go, the web keeps a TypeScript engine

Status: accepted

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
  cannot stay connected by ignoring the packet. That close is not yet tested.
- **Oversized frames.** The Go library drops the frame but the client only leaves at the ping timeout, about 45 s later.
  The Go api has to close such a connection itself, promptly, because the smoke suite will require it once
  The-Inconsistent/InconsisTable#81 lands. How is not yet known or tested.
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
- Zod stays the contract for the web. How Go validates the same shapes is still open: generating JSON Schema from
  zod is the first candidate, and error messages that `refusal` copy depends on must match.
- `@the-inconsistent/inconsisid` has no Go client that this work has found, so sign-in needs one.
- `zishang520/socket.io` becomes a dependency the table cannot run without. It is a small project (last release
  2026-09-22). If it stalls, the fallback is plain WebSocket and a change to `use-table.ts`.
- Bun remains for the web, the seed and the smoke suite. CI needs a Go toolchain.
