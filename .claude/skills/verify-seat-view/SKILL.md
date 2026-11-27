---
name: verify-seat-view
description: Exhaustive check that no seat (player phone, guest, TV screen, co-GM) receives an actor's hidden or owner-only values, ledger, items or spawn options unless it is on the GM side or holds that actor. Run it on any change to the seat view (apps/api-go/internal/view), permissions or seats (internal/coreschema/permissions.go, seat.go), or engine visibility (internal/engine/view.go).
---

# Verify the seat view

**Promise.** What each seat receives of the actors at a table contains a hidden (`gm`) value only for the GM side of
that actor's kind, and an `owner` value or the private parts (ledger, items, spawn options, owner id) only for the GM
side or the seat holding that actor.

**Harm if broken.** A player's phone, a guest, or the TV shows the GM's hidden stats, another player's secret
character values, or a character's build. The data goes out over the socket even when the UI hides it (CLAUDE.md
principle 4).

## What is checked, and how far

`apps/api-go/internal/view/seat_secrets_test.go`, `TestEverySeatReceivesOnlyItsActorValues`, calls the real `view.Of`
for **every** seat in this domain, in each table mode (`gm`, `gmless`, `solo`):

- a member as `gm`, `cogm` or `player`, with each of the 32 subsets of the co-GM scopes `party`, `session`,
  `combat`, `codex` and `codex.secrets`, as the owner, not the owner, or in an owner-less room, holding the character
  `pc-held` or nothing;
- a token as a guest `player` (holding `pc-held` or nothing) or the `screen`, owned by someone else or no one;
- an unseated admin.

That is 584 seats × 3 modes, about 8,600 actor views, in under a second. The snapshot has five actors: `pc-held`,
`pc-other`, a `companion`, an `npc` shown `full` in the encounter, and a hidden `creature`. Each has one field and one
resource of each visibility, plus an undeclared field `loose`, and each carries a ledger, an item and a spawn option.

Four properties, named in the failure messages:

| Name | Holds when |
| --- | --- |
| `hidden` | a `gm` value, or a value the manifest never declares, reaches a seat only on the GM side of that actor's kind |
| `owner` | an `owner` value reaches a seat only on that GM side or holding the actor |
| `private` | the ledger, items, spawn options and owner id reach a seat only on that GM side or holding the actor |
| `served` | the GM side of a kind does receive that kind's hidden values (the filter is not simply dropping everything) |

**The GM side** is the oracle `gmSideOf` in the test. It is written from house decision #31 and
`docs/adr/0009-table-modes.md`, not read from the code:

- an unseated admin, always;
- without a GM, nobody else;
- with a GM, the GM member, the room's owner, and a co-GM holding `party` (for `pc` and `companion`) or `combat` (for
  every other kind).

**Tool and why.** It is a plain Go test that enumerates the whole finite domain, so within it every input is checked,
not a sample. Go has no verifier the team could install and run on this code: Gobra needs Java and annotations
throughout. The domain is small enough that enumeration is complete, and it runs the real code, not a model. It needs
no new tool: Go 1.27 as in CLAUDE.md.

**Not covered.**

- The other parts of a seat view: codex entries, clocks, rolls, dealt cards, whispers, requests, Test targets, pools,
  journal mentions, the manifest a seat reads (`SeatManifest`). `nogm_test.go` and the vectors cover some of these with
  examples, not exhaustively.
- Conditions and derived values. Derived values go through the same `ToViewerView` but are not in the snapshot.
- Kinds other than the five above (`group`, `vehicle`, `hazard`). They take the non-character branch, which the `npc`
  and `creature` actors exercise.
- Whether the gateway sends each socket the view of its own seat, and whether `auth.ResolveSocketCtx` builds the right
  `Ctx`. The check starts from a `Ctx`.
- The TypeScript twin (`apps/api-go/vectors/reference/view.ts`). `bun run test:go` holds the two equal on its vectors.

## Does my change touch it?

Rerun when the diff touches any of these:

| File | Functions |
| --- | --- |
| `apps/api-go/internal/view/seat.go` | `Of`, `seatState`, `actorViews`, `toEngineView` |
| `apps/api-go/internal/view/sight.go` | `SightOf`, `ActorGmSide`, `RunsAsGm`, `HeldBy`, `isScreen`, `isOwner` |
| `apps/api-go/internal/engine/view.go` | `CanSee`, `keepVisible`, `ToViewerView` |
| `apps/api-go/internal/coreschema/permissions.go` | `CanInCampaign`, `GMPermOf`, `seatGrants`, `cogmScopesFor`, `tableRunGrants` |
| `apps/api-go/internal/coreschema/seat.go` | `Ctx.Role`, `Ctx.HasGM`, `Ctx.Mode`, the `Seat` kinds |

Also rerun when `cs.Actor` gains a field that is private to the GM side or the holder. Add that field to the
`private` check.

```bash
git diff --name-only 788d1ba8 -- apps/api-go/internal/view apps/api-go/internal/engine/view.go apps/api-go/internal/coreschema/permissions.go apps/api-go/internal/coreschema/seat.go
```

Any output means the covered code moved since the sync commit below.

## Run it

```bash
cd apps/api-go && go test ./internal/view -run TestEverySeatReceivesOnlyItsActorValues -count=1 -v
```

A pass ends with `584 seats × 3 modes, N actor views checked`, with N near 8,558. The test fails by itself if N drops
below 8,000, because then seats have stopped receiving actors and the check proves less.

That the check can still fail (run it after editing the test, or when in doubt):

```bash
bash .claude/skills/verify-seat-view/mutants.sh
```

It breaks the real code four ways, one per property, and requires the matching failure each time:

- `no-gm-branch-removed` removes the no-GM branch of `ActorGmSide`;
- `owner-ignores-holder` makes `CanSee` ignore who holds the actor;
- `ledger-kept` stops `seatState` clearing the ledger;
- `gm-side-served-as-player` stops `actorViews` treating the GM side as GM.

It restores the files after each mutant and refuses to run over uncommitted edits to them. Expect `4 of 4 mutants
caught`. `STALE` means a sed no longer matches the code. Update that mutant to break the same rule at its new place.

## Reading a failure

Each line names the property, the seat, the actor and the value, for example:

```
hidden: mode=gmless seat=member/player scopes=[] owner=u-other held=[] received npc's gm value fGm
```

This reads as: in a room without a GM, a plain member playing, who is not the owner and holds nothing, was sent the
NPC's hidden `fGm`. Decide which side is wrong:

- **A real leak.** The seat's row in the oracle matches the house decisions, and the code sends the value anyway.
  Report it with that line, and fix the product code only if the user asks.
- **An intended rule change.** A house decision or an ADR now puts this seat on the GM side, for example a new co-GM
  scope. Change `gmSideOf` in the same change, cite the decision in its comment, and rerun the mutants.
- **A modeling error.** The seat shape cannot occur. For example, a token with role `gm`: `auth.ResolveSocketCtx`
  only builds what `seatShapes` lists. Fix `seatShapes`, and name the code that rules the shape out.

Never widen `gmSideOf` or drop seats from `seatShapes` only to get a pass.

## Keeping it in step

**Sync commit: `788d1ba8`** (main, 2026-11-27). At that commit the covered files and functions above were read, the
check passed, and all four mutants were caught.

After a change that touches the covered code:

1. Rerun the check and the mutants.
2. Reread what changed against the oracle and the seat list.
3. Only when the check still describes the code, move the sync commit here to the new commit, in the same change.

A failed or skipped step leaves the sync commit where it is.
