import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset, validateRuleset } from "@inconsistable/rules-engine";

import { TEMPLATE_IDS, TEMPLATES, templateText } from "./templates.ts";

for (const id of TEMPLATE_IDS) {
  test(`template ${id}: parses, and the validator asks only for the cites and the license`, () => {
    const doc: unknown = JSON.parse(templateText(id));
    const r = validateRuleset(doc);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.problems.length > 0);
    // No structural error: every problem sits on an empty cite or the empty license.
    for (const p of r.ok ? [] : r.problems) assert.match(p.path, /(\.cite|\.license)$/, `${p.path}: ${p.message}`);
  });

  test(`template ${id}: filled in, it is a valid ruleset that compiles`, () => {
    const filled = JSON.parse(
      templateText(id).replaceAll('"cite": ""', '"cite": "Book p.1"').replace('"license": ""', '"license": "private"'),
    );
    const v = compileRuleset(filled);
    assert.ok(v.ok, v.ok ? "" : JSON.stringify(v.problems));
  });
}

test("a template carries no game's names", () => {
  const text = JSON.stringify(TEMPLATES);
  assert.ok(
    !/success|failure|miss|hit points|dexterity|strength/i.test(text.replace(/poolSuccesses|sumVsTarget/g, "")),
  );
});
