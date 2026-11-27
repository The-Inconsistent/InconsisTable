import type { Actor } from "@inconsistable/core-schema";
import {
  actorScope,
  campaignValues,
  evaluate,
  parseExpr,
  planLookup,
  type CompiledRuleset,
  type LookupPlan,
  type LookupStep,
  type RandomTable,
  type Ruleset,
} from "@inconsistable/rules-engine";

// Lookups on the GM's tables panel (house decision #87): what a typed result does to the target, worked out with the
// engine function the server runs, from the values the GM side holds. The server's answer is the one that counts.

type Target = Pick<Actor, "id" | "name" | "entity" | "fields" | "derived" | "resources">;

/** A table the GM applies to a target: one with a line that has effects. */
export const appliesTo = (t: RandomTable): boolean => t.entries.some((e) => e.apply !== undefined);

/**
 * The pack entry types a table's grants name records of (house decision #88), which the panel loads so its preview
 * names the record rather than its key.
 */
export const grantTypesOf = ({ ruleset, table }: { ruleset: Pick<Ruleset, "held">; table: RandomTable }): string[] => [
  ...new Set(
    table.entries.flatMap((e) =>
      (e.apply ?? []).flatMap((x) => {
        const entry = x.kind === "grant" ? ruleset.held?.[x.held]?.entry : undefined;
        return entry === undefined ? [] : [entry];
      }),
    ),
  ),
];

/** Whether the table reads anything of a lookup: effects, inputs, a modifier, a line naming the next table. */
export const isLookupTable = (t: RandomTable): boolean =>
  appliesTo(t) || t.inputs !== undefined || t.modifier !== undefined || t.entries.some((e) => e.next !== undefined);

/** Who a lookup can be for: the fight's combatants first, in the fight's order, then everyone else with a type. */
export function targetsOf<A extends Pick<Actor, "id" | "entity">>({
  actors,
  fighting,
}: {
  actors: readonly A[];
  fighting: readonly string[];
}): { fighting: A[]; others: A[] } {
  const typed = actors.filter((a) => a.entity !== "");
  const byId = new Map(typed.map((a) => [a.id, a]));
  return {
    fighting: fighting.flatMap((id) => byId.get(id) ?? []),
    others: typed.filter((a) => !fighting.includes(a.id)),
  };
}

/**
 * What the typed result does to the target, as the server will work it out; null without a whole number or a target.
 * `shockless`: the target's harm profile says it never takes shock, so the server leaves a hit's shock out (#163).
 */
export function previewOf({
  compiled,
  tableId,
  result,
  inputs,
  target,
  characters,
  campaign,
}: {
  compiled: CompiledRuleset;
  tableId: string;
  result: number | null;
  inputs: Readonly<Record<string, number | boolean>>;
  target: Target | undefined;
  characters: number;
  campaign: Readonly<Record<string, unknown>>;
}): (LookupPlan & { shockless: boolean }) | null {
  if (target === undefined || result === null || !Number.isInteger(result)) return null;
  const scope = actorScope({
    fields: target.fields,
    derived: target.derived,
    resources: target.resources,
    party: { characters },
    campaign: campaignValues({ compiled, stored: campaign }),
  });
  const profile = compiled.ruleset.health.harm?.profiles.find((p) => p.entities.includes(target.entity));
  let shockless = false;
  try {
    shockless = profile?.shockless !== undefined && evaluate({ node: parseExpr(profile.shockless), scope }) === true;
  } catch {
    // A value the GM side cannot read yet: the preview shows the shock, the server decides.
  }
  return { ...planLookup({ compiled, tableId, result, inputs, scope }), shockless };
}

/** Steps in order, each run of equal ones as one line with its count ("Dazed ×2"). */
export function groupSteps(steps: readonly LookupStep[]): { step: LookupStep; count: number }[] {
  const out: { step: LookupStep; count: number }[] = [];
  for (const step of steps) {
    const last = out.at(-1);
    if (last && JSON.stringify(last.step) === JSON.stringify(step)) last.count++;
    else out.push({ step, count: 1 });
  }
  return out;
}

/** The typed number, or null for anything that is not a whole number. */
export function typedOf(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(n) ? n : null;
}
