import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset, Ruleset, toViewerView } from "@inconsistable/rules-engine";

import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { printSheet, type PrintActor, type PrintWords } from "./sheet.ts";

const base = Ruleset.parse(SAMPLE_D20);
// The sample's character layout, with a section that names the GM's own note.
const ruleset = Ruleset.parse({
  ...SAMPLE_D20,
  layout: {
    ...SAMPLE_D20.layout,
    character: {
      sections: [
        ...(base.layout.character?.sections ?? []),
        { id: "secret", label: "Secret", show: ["gmNote", "level"] },
      ],
    },
  },
});
const t: PrintWords = (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key);

const full: PrintActor = {
  name: "Ash",
  entity: "character",
  fields: {
    name: "Ash",
    level: 3,
    size: "medium",
    "attr.str": 14,
    "attr.dex": 16,
    "attr.con": 12,
    guard: 11,
    diary: "",
    gmNote: "Secretly the heir",
    strain: 4,
  },
  resources: { hp: 9, tempHp: 0, focus: 1 },
  derived: { initBonus: 3, maxHp: 15, defense: 14, mightMod: 2, graceMod: 3, gritMod: 1 },
  conditions: ["dazed"],
};

// What a seat receives of the character, as the server cuts it down (toViewerView).
function seen(role: "gm" | "player"): PrintActor {
  const compiled = compileRuleset(ruleset);
  assert.ok(compiled.ok);
  const [view] = toViewerView({
    compiled: compiled.compiled,
    viewer: { role, characterIds: role === "player" ? ["ash"] : [] },
    actors: [{ id: "ash", ...full }],
  }).actors;
  assert.ok(view);
  // The values it kept, as the actor's own (the view's are read-only).
  const fields = Object.fromEntries(Object.entries(full.fields).filter(([k]) => Object.hasOwn(view.fields, k)));
  return { ...full, fields, resources: { ...view.resources }, derived: { ...view.derived } };
}

test("a GM-only value prints on the GM's sheet and never on the player's", () => {
  const gm = JSON.stringify(printSheet({ ruleset, actor: seen("gm"), t }));
  const player = JSON.stringify(printSheet({ ruleset, actor: seen("player"), t }));
  assert.ok(gm.includes("Secretly the heir"));
  assert.ok(gm.includes("GM note"));
  assert.ok(!player.includes("Secretly the heir"));
  assert.ok(!player.includes("GM note"));
  assert.ok(player.includes('"Level"')); // the section stays for what the seat does see
});

test("what a pencil changes prints blank: a track as boxes, a resource row as an empty box with its limit", () => {
  const sheet = printSheet({ ruleset, actor: full, t, maxOf: (r) => (r === "tempHp" ? 5 : null) });
  const vigour = sheet.sections.find((s) => s.title === "Vigour");
  assert.ok(vigour);
  assert.deepEqual(vigour.blocks[0], { kind: "boxes", label: "Vigour", boxes: 15, cite: "Sample p.5" });
  const temp = vigour.blocks[1];
  assert.ok(temp?.kind === "cells");
  assert.deepEqual(temp.cells[0], { label: "Spare Vigour", value: "", cite: "Sample p.5", pencil: true, max: "5" });
  // Focus has no limit this page can work out here: a box to write the count in.
  const focus = vigour.blocks[2];
  assert.ok(focus?.kind === "cells" && focus.cells[0]?.pencil && focus.cells[0].value === "");
  const strain = sheet.sections.find((s) => s.title === "Strain")?.blocks[0];
  assert.ok(strain?.kind === "pips");
  assert.deepEqual(
    strain.steps.map((s) => s.size),
    [3, 3, 3],
  );
});

test("fixed values print: a grid as a table with its bonus column, a strip and a sum as boxes", () => {
  const sheet = printSheet({ ruleset, actor: full, t });
  const grid = sheet.sections.find((s) => s.title === "Abilities")?.blocks[0];
  assert.ok(grid?.kind === "table");
  assert.deepEqual(grid.head, ["name", "rating", "bonus"]);
  assert.deepEqual(grid.rows[0], ["Might", "14", "+2"]);
  const who = sheet.sections.find((s) => s.title === "Character")?.blocks[0];
  assert.ok(who?.kind === "cells");
  assert.deepEqual(
    who.cells.map((c) => c.value),
    ["Ash", "3", "medium"],
  );
});

test("an empty note leaves ruled lines; the conditions print with room for more", () => {
  const sheet = printSheet({ ruleset, actor: full, t });
  const diary = sheet.sections.find((s) => s.title === "Notes")?.blocks[0];
  assert.deepEqual(diary, { kind: "text", label: "Diary", text: "", lines: 3 });
  const conditions = sheet.sections.at(-1);
  assert.equal(conditions?.title, "conditions");
  assert.deepEqual(conditions?.blocks[0], { kind: "text", label: "", text: "Dazed", lines: 2 });
});

test("an entity with no layout prints its derived values, resources and fields under the built-in titles", () => {
  const plain = Ruleset.parse({ ...SAMPLE_D20, layout: {} });
  const sheet = printSheet({ ruleset: plain, actor: { ...full, conditions: [] }, t });
  assert.deepEqual(
    sheet.sections.map((s) => s.title),
    ["section.derived", "section.resources", "section.fields", "conditions"],
  );
});
