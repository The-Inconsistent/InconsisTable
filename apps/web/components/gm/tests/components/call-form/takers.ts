import type { TestDef } from "@inconsistable/core-schema";

type Taker = { entity: string };

// The actors that can take a Test: every built actor, or only those of the entity types the Test names
// (docs/house-decisions.md #50; the server refuses the others).
export function takers<A extends Taker>({
  actors,
  def,
}: {
  actors: A[];
  def: Pick<TestDef, "entities"> | undefined;
}): A[] {
  const built = actors.filter((a) => a.entity !== "");
  const types = def?.entities;
  return types ? built.filter((a) => types.includes(a.entity)) : built;
}

// The picked actor ids that still take the Test.
export function keepTakers<A extends Taker & { id: string }>({
  picked,
  actors,
  def,
}: {
  picked: string[];
  actors: A[];
  def: Pick<TestDef, "entities"> | undefined;
}): string[] {
  const ok = new Set(takers({ actors, def }).map((a) => a.id));
  return picked.filter((id) => ok.has(id));
}
