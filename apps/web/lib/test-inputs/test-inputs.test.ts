import assert from "node:assert/strict";
import { test } from "node:test";

import type { TestDef } from "@inconsistable/core-schema";
import { compileRuleset, Ruleset } from "@inconsistable/rules-engine";
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";

import { draftOf, missingInputs, testWords, toInputs } from "./test-inputs.ts";

// The invented d20 fixture's `check` as the GM's state carries it: a choice of ability and a whole-number target.
const rules = Ruleset.parse(SAMPLE_D20);
const declared = rules.tests["check"]!;
const check: TestDef = {
  id: "check",
  dice: "1d20",
  advantage: true,
  pool: null,
  outcomes: null,
  inputs: Object.entries(declared.inputs).map(([id, type]) => ({
    id,
    type,
    ...(declared.inputOptions[id] ? { options: declared.inputOptions[id] } : {}),
  })),
};
// The same Test with an optional switch, as a ruleset may declare one.
const withSwitch: TestDef = { ...check, inputs: [...check.inputs, { id: "pushed", type: "bool" }] };

test("the fixture compiles, so the Test above is the one the room serves", () => {
  assert.ok(compileRuleset(rules).ok);
  assert.deepEqual(
    check.inputs.map((i) => i.id),
    ["ability", "dc"],
  );
});

test("a line with every input leaves nothing to fill in", () => {
  assert.deepEqual(missingInputs({ def: check, inputs: { ability: "dex", dc: 14 } }), []);
});

test("a line missing its target asks for it, and only for it", () => {
  assert.deepEqual(
    missingInputs({ def: check, inputs: { ability: "dex" } }).map((i) => i.id),
    ["dc"],
  );
  // A choice the Test no longer offers counts as missing too.
  assert.deepEqual(
    missingInputs({ def: check, inputs: { ability: "luck", dc: 3 } }).map((i) => i.id),
    ["ability"],
  );
});

test("a switch left out is off, never missing, and is sent as off", () => {
  assert.deepEqual(missingInputs({ def: withSwitch, inputs: { ability: "str", dc: 10 } }), []);
  assert.deepEqual(toInputs({ def: withSwitch, draft: draftOf({ ability: "str", dc: 10 }) }), {
    ok: true,
    inputs: { ability: "str", dc: 10, pushed: false },
  });
});

test("the call form's reading: a whole number, a filled text, extras dropped", () => {
  assert.deepEqual(toInputs({ def: check, draft: { ability: "dex", dc: "1.5" } }), {
    ok: false,
    problem: "wholeNumber",
    id: "dc",
  });
  assert.deepEqual(toInputs({ def: check, draft: { ability: " ", dc: "3" } }), {
    ok: false,
    problem: "fillIn",
    id: "ability",
  });
  assert.deepEqual(toInputs({ def: check, draft: { ability: "wis", dc: "12", gone: "x" } }), {
    ok: true,
    inputs: { ability: "wis", dc: 12 },
  });
});

// The fixture's own words, as the GM's state carries them (house decision #77).
const worded: TestDef = {
  ...check,
  ...(declared.label ? { label: declared.label } : {}),
  ...(declared.inputLabels ? { inputLabels: declared.inputLabels } : {}),
  ...(declared.inputOptionLabels ? { inputOptionLabels: declared.inputOptionLabels } : {}),
};

test("a Test with every word reads as its label, its inputs' labels and its options' labels", () => {
  const w = testWords(worded);
  assert.equal(w.test, "Ability check");
  assert.equal(w.input("ability"), "Ability");
  assert.equal(w.input("dc"), "DC");
  assert.equal(w.value("ability", "dex"), "Dexterity");
  assert.equal(w.value("dc", 14), "14");
});

test("a Test with some words falls back, word by word, to the id or the value", () => {
  const w = testWords({ id: "check", inputLabels: { dc: "DC" }, inputOptionLabels: { ability: { str: "Strength" } } });
  assert.equal(w.test, "check");
  assert.equal(w.input("dc"), "DC");
  assert.equal(w.input("ability"), "ability");
  assert.equal(w.value("ability", "str"), "Strength");
  assert.equal(w.value("ability", "wis"), "wis");
  assert.equal(w.value("pushed", true), "true");
});

test("a Test with no words, or one the room no longer has, reads as its ids", () => {
  for (const w of [testWords(check), testWords({ id: "check" })]) {
    assert.equal(w.test, "check");
    assert.equal(w.input("ability"), "ability");
    assert.equal(w.value("ability", "dex"), "dex");
  }
});
