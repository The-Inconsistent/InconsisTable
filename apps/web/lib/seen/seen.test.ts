import assert from "node:assert/strict";
import { test } from "node:test";

import { readSeen, seenKey, unseenCount, writeSeen } from "./seen.ts";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test("the first visit counts nothing", () => {
  assert.equal(unseenCount({ keys: ["a:1"], seen: null }), 0);
});

test("counts keys not seen, and a changed stamp counts again", () => {
  const seen = new Set([seenKey({ id: "a", stamp: "1" })]);
  assert.equal(unseenCount({ keys: ["a:1", "b:1"], seen }), 1);
  assert.equal(unseenCount({ keys: [seenKey({ id: "a", stamp: "2" })], seen }), 1);
});

test("round-trips through storage", () => {
  const storage = memory();
  assert.equal(readSeen({ storageKey: "k", storage }), null);
  writeSeen({ storageKey: "k", keys: ["a:1"], storage });
  assert.deepEqual([...(readSeen({ storageKey: "k", storage }) ?? [])], ["a:1"]);
});

test("works without storage", () => {
  const fail = () => {
    throw new Error("blocked");
  };
  const broken = { getItem: fail, setItem: fail };
  assert.equal(readSeen({ storageKey: "k", storage: broken }), null);
  assert.doesNotThrow(() => writeSeen({ storageKey: "k", keys: [], storage: broken }));
});

test("ignores a stored value that is not a list", () => {
  const storage = memory();
  storage.setItem("k", "{}");
  assert.equal(readSeen({ storageKey: "k", storage })?.size, 0);
});
