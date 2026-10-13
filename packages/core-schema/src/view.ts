import { toSeatEncounter } from "./encounter.ts";
import { canInCampaign } from "./permissions.ts";
import type { Ctx } from "./seat.ts";
import type { ActorKind, Codex, CodexEntry, ConditionTimer, LiveState } from "./state.ts";
import { toSeatTests } from "./test-call.ts";

// What one seat may see of the two snapshots (docs/design.md §5.5). The gateway computes each once per distinct seat
// and never sends the raw snapshot to a non-GM seat. Ruleset values (actor fields, resources) are filtered by the
// rules engine's `toViewerView`; this file filters the core: access, sessions and the codex.

// Actors every seat sees by name: the party. NPCs, creatures and the rest stay on the GM side until a seat holds one.
const PARTY_KINDS: ReadonlySet<ActorKind> = new Set(["pc", "companion"]);

export function toSeatState({ state, ctx }: { state: LiveState; ctx: Ctx }): LiveState {
  const canParty = canInCampaign({ ctx, perm: "member:invite" });
  const gmNotes = canInCampaign({ ctx, perm: "codex:read_secret" });
  // The party or combat side of the table runs every actor; anyone else sees the party and whatever the seat holds.
  const allActors = canInCampaign({ ctx, perm: "character:edit:any" }) || canInCampaign({ ctx, perm: "encounter:run" });
  const held = ctx.seat.kind === "admin" ? [] : ctx.seat.characterIds;
  const actors = allActors
    ? state.actors
    : state.actors
        .filter((a) => PARTY_KINDS.has(a.kind) || held.includes(a.id))
        .map((a) => (held.includes(a.id) ? a : { ...a, ownerUserId: null }));
  return {
    ...state,
    actors,
    session: state.session && { ...state.session, notes: gmNotes ? state.session.notes : "" },
    tests: toSeatTests({ tests: state.tests, ctx }),
    encounter: toSeatEncounter({ encounter: state.encounter, ctx }),
    testDefs: canInCampaign({ ctx, perm: "test:call" }) ? state.testDefs : [],
    access: {
      ...state.access,
      // Invite codes are never in the snapshot, but who was invited for what is the GM side's business.
      invites: canParty ? state.access.invites : [],
    },
  };
}

// Whether a seat sees an entry at all. GM seats see everything; others only what is revealed to them.
export function seesEntry({ entry, ctx }: { entry: CodexEntry; ctx: Ctx }): boolean {
  if (canInCampaign({ ctx, perm: "codex:write" })) return true;
  if (entry.visibility === "gm") return false;
  if (entry.audienceMode === "all") return true;
  const held = ctx.seat.kind === "admin" ? [] : ctx.seat.characterIds;
  return entry.audience.some((a) => held.includes(a));
}

export function toSeatCodex({ codex, ctx }: { codex: Codex; ctx: Ctx }): Codex {
  const secrets = canInCampaign({ ctx, perm: "codex:read_secret" });
  const writer = canInCampaign({ ctx, perm: "codex:write" });
  return {
    entries: codex.entries
      .filter((entry) => seesEntry({ entry, ctx }))
      .map((entry) => ({
        ...entry,
        gmNotes: secrets ? entry.gmNotes : "",
        // A reader never learns who else an entry was shown to.
        audience: writer
          ? entry.audience
          : entry.audience.filter((a) => ctx.seat.kind !== "admin" && ctx.seat.characterIds.includes(a)),
      })),
  };
}

/** The durations of the conditions a viewer sees; `visible` is what the ruleset's viewer view left of the ids. */
export const visibleTimers = ({ timers, visible }: { timers: readonly ConditionTimer[]; visible: readonly string[] }) =>
  timers.filter((t) => visible.includes(t.id));
