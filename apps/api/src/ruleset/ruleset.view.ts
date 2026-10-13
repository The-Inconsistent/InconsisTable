import type { Ruleset } from "@inconsistable/rules-engine";

/**
 * The manifest as a seat may read it. A GM-side seat reads all of it; any other seat gets the definitions of fields,
 * derived values, resources and conditions whose visibility is not `gm` (fail-closed: a definition that declares none
 * is `gm`). The values themselves are filtered separately, per actor, by `toViewerView`.
 * ponytail: a visible condition's effect formulas are shown as written, even where they name a `gm` field; strip or
 * redact them if a ruleset needs that secret kept
 */
export function manifestForSeat({ ruleset, gm }: { ruleset: Ruleset; gm: boolean }): Ruleset {
  if (gm) return ruleset;
  return {
    ...ruleset,
    entities: ruleset.entities.map((e) => ({
      ...e,
      fields: Object.fromEntries(Object.entries(e.fields).filter(([, f]) => f.visibility !== "gm")),
      derived: e.derived.filter((d) => d.visibility !== "gm"),
    })),
    resources: ruleset.resources.filter((r) => r.visibility !== "gm"),
    conditions: ruleset.conditions.filter((c) => c.visibility !== "gm"),
  };
}
