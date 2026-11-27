import type { Actor, ActorKind } from "@inconsistable/core-schema";

/** Which actors are shown as a stat block: everyone but a player's own character, whose sheet stays the sheet. */
export const showsStatBlock = (kind: ActorKind) => kind !== "pc";

type StatBlockProps = { actor: Pick<Actor, "name" | "kind">; children: React.ReactNode };

// A creature's stat block (house decision #219): the sheet's own cards under the creature's name; a player's character
// is its sheet, unwrapped. The name is the block's heading for a screen reader; on the screen the caller already shows
// it, so the base Themes keep it out of sight, and a World that picks the printed stat block draws it as the block's
// title bar (theme/world.css).
export function StatBlock({ actor, children }: StatBlockProps) {
  if (!showsStatBlock(actor.kind)) return children;
  return (
    <section className="stack stat-block" aria-label={actor.name}>
      <h2 className="stat-title sr-only">{actor.name}</h2>
      {children}
    </section>
  );
}
