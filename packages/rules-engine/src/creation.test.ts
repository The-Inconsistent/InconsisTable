import assert from "node:assert/strict";
import { test } from "node:test";

import { runCreation, type CreationAnswers } from "./creation.ts";
import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import { SAMPLE_PACK } from "./fixtures/sample-pack.ts";
import { validateRuleset, type CreationStep, type Ruleset, type RulesetInput } from "./manifest.ts";
import { validatePack, type PackEntry } from "./pack.ts";
import type { Problem } from "./problem.ts";

function sample(): RulesetInput {
  return structuredClone(SAMPLE_D20);
}

function build(input: RulesetInput = sample()): Ruleset {
  const r = validateRuleset(input);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.ruleset;
}

function problems(input: unknown): Problem[] {
  const r = validateRuleset(input);
  return r.ok ? [] : r.problems;
}

function has(list: readonly Problem[], path: string, pattern: RegExp) {
  assert.ok(
    list.some((p) => p.path === path && pattern.test(p.message)),
    `expected ${path} ~ ${pattern}, got ${JSON.stringify(list)}`,
  );
}

const RULESET = build();
const PACK = (() => {
  const r = validatePack({ input: SAMPLE_PACK, ruleset: RULESET });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.pack;
})();
const lookup = ({ type, key }: { type: string; key: string }): PackEntry | undefined =>
  PACK.entries.find((e) => e.type === type && e.key === key);

const GOOD: CreationAnswers = {
  lineage: ["reedfolk"],
  calling: ["wayfinder"],
  scores: { "attr.str": 15, "attr.dex": 12, "attr.con": 9 },
  identity: { name: "Wren", level: 1 },
};

function run(answers: CreationAnswers, ruleset: Ruleset = RULESET) {
  return runCreation({ ruleset, actor: "character", answers, lookup });
}

function failures(answers: CreationAnswers, ruleset: Ruleset = RULESET): Problem[] {
  const r = run(answers, ruleset);
  assert.ok(!r.ok, "should be refused");
  return r.ok ? [] : r.problems;
}

function withSteps(steps: CreationStep[]): Ruleset {
  const m = sample();
  m.creation = steps;
  return build(m);
}

// the manifest

test("the sample's creation steps validate and the defaults fill in", () => {
  assert.equal(RULESET.creation.length, 4);
  assert.deepEqual(
    RULESET.creation.map((s) => [s.id, s.kind, s.optional]),
    [
      ["lineage", "choose", false],
      ["calling", "choose", false],
      ["scores", "assign", false],
      ["identity", "fields", false],
    ],
  );
  assert.equal(RULESET.decisions[0]?.id, "restsDoNotCascade");
  // A manifest from before P1 has neither and stays valid.
  const old = sample();
  delete old.creation;
  delete old.decisions;
  assert.deepEqual(build(old).creation, []);
});

test("a creation step without a cite is refused, and a homebrew ruleset is excused", () => {
  const m = sample();
  delete m.creation?.[1]?.cite;
  has(problems(m), "creation[1].cite", /needs a cite/);
  m.sources = [{ id: "table", title: "Our table", license: "homebrew" }];
  delete m.initiative?.cite;
  assert.deepEqual(
    problems(m).filter((p) => p.path.startsWith("creation")),
    [],
  );
});

test("steps must name real entities and fields, once each, with scores that add up", () => {
  const m = sample();
  const [lineage, calling, scores, identity] = m.creation ?? [];
  assert.ok(
    lineage?.kind === "choose" &&
      calling?.kind === "choose" &&
      scores?.kind === "assign" &&
      identity?.kind === "fields",
  );
  m.creation = [
    { ...lineage, actor: "gear", pick: "dragon", copy: [{ from: "size", to: "size" }] },
    { ...calling, id: "calling", count: 2, copy: [{ from: "guardBase", to: "guard" }] },
    { ...scores, id: "calling", fields: ["attr.str", "attr.nope", "name"], method: { kind: "table", values: [1, 2] } },
    { ...identity, fields: ["name"] },
    { ...identity, id: "again", fields: ["name"] },
  ];
  const list = problems(m);
  has(list, "creation[0].actor", /not an actor/);
  has(list, "creation[1].copy", /ambiguous/);
  has(list, "creation[2].id", /duplicate/);
  has(list, "creation[2].fields[1]", /no field "attr.nope"/);
  has(list, "creation[2].fields[2]", /must be an int/);
  has(list, "creation[2].method.values", /2 values for 3 fields/);
  has(list, "creation[4].fields[0]", /already set by step "calling"|already set by step "identity"/);

  const n = sample();
  n.creation = [{ ...lineage, pick: "dragon", copy: [{ from: "blurb", to: "guard" }] }];
  has(problems(n), "creation[0].pick", /unknown entity "dragon"/);
  n.creation = [{ ...lineage, copy: [{ from: "blurb", to: "guard" }] }];
  has(problems(n), "creation[0].copy[0]", /text field cannot fill a int field/);
  n.creation = [{ ...lineage, copy: [{ from: "nope", to: "size" }] }];
  has(problems(n), "creation[0].copy[0].from", /no field "nope"/);
});

