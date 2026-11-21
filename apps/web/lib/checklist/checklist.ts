import type { CodexEntry, LiveState } from "@inconsistable/core-schema";
import type { ChecklistRoom } from "@inconsistable/rules-engine";

/**
 * What the setup checklist counts (house decision #90), from what the GM's page already holds: the live state, the
 * codex and the packs attached to the room. Nothing is read or stored for it.
 */
export function checklistRoom({
  state,
  entries,
  packs,
}: {
  state: Pick<LiveState, "actors" | "campaign" | "pools" | "journal">;
  entries: readonly CodexEntry[];
  packs: readonly { slug: string }[];
}): ChecklistRoom {
  return {
    entries: entries.map((e) => ({ kind: e.kind, fields: e.fields, prep: e.prep })),
    actors: state.actors.map((a) => ({ entity: a.entity, built: a.ledger !== null })),
    campaignFields: state.campaign.fields,
    pools: state.pools.map((p) => ({ id: p.id, value: p.value })),
    sessions: state.journal.length,
    packs,
    safety: state.campaign.safety,
  };
}
