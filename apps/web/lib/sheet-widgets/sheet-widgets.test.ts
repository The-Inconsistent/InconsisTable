import assert from "node:assert/strict";
import { test } from "node:test";

import { Ruleset, type WidgetRow } from "@inconsistable/rules-engine";

import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import {
  effectOf,
  ledgerLaidOut,
  pipsFilled,
  rowFor,
  signed,
  stepReached,
  type SheetActor,
  widgetOf,
} from "./sheet-widgets.ts";

const ruleset = Ruleset.parse(SAMPLE_D20);
const actor: SheetActor = {
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
  },
  resources: { hp: 9, tempHp: 0 },
  derived: { initBonus: 3, maxHp: 15, defense: 14, mightMod: 2, graceMod: 3 },
};
const row = (r: Partial<WidgetRow> & { widget: string }): WidgetRow => ({ bind: {}, ...r });
const model = (r: Partial<WidgetRow> & { widget: string }, a: SheetActor = actor) =>
  widgetOf({ ruleset, actor: a, row: row(r) });

test("a path names a field, else a derived value, else a resource; a prototype key names nothing", () => {
  assert.equal(rowFor({ ruleset, actor, path: "guard" })?.kind, "field");
  assert.equal(rowFor({ ruleset, actor, path: "defense" })?.kind, "derived");
  assert.equal(rowFor({ ruleset, actor, path: "tempHp" })?.kind, "resource");
  assert.equal(rowFor({ ruleset, actor, path: "constructor" }), null);
  assert.equal(rowFor({ ruleset, actor, path: "res.focus" }), null); // not sent to this seat
});

test("strip: the values the seat holds; nothing at all draws nothing", () => {
  const m = model({ widget: "strip", bind: { title: "name", values: ["level", "gmNote", "size"] } });
  assert.ok(m?.widget === "strip");
  assert.equal(m.title?.id, "name");
  assert.deepEqual(
    m.values.map((v) => v.id),
    ["level", "size"],
  );
  assert.equal(model({ widget: "strip", bind: { title: "gmNote", values: ["gmNote"] } }), null);
});

test("grid: a rating the seat lacks drops its row, and a column is drawn only when every row has it", () => {
  const m = model({
    widget: "grid",
    bind: {
      ratings: ["attr.str", "attr.dex", "attr.con"],
      bonus: ["derived.mightMod", "derived.graceMod", "derived.gritMod"],
    },
  });
  assert.ok(m?.widget === "grid");
  assert.equal(m.variant, "columns");
  assert.equal(m.rows.length, 3);
  assert.deepEqual(m.columns, { bonus: false, total: false, link: false }); // gritMod was not sent
  const two = model({
    widget: "grid",
    bind: { ratings: ["attr.str", "attr.dex", "gmNote"], bonus: ["derived.mightMod", "derived.graceMod", "x"] },
  });
  assert.ok(two?.widget === "grid");
  assert.deepEqual(
    two.rows.map((r) => r.bonus?.id),
    ["mightMod", "graceMod"],
  );
  assert.equal(two.columns.bonus, true);
  assert.equal(model({ widget: "grid", bind: { ratings: ["gmNote"] } }), null);
  const pairs = model({ widget: "grid", variant: "pairs", bind: { ratings: ["guard"], link: ["attr.dex"] } });
  assert.ok(pairs?.widget === "grid" && pairs.variant === "pairs" && pairs.columns.link);
});

test("frames: only the values the seat holds", () => {
  const m = model({ widget: "frames", bind: { values: ["derived.initBonus", "derived.gritMod"] } });
  assert.ok(m?.widget === "frames");
  assert.deepEqual(
    m.values.map((v) => v.id),
    ["initBonus"],
  );
  assert.equal(model({ widget: "frames", bind: { values: ["derived.gritMod"] } }), null);
});

test("sum: without its total nothing, and without every part the total alone", () => {
  const whole = model({ widget: "sum", bind: { parts: ["guard", "derived.initBonus"], total: "derived.defense" } });
  assert.ok(whole?.widget === "sum");
  assert.equal(whole.parts.length, 2);
  const partial = model({ widget: "sum", bind: { parts: ["guard", "derived.gritMod"], total: "derived.defense" } });
  assert.ok(partial?.widget === "sum");
  assert.deepEqual(partial.parts, []);
  assert.equal(model({ widget: "sum", bind: { parts: ["guard"], total: "derived.gritMod" } }), null);
});