test("a point buy must price every score in its range", () => {
  const m = sample();
  const [, , scores] = m.creation ?? [];
  assert.ok(scores?.kind === "assign");
  const buy = (costs: Record<string, number>, max = 10): RulesetInput => ({
    ...m,
    creation: [{ ...scores, method: { kind: "pointBuy", budget: 6, min: 8, max, costs } }],
  });
  has(problems(buy({ "8": 0, "9": 1 })), "creation[0].method.costs", /no cost for the score 10/);
  has(problems(buy({ "8": 0, "9": 1, "10": 2 }, 7)), "creation[0].method.max", /below min/);
  assert.deepEqual(problems(buy({ "8": 0, "9": 1, "10": 2 })), []);
});

// running it

test("a valid build copies the pick's values, assigns the scores and stores the choices", () => {
  const r = run(GOOD);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  if (!r.ok) return;
  assert.deepEqual(r.fields, {
    size: "small",
    guard: 3,
    "attr.str": 15,
    "attr.dex": 12,
    "attr.con": 9,
    name: "Wren",
    level: 1,
  });
  assert.deepEqual(r.choices, [
    { stepId: "lineage", ordinal: 0, optionKey: "reedfolk" },
    { stepId: "calling", ordinal: 0, optionKey: "wayfinder" },
  ]);
});

test("a choose step refuses a missing step, the wrong number, an unknown or repeated key", () => {
  const { lineage: _lineage, ...noLineage } = GOOD;
  has(failures(noLineage), "lineage", /needs an answer/);
  has(failures({ ...GOOD, lineage: [] }), "lineage", /pick 1, got 0/);
  has(failures({ ...GOOD, lineage: ["reedfolk", "wayfinder"] }), "lineage", /pick 1, got 2/);
  has(failures({ ...GOOD, lineage: ["ember-wisp"] }), "lineage[0]", /no lineage "ember-wisp"/);
  has(failures({ ...GOOD, lineage: "reedfolk" }), "lineage", /list of entry keys/);
  const two = withSteps([{ ...RULESET.creation[0], count: 2, copy: [] } as CreationStep]);
  has(failures({ lineage: ["reedfolk", "reedfolk"] }, two), "lineage", /same entry twice/);
  // A step nobody declared.
  has(failures({ ...GOOD, bonus: 1 }), "bonus", /no such step/);
});

test("an assign step on a table uses each listed value once, on exactly its fields", () => {
  has(failures({ ...GOOD, scores: { "attr.str": 15, "attr.dex": 15, "attr.con": 9 } }), "scores.attr.dex", /not left/);
  has(failures({ ...GOOD, scores: { "attr.str": 18, "attr.dex": 12, "attr.con": 9 } }), "scores.attr.str", /not left/);
  has(failures({ ...GOOD, scores: { "attr.str": 15, "attr.dex": 12 } }), "scores.attr.con", /needs a score/);
  has(failures({ ...GOOD, scores: { ...(GOOD.scores as object), name: 3 } }), "scores.name", /not a field/);
  has(failures({ ...GOOD, scores: { "attr.str": 15.5 } }), "scores", /score for each field/);
});

test("an assign step on a point buy holds to the range and the budget", () => {
  const buy = withSteps([
    {
      kind: "assign",
      id: "scores",
      actor: "character",
      label: "Scores",
      cite: "Sample p.12",
      fields: ["attr.str", "attr.dex", "attr.con"],
      method: { kind: "pointBuy", budget: 4, min: 8, max: 12, costs: { "8": 0, "9": 1, "10": 2, "11": 3, "12": 4 } },
      optional: false,
    },
  ]);
  const ok = run({ scores: { "attr.str": 12, "attr.dex": 8, "attr.con": 8 } }, buy);
  assert.ok(ok.ok, JSON.stringify(!ok.ok && ok.problems));
  has(
    failures({ scores: { "attr.str": 12, "attr.dex": 9, "attr.con": 8 } }, buy),
    "scores",
    /5 points spent, over the budget of 4/,
  );
  has(
    failures({ scores: { "attr.str": 13, "attr.dex": 8, "attr.con": 8 } }, buy),
    "scores.attr.str",
    /outside 8 to 12/,
  );
});

test("values that land on the actor are checked against its FieldDef", () => {
  has(failures({ ...GOOD, identity: { name: 7 } }), "identity.name", /expected text/);
  has(failures({ ...GOOD, identity: {} }), "identity.name", /needs a value/);
  has(failures({ ...GOOD, identity: { name: "A", gmNote: "x" } }), "identity.gmNote", /not a field of this step/);
  // The pick's value must still fit the actor's field: a calling that grants a guard over the field's range.
  const odd = (key: string) => ({ ...PACK.entries[1], key, body: { guardBase: 3 } }) as PackEntry;
  const strict = build({
    ...sample(),
    entities: sample().entities.map((e) =>
      e.id === "character" ? { ...e, fields: { ...e.fields, guard: { type: "int", label: "Guard", max: 2 } } } : e,
    ),
  });
  const picked = runCreation({
    ruleset: strict,
    actor: "character",
    answers: GOOD,
    lookup: (a) => (a.key === "wayfinder" ? odd("wayfinder") : lookup(a)),
  });
  assert.ok(!picked.ok);
  has(picked.problems, "calling.guard", /maximum of 2/);
});

test("an optional step may be skipped, an unknown actor type is refused", () => {
  const steps = RULESET.creation.map((s) => (s.id === "calling" ? { ...s, optional: true } : s));
  const lax = withSteps(steps);
  const { calling: _calling, ...rest } = GOOD;
  const r = run(rest, lax);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  if (r.ok) assert.equal(r.fields.guard, undefined);
  const bad = runCreation({ ruleset: RULESET, actor: "gear", answers: {}, lookup });
  assert.ok(!bad.ok);
});
