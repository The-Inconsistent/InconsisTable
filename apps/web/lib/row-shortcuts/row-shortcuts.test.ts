import assert from "node:assert/strict";
import { test } from "node:test";

import type { Actor } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_SKIRMISH } from "../../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import { rowShortcutsOf } from "./row-shortcuts.ts";

const ruleset = Ruleset.parse(SAMPLE_SKIRMISH);

test("the tracker row's tag and stepper come from the layout's trackerRow paths (house decision #92)", () => {
  const actor = (fields: object, resources: object) => ({ entity: "creature", fields, resources }) as unknown as Actor;
  assert.deepEqual(rowShortcutsOf({ ruleset, actor: actor({ kind: "brute" }, { spite: 3 }) }), {
    tags: [{ field: "kind", label: "Brute", note: "Shrugs off staggering" }],
    steppers: [{ resource: "spite", label: "Spite", value: 3 }],
  });
  // What the seat was not sent, or an actor of a type with its own layout, has none.
  assert.deepEqual(rowShortcutsOf({ ruleset, actor: actor({}, {}) }), { tags: [], steppers: [] });
  assert.deepEqual(rowShortcutsOf({ ruleset, actor: { ...actor({ kind: "brute" }, {}), entity: "character" } }), {
    tags: [],
    steppers: [],
  });
  assert.deepEqual(rowShortcutsOf({ ruleset: null, actor: actor({ kind: "brute" }, {}) }), { tags: [], steppers: [] });
});
