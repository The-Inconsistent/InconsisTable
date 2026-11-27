import type { CodexEntry, LiveState } from "@inconsistable/core-schema";
import type { ChecklistAnchor, ChecklistRoom } from "@inconsistable/rules-engine";

/** The element id of a place a checklist step's GO TO lands on (house decision #200). */
export const anchorId = (anchor: ChecklistAnchor) => `goto-${anchor}`;

/**
 * GO TO's landing, as Auspex's revealAnchor: opens the fold the place is in (or the place, when it is one), scrolls to
 * it and puts it in focus. False while the tab has not drawn it yet.
 */
export function revealAnchor(anchor: ChecklistAnchor): boolean {
  const el = document.getElementById(anchorId(anchor));
  if (el === null) return false;
  const fold = el instanceof HTMLDetailsElement ? el : el.closest("details");
  if (fold !== null) fold.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.focus({ preventScroll: true });
  return true;
}

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
