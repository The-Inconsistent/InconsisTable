import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExprRecord, ExprScope } from "./expr.ast.ts";
import { compileExpr, evaluateExpr } from "./expr.ts";

const SCOPE: ExprScope = {
  form: { record: { f1: "int", f2: "int", f10: "int" } },
  mixed: { record: { a1: "int", a2: "text" } },
  bare: { record: { a1: "int", b: "int" } },
  twin: { record: { a1: "int", b1: "int" } },
  n: "int",
};
const VALUES: ExprRecord = { form: { f1: 10, f10: 100 }, n: 1 };

function go(source: string) {
  const r = compileExpr({ source, scope: SCOPE });
  if (!r.ok) throw new Error(r.error);
  return { value: evaluateExpr({ expr: r.expr, scope: VALUES }), refs: r.expr.refs };
}

function refused(source: string, pattern: RegExp) {
  const r = compileExpr({ source, scope: SCOPE });
  assert.equal(r.ok, false, `${source} should be refused`);
  if (!r.ok) assert.match(r.error, pattern);
}

test("at(group, n) reads the member whose id ends in n", () => {
  assert.equal(go("at(form, 1)").value, 10);
  assert.equal(go("at(form, n + 9)").value, 100);
  assert.deepEqual(go("at(form, n)").refs, ["form.*", "n"]);
  assert.throws(() => go("at(form, 2)"), /missing value "form\[2\]"/);
  assert.throws(() => go("at(form, 3)"), /missing value "form\[3\]"/);
});

test("at() refuses what cannot pick one member", () => {
  refused("at(form)", /takes 2 argument/);
  refused("at(n, 1)", /takes a group of fields, got int/);
  refused('at(form, "a")', /argument 2 must be int/);
  refused("at(mixed, 1)", /mixes value types/);
  refused("at(bare, 1)", /"bare.b" does not end in a number/);
  refused("at(twin, 1)", /two members of "twin" end in 1/);
});
