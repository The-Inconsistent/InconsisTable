import assert from "node:assert/strict";
import { test } from "node:test";

import { SAMPLE_PARAMS, sampleCatalogue } from "@/lib/ledger/sample";

import { buildOf, notHere, type LibraryEntry } from "./character-library";

const ENTRY: LibraryEntry = {
  id: "c1",
  name: "Wren",
  done: true,
  line: null,
  ruleset: { slug: "sample-ledger", version: "0.1.2" },
  rev: 3,
  updatedAt: "2026-11-21T10:00:00.000Z",
  build: '{"tier":1,"archetypeId":"no-such-archetype"}',
  packs: [{ slug: "sample-ledger-catalogue", version: "0.1.1" }],
  editable: false,
};
const ROOM = {
  slug: "sample-ledger",
  version: "0.1.2",
  packs: ["sample-ledger-catalogue", "homebrew-extras"],
  tier: 1,
};
const at = { params: SAMPLE_PARAMS, catalogue: sampleCatalogue() };

test("a done character of the room's ruleset and version, made with packs the room has, comes in", () => {
  assert.equal(notHere({ entry: ENTRY, room: ROOM, ...at }), null);
});

test("what the source app refuses, in the platform's terms", () => {
  assert.deepEqual(notHere({ entry: { ...ENTRY, done: false }, room: ROOM, ...at }), { why: "notDone" });
  assert.deepEqual(notHere({ entry: ENTRY, room: { ...ROOM, slug: "sample-d20" }, ...at }), {
    why: "otherGame",
    slug: "sample-ledger",
  });
  const homebrew = { ...ENTRY, packs: [...ENTRY.packs, { slug: "my-homebrew", version: "1.0.0" }] };
  assert.deepEqual(notHere({ entry: homebrew, room: ROOM, ...at }), { why: "missingPack", slug: "my-homebrew" });
  assert.deepEqual(notHere({ entry: ENTRY, room: { ...ROOM, tier: 2 }, ...at }), { why: "otherTier", tier: 1 });
});

test("another version of the ruleset comes only when the build still resolves ready here", () => {
  const got = notHere({ entry: ENTRY, room: { ...ROOM, version: "0.2.0" }, ...at });
  assert.equal(got?.why, "otherVersion");
  assert.ok(got?.why === "otherVersion" && got.detail.length > 0, "says what does not resolve");
});

test("a build is read as written, keys in order; anything else is none", () => {
  assert.deepEqual(Object.keys(buildOf(ENTRY) ?? {}), ["tier", "archetypeId"]);
  assert.equal(buildOf({ build: null }), null);
  assert.equal(buildOf({ build: "[1]" }), null);
  assert.equal(buildOf({ build: "{" }), null);
});
