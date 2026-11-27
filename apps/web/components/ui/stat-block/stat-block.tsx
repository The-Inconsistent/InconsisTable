import type { Actor, ActorKind } from "@inconsistable/core-schema";

/** Which actors are shown as a stat block: everyone but a player's own character, whose sheet stays the sheet. */
export const showsStatBlock = (kind: ActorKind) => kind !== "pc";

type StatBlockProps = {
  actor: Pick<Actor, "name" | "kind">;
  /** The container already names the creature (a bottom sheet's title): the block's own name is then drawn only. */
  named?: boolean;
  children: React.ReactNode;
};

// A creature's stat block (house decision #219): the sheet's own cards under the creature's name; a player's character
// is its sheet, unwrapped. The name is the block's heading for a screen reader; on the screen the caller already shows
// it, so the base Themes keep it out of sight, and a World that picks the printed stat block draws it as the block's
// title bar (theme/world.css). Where the container names it already, it is not read a second time.
export function StatBlock({ actor, named = false, children }: StatBlockProps) {
  if (!showsStatBlock(actor.kind)) return children;
  return (
    <section className="stack stat-block" aria-label={named ? undefined : actor.name}>
      <h2 className="stat-title sr-only" aria-hidden={named || undefined}>
        {actor.name}
      </h2>
      {children}
    </section>
  );
}
