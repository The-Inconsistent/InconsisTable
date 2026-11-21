import type { Actor, LiveState, SpendRequest } from "@inconsistable/core-schema";
import {
  acquiredKinds,
  planAcquire,
  type AcquirePlan,
  type CompiledRuleset,
  type ItemKind,
  type Refusal,
  type Ruleset,
} from "@inconsistable/rules-engine";

import type { RulesEntry } from "@/lib/library/library";
import { spendWorld } from "@/lib/spends/spends";

// Acquiring an item by a Test (house decision #102), as the phone previews it: the kinds the character may acquire, what
// the acquisition asks of the Test for an entry picked from the room's packs, and the ask waiting on the GM. The server
// works it out again when the GM calls it; this preview shows the same parts.

/** The kinds the ruleset lets this character acquire. */
export function acquireKinds({ ruleset, actor }: { ruleset: Ruleset; actor: Pick<Actor, "entity"> }): ItemKind[] {
  const items = ruleset.items;
  if (items?.acquire === undefined) return [];
  return acquiredKinds(items, items.acquire).filter((k) => k.entities.includes(actor.entity));
}

/** The picks an ask starts with: each at 0 within its bounds, else its least. */
export const startPicks = (ruleset: Ruleset): Record<string, number> =>
  Object.fromEntries(Object.entries(ruleset.items?.acquire?.picks ?? {}).map(([id, p]) => [id, Math.max(p.min, 0)]));

/** What acquiring the entry asks of the character's Test now, or why it cannot be asked. */
export function previewAcquire({
  ruleset,
  compiled,
  table,
  actor,
  characters,
  entry,
  picks,
}: {
  ruleset: Ruleset;
  compiled: CompiledRuleset | null;
  table: Pick<LiveState, "pools" | "encounter" | "campaign">;
  actor: Actor;
  characters: number;
  entry: Pick<RulesEntry, "type" | "key" | "name" | "tags" | "body">;
  picks: Readonly<Record<string, number>>;
}): AcquirePlan | Refusal {
  const world = spendWorld({ ruleset, compiled, table, actor, characters });
  const item = { type: entry.type, key: entry.key, name: entry.name, tags: entry.tags, body: entry.body };
  return planAcquire({ ruleset, actor: world.actor, item, picks });
}

/** The acquisition this character has waiting on the GM, if any. */
export const waitingAcquire = ({ requests, actorId }: { requests: readonly SpendRequest[]; actorId: string }) =>
  requests.find((q) => q.acquire !== undefined && q.actorId === actorId);
