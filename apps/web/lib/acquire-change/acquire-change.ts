import type { Ruleset } from "@inconsistable/rules-engine";

// What the GM may change of an acquisition's entry when approving it (house decision #196): the entry type's number and
// choice fields, and its tags. Blank keeps the pack's value; the server checks each value again.

/** A field the change form offers: its id, label, and the choices of an enum field with their words. */
export type ChangeField = { id: string; label: string; options?: readonly { value: string; label: string }[] };

/** The entry type's whole-number and choice fields, in the manifest's order. */
export function changeFields({ ruleset, type }: { ruleset: Pick<Ruleset, "entities">; type: string }): ChangeField[] {
  const entity = ruleset.entities.find((e) => e.id === type);
  return Object.entries(entity?.fields ?? {}).flatMap(([id, f]): ChangeField[] =>
    f.type === "int"
      ? [{ id, label: f.label }]
      : f.type === "enum"
        ? [{ id, label: f.label, options: f.values.map((v) => ({ value: v, label: f.labels?.[v] ?? v })) }]
        : [],
  );
}

/**
 * The `item` of request.approve from what the GM typed: a number field's whole number, a choice as picked, the tags
 * split at commas; undefined when nothing was changed. A number that is not whole is left out.
 */
export function itemChange({
  fields,
  typed,
  tags,
}: {
  fields: readonly ChangeField[];
  typed: Readonly<Record<string, string>>;
  tags: string;
}): { fields?: Record<string, number | string>; tags?: string[] } | undefined {
  const changed: Record<string, number | string> = {};
  for (const f of fields) {
    const v = (typed[f.id] ?? "").trim();
    if (v === "") continue;
    if (f.options !== undefined) changed[f.id] = v;
    else if (/^-?\d+$/.test(v)) changed[f.id] = Number(v);
  }
  const words = tags
    .split(",")
    .map((w) => w.trim())
    .filter((w) => w !== "");
  const out = {
    ...(Object.keys(changed).length > 0 ? { fields: changed } : {}),
    ...(words.length > 0 ? { tags: words } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}
