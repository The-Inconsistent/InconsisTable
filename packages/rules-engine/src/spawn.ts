import { nestFields, type FieldValue } from "./derived.ts";
import { ExprError, type ExprRecord, type ExprValue } from "./expr/expr.ast.ts";
import { evaluate } from "./expr/expr.eval.ts";
import { parseExpr } from "./expr/expr.parser.ts";
import type { Ruleset } from "./manifest.ts";
import { own } from "./own.ts";
import { refuse, type Refusal } from "./primitives/primitive.ts";

// House decision #92: what spawning a pack entry carries. `planSpawn` says which options the actor keeps and what the
// adjustments add, fixed at spawn; `budgetOf` reads the encounter budget's lines. Both read the manifest's own text, as
// `planSpend` does; `compileRuleset` has type-checked every expression.

/** The room a spawn reads: `campaign`, and `party` with `seated` (the characters held by a member's seat). */
export interface SpawnRoom {
  campaign: Readonly<Record<string, number | string | boolean>>;
  characters: number;
  seated: number;
}

export interface SpawnPlan {
  /** The options the actor keeps, in the order chosen. */
  options: string[];
  /** The entry's values with each adjustment's field adds. */
  fields: Record<string, FieldValue>;
  /** What the adjustments add to each resource's starting value. */
  resources: Record<string, number>;
}

function read(source: string, scope: ExprRecord): ExprValue | undefined {
  try {
    return evaluate({ node: parseExpr(source), scope });
  } catch (err) {
    if (err instanceof ExprError) return undefined;
    throw err;
  }
}

const roomScope = (room: SpawnRoom): ExprRecord => ({
  party: { characters: room.characters, seated: room.seated },
  campaign: room.campaign,
});

/** The scope of one entry's values at spawn. */
export const spawnScope = ({
  values,
  room,
  ctx,
}: {
  values: Readonly<Record<string, FieldValue>>;
  room: SpawnRoom;
  ctx: ExprRecord;
}): ExprRecord => ({ ...nestFields(values), ...roomScope(room), ctx });

/**
 * One entry spawned as an actor of `entity`, with the options chosen: `noSuchOption` for an id the ruleset does not
 * declare, `optionNotHere` for one not for this actor type, or whose `when` does not hold for this entry (or cannot be
 * read). An adjustment that does not apply, or an `add` that cannot be read, adds nothing; a field the entry does not
 * list stays absent.
 */
export function planSpawn({
  ruleset,
  entity,
  values,
  options,
  room,
  mob,
}: {
  ruleset: Pick<Ruleset, "spawn" | "entities" | "resources">;
  entity: string;
  values: Readonly<Record<string, FieldValue>>;
  options: readonly string[];
  room: SpawnRoom;
  mob: boolean;
}): SpawnPlan | Refusal {
  const scope = spawnScope({ values, room, ctx: { mob } });
  const declared = ruleset.spawn?.options ?? [];
  for (const id of options) {
    const o = declared.find((x) => x.id === id);
    if (o === undefined) return refuse("noSuchOption", `no spawn option "${id}"`);
    if (
      (o.entities !== undefined && !o.entities.includes(entity)) ||
      (o.when !== undefined && read(o.when, scope) !== true)
    )
      return refuse("optionNotHere", `"${o.label}" is not for this entry`);
  }
  const def = ruleset.entities.find((e) => e.id === entity);
  const fields: Record<string, FieldValue> = { ...values };
  const resources: Record<string, number> = {};
  for (const a of ruleset.spawn?.adjust ?? []) {
    if (a.option !== undefined && !options.includes(a.option)) continue;
    if (a.entities !== undefined && !a.entities.includes(entity)) continue;
    if (a.when !== undefined && read(a.when, scope) !== true) continue;
    for (const key of Object.keys(a.add).sort()) {
      const n = read(a.add[key] ?? "", scope);
      if (typeof n !== "number") continue;
      if (own(def?.fields ?? {}, key)?.type === "int") {
        const had = own(fields, key);
        if (typeof had === "number") fields[key] = had + n;
      } else if (ruleset.resources.some((x) => x.id === key)) resources[key] = (resources[key] ?? 0) + n;
    }
  }
  return { options: [...options], fields, resources };
}

/** One group of creatures a budget line counts: an entry's values, how many, and whether as a mob. */
export interface BudgetPick {
  values: Readonly<Record<string, FieldValue>>;
  count: number;
  mob: boolean;
}

/** One budget line read: what the picks cost and the budget; null where it cannot be read. */
export interface BudgetLine {
  id: string;
  label: string;
  used: number;
  budget: number | null;
}

/**
 * The encounter budget's lines for the picks so far, with the switches that are on (house decision #92). A pick whose
 * cost cannot be read costs nothing. A reading aid: nothing is refused or stored.
 */
export function budgetOf({
  ruleset,
  picks,
  room,
  switches,
}: {
  ruleset: Pick<Ruleset, "spawn">;
  picks: readonly BudgetPick[];
  room: SpawnRoom;
  switches: readonly string[];
}): BudgetLine[] {
  const b = ruleset.spawn?.budget;
  if (b === undefined) return [];
  return b.lines.map((l) => {
    let used = 0;
    for (const p of picks) {
      const v = read(l.cost, spawnScope({ values: p.values, room, ctx: { count: p.count, mob: p.mob } }));
      if (typeof v === "number") used += v;
    }
    let budget = read(l.budget, roomScope(room));
    for (const s of b.switches ?? []) {
      if (!switches.includes(s.id) || typeof budget !== "number") continue;
      budget = read(s.by, { ...roomScope(room), ctx: { budget } });
    }
    return { id: l.id, label: l.label, used, budget: typeof budget === "number" ? budget : null };
  });
}
