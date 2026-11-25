import assert from "node:assert/strict";
import { test } from "node:test";

import { gmAddress, parseGmAddress, type GmAddress } from "./gm-address.ts";

const q = (s: string) => new URLSearchParams(s);
const roundTrip = (a: GmAddress) => parseGmAddress(q(gmAddress(a)));

test("every tab's address reads back as written", () => {
  const cases: GmAddress[] = [
    { tab: "codex", kind: "npc", entry: "e1" },
    { tab: "codex" },
    { tab: "prep", scene: "s-1", mode: "run" },
    { tab: "scene", layer: "fight", preview: "s2" },
    { tab: "tests", test: "t_1" },
    { tab: "party" },
    { tab: "rules" },
  ];
  for (const c of cases) assert.deepEqual(roundTrip(c), c);
});

test("other parameters are kept in the order they came, and the address replaces its own keys", () => {
  const keep = q("quick=1&admin=1&tab=codex&entry=old&scene=x");
  assert.equal(
    gmAddress({ tab: "prep", scene: "s1", mode: "run" }, keep),
    "quick=1&admin=1&tab=prep&scene=s1&mode=run",
  );
});

test("the inner keys of another tab are dropped, on read and on write", () => {
  assert.deepEqual(parseGmAddress(q("tab=prep&scene=s1&entry=e1&kind=npc&test=t1")), { tab: "prep", scene: "s1" });
  assert.equal(gmAddress({ tab: "party", entry: "e1", scene: "s1" }), "tab=party");
});

test("an unknown or malformed value is dropped", () => {
  assert.deepEqual(parseGmAddress(q("tab=codex&kind=dragon&entry=a%20b")), { tab: "codex" });
  assert.deepEqual(parseGmAddress(q("tab=prep&mode=edit&scene=")), { tab: "prep" });
  assert.deepEqual(parseGmAddress(q("tab=nope")), { tab: "scene" });
  assert.deepEqual(parseGmAddress(q("")), { tab: "scene" });
});

test("the old ?tab=track opens SCENE on its fight layer", () => {
  assert.deepEqual(parseGmAddress(q("tab=track")), { tab: "scene", layer: "fight" });
});