test("track and pips: without their value nothing; a limit the seat lacks is left out", () => {
  const t = model({ widget: "track", bind: { value: "res.hp", max: "derived.gritMod" } });
  assert.ok(t?.widget === "track");
  assert.equal(t.max, null);
  assert.equal(model({ widget: "track", bind: { value: "res.focus" } }), null);
  const steps = [
    { label: "Calm", size: 3 },
    { label: "Tense", size: 3 },
  ];
  assert.equal(model({ widget: "pips", bind: { value: "strain" }, steps }), null);
  const p = model({ widget: "pips", bind: { value: "guard" }, steps });
  assert.ok(p?.widget === "pips");
  assert.deepEqual(p.steps, steps);
});

test("pips fill step by step, and the step reached is the last with a pip", () => {
  const steps = [
    { label: "A", size: 3 },
    { label: "B", size: 3 },
    { label: "C", size: 3 },
  ];
  assert.deepEqual(pipsFilled({ value: 4, steps }), [3, 1, 0]);
  assert.equal(stepReached({ value: 4, steps }), 1);
  assert.equal(stepReached({ value: 0, steps }), -1);
  assert.deepEqual(pipsFilled({ value: 99, steps }), [3, 3, 3]);
  assert.deepEqual(pipsFilled({ value: -2, steps }), [0, 0, 0]);
});

test("cards and folds read the saved build; without it, or with an empty list, nothing", () => {
  assert.equal(model({ widget: "cards", variant: "weapons" }), null);
  const sheet = {
    talents: [{ name: "Quick", page: "Base p.4" }],
    abilities: [],
    weapons: [{ name: "Spear", damage: 5, ed: 1, range: [2], traits: [] }],
    armour: { name: "", ar: 0, traits: [] },
    gear: ["Rope"],
    powers: [],
  };
  const held = { ...actor, ledger: { sheet } } as unknown as SheetActor;
  assert.equal(model({ widget: "cards", variant: "weapons" }, held)?.widget, "cards");
  assert.equal(model({ widget: "cards", variant: "armour" }, held), null); // an armour without a name is none
  assert.equal(model({ widget: "cards", variant: "powers" }, held), null);
  assert.equal(model({ widget: "folds", variant: "abilities" }, held), null);
  const folds = model({ widget: "folds" }, held);
  assert.ok(folds?.widget === "folds" && folds.variant === "both");
  const laid = ledgerLaidOut([folds, model({ widget: "cards", variant: "gear" }, held)].flatMap((m) => m ?? []));
  assert.deepEqual([...laid].sort(), ["abilities", "gear", "talents"]);
});

test("notes: only the text fields the seat holds", () => {
  const m = model({ widget: "notes", bind: { fields: ["diary", "gmNote"] } });
  assert.ok(m?.widget === "notes");
  assert.deepEqual(
    m.fields.map((f) => f.id),
    ["diary"],
  );
  assert.equal(model({ widget: "notes", bind: { fields: ["gmNote"] } }), null);
});

test("an unknown widget draws nothing, and a bonus prints signed with a true minus", () => {
  assert.equal(model({ widget: "nope" }), null);
  assert.deepEqual([signed(2), signed(0), signed(-1)], ["+2", "0", "−1"]);
});

test("a held record's whole-number add, override or multiply is worded; anything else is shown as written", () => {
  const ruleset = Ruleset.parse(SAMPLE_D20);
  const entity = ruleset.entities.find((e) => e.base === "actor")?.id ?? "";
  const by = (mode: string, value: string) =>
    effectOf({ ruleset, entity, effect: { path: "derived.x", mode, value, phase: "derived" } as never }).by;
  assert.equal(by("add", "2"), 2);
  assert.equal(by("override", "13"), 13);
  assert.equal(by("multiply", "2"), 2);
  assert.equal(by("multiply", "1.5"), null);
  assert.equal(by("upgrade", "1"), null);
  assert.equal(by("override", ""), null);
});
