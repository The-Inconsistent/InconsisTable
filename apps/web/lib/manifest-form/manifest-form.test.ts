import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "@inconsistable/rules-engine";

import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_HARVEST } from "../../../../packages/rules-engine/src/fixtures/sample-harvest.ts";
import { SAMPLE_PACK } from "../../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { SAMPLE_POOL } from "../../../../packages/rules-engine/src/fixtures/sample-pool.ts";
import { FREEFORM } from "../freeform/freeform.ts";
import { TEMPLATE_IDS, TEMPLATES } from "../templates/templates.ts";

import {
  check,
  getAt,
  isHomebrew,
  isPrivate,
  longTextWarning,
  newPack,
  newRuleset,
  problemsUnder,
  removeAt,
  renameKey,
  sectionOfPack,
  sectionOfRuleset,
  serialize,
  setAt,
  stripNulls,
} from "./manifest-form.ts";

const documents: Record<string, unknown> = {
  "sample-d20": SAMPLE_D20,
  "sample-pool": SAMPLE_POOL,
  "sample-harvest": SAMPLE_HARVEST,
  freeform: FREEFORM,
  ...Object.fromEntries(TEMPLATE_IDS.map((id) => [`template ${id}`, TEMPLATES[id]])),
  "sample-pack": SAMPLE_PACK,
};

// The form's state is the document itself, so what it shows the JSON tab and the api is what it was given.
for (const [name, doc] of Object.entries(documents)) {
  test(`round trip: ${name} loads and serializes to the same document`, () => {
    assert.deepEqual(JSON.parse(serialize(doc)), JSON.parse(JSON.stringify(doc)));
    // An edit that writes back what is already there changes nothing, whatever the form does not model.
    let walked: unknown = doc;
    for (const key of Object.keys(doc as object)) {
      walked = setAt({ doc: walked, path: [key], value: getAt(doc, [key]) });
    }
    assert.deepEqual(walked, doc);
  });
}

test("the samples that are rulesets pass the validator the form runs", () => {
  for (const doc of [SAMPLE_D20, SAMPLE_POOL, SAMPLE_HARVEST, FREEFORM]) {
    const r = check({ kind: "ruleset", doc });
    assert.deepEqual(r.problems, [], (doc as { id: string }).id);
    assert.ok(r.ruleset);
  }
});

test("the sample pack passes against the sample ruleset, and a schema-only check passes without one", () => {
  const target = check({ kind: "ruleset", doc: SAMPLE_D20 }).ruleset;
  assert.ok(target);
  assert.deepEqual(check({ kind: "pack", doc: SAMPLE_PACK, target }).problems, []);
  assert.deepEqual(check({ kind: "pack", doc: SAMPLE_PACK }).problems, []);
});

test("setAt, removeAt and renameKey leave the original alone", () => {
  const doc = { a: [{ x: 1 }, { x: 2 }], b: { k: 1, l: 2 } };
  const set = setAt({ doc, path: ["a", 1, "x"], value: 9 });
  assert.deepEqual(getAt(set, ["a", 1, "x"]), 9);
  assert.equal(doc.a[1]?.x, 2);
  assert.deepEqual(removeAt({ doc, path: ["a", 0] }), { a: [{ x: 2 }], b: { k: 1, l: 2 } });
  assert.deepEqual(removeAt({ doc, path: ["b", "k"] }), { a: [{ x: 1 }, { x: 2 }], b: { l: 2 } });
  assert.deepEqual(Object.keys(renameKey({ obj: doc.b, from: "k", to: "z" })), ["z", "l"]);
  assert.deepEqual(setAt({ doc: {}, path: ["a", 0, "x"], value: 1 }), { a: [{ x: 1 }] });
  assert.deepEqual(stripNulls({ a: null, b: [{ c: null, d: 1 }] }), { b: [{ d: 1 }] });
});

test("a problem's path lands in the section and the row it names", () => {
  assert.equal(sectionOfRuleset("resources[2].cite"), "resources");
  assert.equal(sectionOfRuleset("tests.attack.degrees"), "tests");
  assert.equal(sectionOfRuleset("entities[0].fields.attr.str.label"), "fields");
  assert.equal(sectionOfRuleset("initiative.score"), "turn");
  assert.equal(sectionOfRuleset("scoring.endWhen[0]"), "board");
  assert.equal(sectionOfRuleset("(root)"), "about");
  assert.equal(sectionOfPack("entries[3].cite"), "entries");
  assert.equal(sectionOfPack("ruleset.range"), "about");

  const doc = structuredClone(SAMPLE_D20) as unknown as { resources: { cite?: string }[] };
  delete doc.resources[0]?.cite;
  const { problems } = check({ kind: "ruleset", doc });
  assert.ok(problems.length > 0);
  const row0 = problemsUnder({ problems, prefix: "resources[0]" });
  assert.ok(row0.some((p) => p.path === "resources[0].cite"));
  assert.equal(
    problemsUnder({ problems, prefix: "resources[1]" }).every((p) => p.path.startsWith("resources[1]")),
    true,
  );
  assert.equal(problemsUnder({ problems, prefix: "resources[10]" }).length, 0);
});

test("homebrew hides the cite requirement; a private source does not", () => {
  assert.equal(isHomebrew(newRuleset()), true);
  assert.equal(isHomebrew(SAMPLE_D20), false);
  const fresh = setAt({
    doc: setAt({ doc: newRuleset(), path: ["id"], value: "mine" }),
    path: ["sources", 0, "title"],
    value: "Mine",
  });
  assert.equal(compileRuleset(fresh).ok, true);
});

test("the long-description warning needs a private document and more than 280 characters", () => {
  const long = "x".repeat(281);
  assert.equal(longTextWarning({ text: long, priv: true }), true);
  assert.equal(longTextWarning({ text: "x".repeat(280), priv: true }), false);
  assert.equal(longTextWarning({ text: long, priv: false }), false);
  assert.equal(isPrivate({ kind: "pack", doc: { license: "private" } }), true);
  assert.equal(isPrivate({ kind: "pack", doc: { license: "original" } }), false);
  assert.equal(isPrivate({ kind: "ruleset", doc: { sources: [{ license: "srd" }, { license: "private" }] } }), true);
  assert.equal(isPrivate({ kind: "ruleset", doc: newRuleset() }), false);
});

test("a new pack carries its ruleset id and fails only on what the user has not typed yet", () => {
  const { problems } = check({ kind: "pack", doc: newPack({ rulesetId: "sample-d20" }) });
  assert.deepEqual(
    problems.map((p) => p.path),
    ["id"],
  );
});
