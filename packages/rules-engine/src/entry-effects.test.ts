import assert from "node:assert/strict";
import { test } from "node:test";

import { breakdownOf } from "./breakdown.ts";
import { compileRuleset, type ActiveEntry } from "./compile.ts";
import { deriveValues } from "./derived.ts";
import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import { SAMPLE_PACK } from "./fixtures/sample-pack.ts";
import { validateRuleset, type Effect, type Ruleset } from "./manifest.ts";
import { contentHash } from "./pack-hash.ts";
import { PackEntry, validatePack, type PackInput } from "./pack.ts";

const compiled = (() => {
  const r = compileRuleset(SAMPLE_D20);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.compiled;
})();
const RULESET: Ruleset = compiled.ruleset;

const HERO = {
  fields: { name: "Ash", level: 3, "attr.str": 14, "attr.dex": 16, "attr.con": 12, guard: 11 },
  resources: { hp: 9, tempHp: 0 },
  party: { characters: 4 },
};

const entry = (type: string, key: string, effects: Effect[]): ActiveEntry => ({
  type,
  key,
  name: `Name ${key}`,
  effects,
});
const derive = (values: Partial<typeof HERO> & { conditions?: string[]; entries?: ActiveEntry[] }) =>
  deriveValues({ compiled, entity: "character", values: { ...HERO, ...values } });

const swift = entry("lineage", "swift", [{ path: "attr.dex", mode: "add", value: "2", phase: "base" }]);
const shield = entry("calling", "shield", [{ path: "derived.defense", mode: "add", value: "3", phase: "derived" }]);

test("a base effect of a chosen entry feeds the derived values; a derived effect lands on the value", () => {
  assert.equal(derive({}).defense, 14);
  assert.equal(derive({ entries: [swift] }).defense, 15); // Grace 18: modifier 4
  assert.equal(derive({ entries: [shield] }).defense, 17);
  assert.equal(derive({ entries: [swift, shield] }).defense, 18);
});

test("an entry effect whose when is false does nothing", () => {
  const off = entry("calling", "off", [
    { path: "derived.defense", mode: "add", value: "3", phase: "derived", when: "level > 5" },
  ]);
  assert.equal(derive({ entries: [off] }).defense, 14);
  assert.equal(derive({ entries: [off], fields: { ...HERO.fields, level: 6 } }).defense, 17);
});

test("entry and condition effects sort by priority, then source id", () => {
  const set = (key: string, priority?: number) =>
    entry("aaa", key, [
      {
        path: "derived.defense",
        mode: "override",
        value: "20",
        phase: "derived",
        ...(priority === undefined ? {} : { priority }),
      },
    ]);
  // braced adds 2 at priority 0. "aaa/x" sorts before "braced": override 20, then +2.
  assert.equal(derive({ conditions: ["braced"], entries: [set("x")] }).defense, 22);
  // "zzz/x" sorts after "braced": +2, then override 20.
  const late = { ...set("x"), type: "zzz" };
  assert.equal(derive({ conditions: ["braced"], entries: [late] }).defense, 20);
  // A lower priority goes first whatever the id; a higher one goes last.
  assert.equal(derive({ conditions: ["braced"], entries: [{ ...late, effects: set("x", -1).effects }] }).defense, 22);
  assert.equal(derive({ conditions: ["braced"], entries: [set("x", 1)] }).defense, 20);
});

test("an entry that does not fit the actor type contributes nothing", () => {
  const stray = entry("calling", "stray", [{ path: "derived.nothing", mode: "add", value: "3", phase: "derived" }]);
  assert.equal(derive({ entries: [stray] }).defense, 14);
});

test("breakdown names an entry by its name", () => {
  const values = { ...HERO, conditions: ["braced"], entries: [shield] };
  const total = deriveValues({ compiled, entity: "character", values }).defense ?? 0;
  const lines = breakdownOf({ compiled, entity: "character", derivedId: "defense", values, total });
  assert.deepEqual(
    lines?.map((l) => [l.source, l.amount]),
    [
      ["Defense", 14],
      ["Braced", 2],
      ["Name shield", 3],
    ],
  );
});

function packWith(effects: Effect[], type = "calling"): PackInput {
  return {
    ...SAMPLE_PACK,
    entries: [{ key: "x", type, name: "X", cite: "Sample p.1", visibility: "public", body: {}, effects }],
  };
}
const problems = (p: PackInput) => {
  const r = validatePack({ input: p, ruleset: RULESET });
  return r.ok ? [] : r.problems;
};
const ok = { path: "derived.defense", mode: "add", value: "1", phase: "derived" } as const;

test("a pack entry's effects are checked against the actor types that choose its type", () => {
  assert.deepEqual(problems(packWith([ok])), []);
  assert.deepEqual(problems(packWith([{ ...ok, path: "derived.nope" }])), [
    { path: "entries[0].effects[0].path", message: 'character has no integer "derived.nope"' },
  ]);
  assert.deepEqual(problems(packWith([{ ...ok, path: "defense" }])), [
    { path: "entries[0].effects[0].path", message: 'a derived-phase effect targets "derived.<id>"' },
  ]);
  assert.match(problems(packWith([{ ...ok, value: "nope + 1" }]))[0]?.path ?? "", /effects\[0\]\.value$/);
  // Base effects cannot read derived values.
  assert.match(
    problems(packWith([{ path: "attr.dex", mode: "add", value: "derived.defense", phase: "base" }]))[0]?.path ?? "",
    /value$/,
  );
  assert.deepEqual(problems(packWith([ok], "gear")), [
    { path: "entries[0].effects", message: 'nothing chooses a "gear", so these could never apply' },
  ]);
  assert.equal(problems(packWith(Array.from({ length: 21 }, () => ok))).length, 1);
  assert.deepEqual(problems(packWith(Array.from({ length: 20 }, () => ok))), []);
});

test("the visibility taint check holds for entry effects", () => {
  const r = structuredClone(SAMPLE_D20);
  const character = r.entities[0];
  assert.ok(character);
  character.derived = [
    ...(character.derived ?? []),
    { id: "secretDef", label: "Secret", expr: "guard", visibility: "owner" },
  ];
  const owner = validateRuleset(r);
  assert.ok(owner.ok);
  const secret = { path: "derived.secretDef", mode: "add", value: "1", phase: "derived" } as const;
  assert.equal(validatePack({ input: packWith([secret]), ruleset: owner.ruleset }).ok, true);
  // A value read from a hidden field may not raise a more visible one.
  const hidden = { path: "derived.defense", mode: "add", value: "derived.secretDef", phase: "derived" } as const;
  const r2 = validatePack({ input: packWith([hidden]), ruleset: owner.ruleset });
  assert.equal(r2.ok, false);
});

test("an entry with no effects hashes as before", () => {
  const plain = PackEntry.parse({ key: "k", type: "calling", name: "K" });
  const withNone = PackEntry.parse({ key: "k", type: "calling", name: "K", effects: [] });
  assert.equal(contentHash(plain), contentHash(withNone));
  const withOne = PackEntry.parse({ key: "k", type: "calling", name: "K", effects: [ok] });
  assert.notEqual(contentHash(plain), contentHash(withOne));
});
