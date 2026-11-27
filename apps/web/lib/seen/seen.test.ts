import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CodexEntry } from "@inconsistable/core-schema";

import {
  entrySeenKey,
  inboxEntries,
  initialSeen,
  markAllSeen,
  nextSeen,
  readSeen,
  seenKey,
  unseenCount,
  writeSeen,
} from "./seen.ts";

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

test("a newly shown picture makes a seen entry unseen; no picture keeps the old key", () => {
  assert.equal(entrySeenKey({ id: "a", revealedAt: "1", imageId: null }), "a:1");
  const seen = new Set([entrySeenKey({ id: "a", revealedAt: "1", imageId: null })]);
  assert.equal(unseenCount({ keys: [entrySeenKey({ id: "a", revealedAt: "1", imageId: "p" })], seen }), 1);
});

describe("nextSeen", () => {
  test("the first visit seeds with nothing fresh, viewing or not", () => {
    for (const viewing of [true, false]) {
      const s = nextSeen({ state: initialSeen(null), keys: ["a", "b"], viewing });
      assert.deepEqual([...(s.set ?? [])], ["a", "b"]);
      assert.equal(s.fresh.size, 0);
    }
  });

  test("not loaded changes nothing", () => {
    const state = initialSeen(new Set(["a"]));
    assert.equal(nextSeen({ state, keys: null, viewing: true }), state);
  });

  test("opening marks everything and keeps what was unseen as the baseline", () => {
    const closed = nextSeen({ state: initialSeen(new Set(["a"])), keys: ["a", "b"], viewing: false });
    assert.equal(unseenCount({ keys: ["a", "b"], seen: closed.set }), 1);
    const open = nextSeen({ state: closed, keys: ["a", "b"], viewing: true });
    assert.deepEqual([...open.fresh], ["b"]);
    assert.deepEqual([...(open.set ?? [])], ["a", "b"]);
    // A second render while open keeps the baseline (the same object: no render loop).
    assert.equal(nextSeen({ state: open, keys: ["a", "b"], viewing: true }), open);
  });

  test("a reveal while open joins the baseline; leaving forgets it; reopening finds nothing new", () => {
    const open = nextSeen({ state: initialSeen(new Set(["a"])), keys: ["a", "b"], viewing: true });
    const more = nextSeen({ state: open, keys: ["a", "b", "c"], viewing: true });
    assert.deepEqual([...more.fresh].sort(), ["b", "c"]);
    const left = nextSeen({ state: more, keys: ["a", "b", "c"], viewing: false });
    assert.equal(left.fresh.size, 0);
    assert.equal(nextSeen({ state: left, keys: ["a", "b", "c"], viewing: true }).fresh.size, 0);
  });

  test("MARK ALL READ clears the baseline", () => {
    const open = nextSeen({ state: initialSeen(new Set(["a"])), keys: ["a", "b"], viewing: true });
    const read = markAllSeen({ state: open, keys: ["a", "b"] });
    assert.equal(read.fresh.size, 0);
    assert.equal(nextSeen({ state: read, keys: ["a", "b"], viewing: true }), read);
  });
});

test("the inbox lists fresh entries newest revealed first, then those without a time", () => {
  const e = (id: string, revealedAt: string | null, imageId: string | null = null) =>
    ({ id, revealedAt, imageId }) as CodexEntry;
  const entries = [e("old", "2026-01-01"), e("none", null), e("new", "2026-02-01"), e("seen", "2026-03-01")];
  const fresh = new Set(entries.filter((x) => x.id !== "seen").map(entrySeenKey));
  assert.deepEqual(
    inboxEntries({ entries, fresh }).map((x) => x.id),
    ["new", "old", "none"],
  );
  // Each entry is read by its key as it stands: one whose picture changed is not the fresh one.
  assert.deepEqual(inboxEntries({ entries: [e("new", "2026-02-01", "p")], fresh }), []);
});
