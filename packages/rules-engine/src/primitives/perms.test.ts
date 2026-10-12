import { test } from "node:test";
import assert from "node:assert/strict";
// The engine depends on no app package, so it declares an op's permission as a plain string; the api checks it with
// core-schema's canInCampaign. A relative import keeps this test from adding a dependency between the two packages.
import { Permission } from "../../../core-schema/src/permissions.ts";
import { PRIMITIVES } from "./registry.ts";

test("every primitive op's perm is a core-schema Permission", () => {
  const ops = Object.values(PRIMITIVES).flatMap((p) => Object.entries(p.ops).map(([op, def]) => [p.id, op, def.perm]));
  assert.ok(ops.length > 0);
  for (const [prim, op, perm] of ops) assert.ok(Permission.safeParse(perm).success, `${prim}.${op}: "${perm}"`);
});
