import { splitMentions, type CodexEntry } from "@inconsistable/core-schema";
import { budgetOf, type Ruleset } from "@inconsistable/rules-engine";

import {
  enumWords,
  linkedEntry,
  rowChips,
  rowsOf,
  shownFields,
  tagsOf,
  tagWord,
  type ShownField,
} from "../entry-fields/entry-fields.ts";
import { groupLinks } from "../prep/prep.ts";
import {
  EMPTY_PREP,
  lineName,
  PREP_ORDER,
  type LineNames,
  type PrepWorld,
  type SummaryWords,
} from "../scene-prep/scene-prep.ts";
import { rosterPicks, spawnRoom } from "../spawn/spawn.ts";
import { testWords } from "../test-inputs/test-inputs.ts";

import type { PrintWords } from "./sheet.ts";

// The GM's run sheet (issue #4, house decision #152): one adventure's scenes in play order, each with what the GM reads
// aloud, what it links, the lines it prepared, the fight's budget and the GM's notes. Creatures show by name and count
// only; their numbers belong on the cards (principle 2).

export type RunLine = { label: string; items: string[] };
export type RunScene = {
  title: string;
  /** The scene's body: what the table hears once it is revealed, printed in a box to read aloud. */
  readAloud: string;
  fields: { label: string; value: string }[];
  links: RunLine[];
  lines: RunLine[];
  budget: string[];
  gmNotes: string;
};
export type RunSheet = { title: string; intro: string; gmNotes: string; scenes: RunScene[] };

/** A body with its mentions as plain titles (what the GM's own paper may name). */
export const plainText = (body: string): string =>
  splitMentions(body)
    .map((p) => ("text" in p ? p.text : p.title))
    .join("");

/** A declared field's value as words: an enum by its label, tags as words, rows as their chips, a link by its title. */
export function fieldText({
  ruleset,
  entries,
  field,
  t,
}: {
  ruleset: Ruleset | null;
  entries: readonly CodexEntry[];
  field: ShownField;
  t: PrintWords;
}): string {
  const { def, value } = field;
  if (def.type === "enum" && typeof value === "string") return enumWords({ def, value }).label;
  if (def.type === "tags")
    return tagsOf(value)
      .map((tag) => tagWord({ def, tag }))
      .join(", ");
  if (def.type === "rows")
    return rowsOf(value)
      .map((row) =>
        rowChips({ ruleset, def, row })
          .map((c) => c.text)
          .join(" "),
      )
      .join("; ");
  if (def.type === "entry") return linkedEntry({ entries, id: value })?.title ?? "—";
  if (typeof value === "boolean") return value ? t("yes") : t("no");
  return Array.isArray(value) ? value.join(", ") : String(value);
}

const fieldsOf = (args: {
  ruleset: Ruleset | null;
  entries: readonly CodexEntry[];
  entry: CodexEntry;
  t: PrintWords;
}) => shownFields(args).map((field) => ({ label: field.def.label, value: fieldText({ ...args, field }) }));

/** One scene as the run sheet prints it. `gm`: printed from the GM side, so it carries notes and Test outcomes. */
function runScene({
  scene,
  world,
  names,
  summary,
  t,
  gm,
}: {
  scene: CodexEntry;
  world: PrepWorld;
  names: LineNames;
  summary: SummaryWords;
  t: PrintWords;
  gm: boolean;
}): RunScene {
  const ruleset = world.ruleset ?? null;
  const { entries } = world;
  const prep = scene.prep ?? EMPTY_PREP;
  const links = groupLinks({ entry: scene, entries }).map((g) => ({
    label: t(`kind.${g.kind}`),
    items: g.entries.map((e) => {
      const fields = fieldsOf({ ruleset, entries, entry: e, t });
      return fields.length > 0 ? `${e.title} (${fields.map((f) => `${f.label}: ${f.value}`).join(", ")})` : e.title;
    }),
  }));
  const lines = PREP_ORDER.flatMap((kind) => {
    const items = prep[kind].map((line) => {
      const name = lineName({ kind, line, names, t: summary });
      const outcomes = gm && "outcomes" in line ? line.outcomes.map((o) => `${o.label}: ${o.text}`) : [];
      return [name, ...outcomes].join(" · ");
    });
    return items.length > 0 ? [{ label: t(`line.${kind}`), items }] : [];
  });
  // A scene's Tests planned before its lines (the older list); shown by the Test's label.
  const planned = scene.plannedTests.map((id) => testWords(names.test(id) ?? { id }).test);
  const bodies = new Map(
    world.spawnable.entries.flatMap((e) => (e.body ? [[`${e.pack}/${e.key}`, e.body] as const] : [])),
  );
  const budget =
    ruleset && prep.roster.length > 0
      ? budgetOf({ ruleset, picks: rosterPicks({ prep, bodies }), room: spawnRoom(world.state), switches: [] }).map(
          (l) =>
            l.budget === null
              ? t("budgetUnread", { label: l.label, used: l.used })
              : t("budgetLine", { label: l.label, used: l.used, budget: l.budget }),
        )
      : [];
  return {
    title: scene.title,
    readAloud: plainText(scene.body),
    fields: fieldsOf({ ruleset, entries, entry: scene, t }),
    links,
    lines: [...lines, ...(planned.length > 0 ? [{ label: t("line.planned"), items: planned }] : [])],
    budget,
    gmNotes: gm ? scene.gmNotes : "",
  };
}

/** An adventure's run sheet: its own text, then its scenes in the order given (the prep tree's play order). */
export function printRunSheet({
  adventure,
  scenes,
  world,
  names,
  summary,
  t,
  gm,
}: {
  adventure: CodexEntry;
  scenes: readonly CodexEntry[];
  world: PrepWorld;
  names: LineNames;
  summary: SummaryWords;
  t: PrintWords;
  gm: boolean;
}): RunSheet {
  return {
    title: adventure.title,
    intro: plainText(adventure.body),
    gmNotes: gm ? adventure.gmNotes : "",
    scenes: scenes.map((scene) => runScene({ scene, world, names, summary, t, gm })),
  };
}
