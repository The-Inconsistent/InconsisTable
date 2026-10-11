import { canInCampaign } from "./permissions.ts";
import type { Ctx } from "./seat.ts";
import type { Codex, CodexEntry, LiveState } from "./state.ts";

// What one seat may see of the two snapshots (docs/design.md §5.5). The gateway computes each once per distinct seat
// and never sends the raw snapshot to a non-GM seat. Ruleset values (actor fields, resources) are filtered by the
// rules engine's `toViewerView`; this file filters the core: access, sessions and the codex.

export function toSeatState({ state, ctx }: { state: LiveState; ctx: Ctx }): LiveState {
  const canParty = canInCampaign({ ctx, perm: "member:invite" });
  const gmNotes = canInCampaign({ ctx, perm: "codex:read_secret" });
  return {
    ...state,
    session: state.session && { ...state.session, notes: gmNotes ? state.session.notes : "" },
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
