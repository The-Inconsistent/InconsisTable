import assert from "node:assert/strict";
import { test } from "node:test";

import type { TestCall } from "@inconsistable/core-schema";

import { callBand } from "@/lib/call-band/call-band";

const call = (id: string, status: "open" | "closed") => ({ id, status }) as unknown as TestCall;

test("callBand: nothing open shows nothing", () => {
  assert.deepEqual(callBand({ tests: [call("a", "closed")] }), { shown: [], more: 0 });
});

test("callBand: two open show both, no overflow", () => {
  const r = callBand({ tests: [call("a", "open"), call("x", "closed"), call("b", "open")] });
  assert.deepEqual(
    r.shown.map((c) => c.id),
    ["a", "b"],
  );
  assert.equal(r.more, 0);
});

test("callBand: three open show two and count one more", () => {
  const r = callBand({ tests: [call("a", "open"), call("b", "open"), call("c", "open")] });
  assert.deepEqual(
    r.shown.map((c) => c.id),
    ["a", "b"],
  );
  assert.equal(r.more, 1);
});
