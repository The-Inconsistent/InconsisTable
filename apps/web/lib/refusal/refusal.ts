/** A refused action in the fight tracker: the api's words, and the combatant whose panel sent it (null: the tracker). */
export type Refusal = { text: string; from: string | null };

/** What an action's answer leaves: its refusal, tied to where it came from; a success clears any refusal. */
export function afterAnswer({
  result,
  from,
}: {
  result: { ok: true } | { ok: false; error: string };
  from: string | null;
}) {
  return result.ok ? null : { text: result.error, from };
}

/** Selecting a combatant clears a refusal, unless it is the one already selected (a tap on the same row). */
export function afterSelect({ refusal, was, now }: { refusal: Refusal | null; was?: string; now: string }) {
  return was === now ? refusal : null;
}

/** The refusal shown at one place: a combatant's panel (its id), or the tracker's own line (null). */
export function refusalAt({ refusal, at }: { refusal: Refusal | null; at: string | null }) {
  return refusal !== null && refusal.from === at ? refusal.text : null;
}
