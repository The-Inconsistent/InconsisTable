import assert from "node:assert/strict";
import { test } from "node:test";

import { HandoutLayout } from "@inconsistable/core-schema";
import { validateWorld } from "@inconsistable/rules-engine";

import { SAMPLE_WORLD } from "../../../../packages/rules-engine/src/fixtures/sample-world.ts";
import { read, rulesOf } from "../tokens/css.ts";
import { offeredLayouts, transcriptLines } from "./handout.ts";

const sample = validateWorld(SAMPLE_WORLD);
assert.ok(sample.ok);
const handouts = sample.world.handouts ?? null;

test("a room without a World offers every layout, in the platform's order", () => {
  assert.deepEqual(offeredLayouts({ handouts: null, current: "plain" }), HandoutLayout.options);
  assert.deepEqual(offeredLayouts({ handouts: null, current: null }), HandoutLayout.options);
});

test("a World offers its three, in its own order", () => {
  assert.deepEqual(offeredLayouts({ handouts, current: "plain" }), ["proclamation", "transcript", "plain"]);
});

test("plain is offered whether the World lists it or not", () => {
  assert.deepEqual(offeredLayouts({ handouts: { layouts: ["form"], names: {} }, current: null }), ["plain", "form"]);
});

test("a stored layout the World no longer offers is still offered, last, as the current value", () => {
  assert.deepEqual(offeredLayouts({ handouts, current: "tablet" }), ["proclamation", "transcript", "plain", "tablet"]);
});

test("a transcript's lines keep their stamps apart and blank lines in place", () => {
  assert.deepEqual(transcriptLines("[02:14] Who goes there?\n\nNo answer.\n[] x\n[Pilot]Steady"), [
    { stamp: "02:14", text: "Who goes there?" },
    { stamp: null, text: "" },
    { stamp: null, text: "No answer." },
    { stamp: null, text: "[] x" },
    { stamp: "Pilot", text: "Steady" },
  ]);
  assert.deepEqual(transcriptLines(`[${"s".repeat(25)}] long`), [{ stamp: null, text: `[${"s".repeat(25)}] long` }]);
});

test("every layout but plain (the body alone) is drawn by a rule keyed on it", () => {
  const rules = rulesOf(read("app/globals.css"));
  const missing = HandoutLayout.options.filter(
    (l) => l !== "plain" && !rules.some((r) => r.selector.includes(`.handout[data-layout="${l}"]`) && r.decls.size > 0),
  );
  assert.deepEqual(missing, []);
});
