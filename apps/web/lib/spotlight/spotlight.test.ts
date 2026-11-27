import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CodexEntry } from "@inconsistable/core-schema";

import { canHoldUp, dismissKey, spotlitEntry, xcardUp } from "./spotlight.ts";

const entry = (over: Partial<CodexEntry>): CodexEntry => ({
  id: "e1",
  kind: "npc",
  title: "Old Maren",
  body: "",
  gmNotes: "",
  visibility: "party",
  audienceMode: "all",
  audience: [],
  status: null,
  parentId: null,
  position: 0,
  links: [],
  plannedTests: [],
  imageId: null,
  imageRevealed: false,
  revealedAt: null,
  fields: {},
  layout: null,
  header: null,
  prep: null,
  source: null,
  ...over,
});

describe("spotlitEntry", () => {
  const entries = [entry({ id: "a" })];
  test("reads the entry from the seat's own codex", () => {
    assert.equal(spotlitEntry({ spotlight: { entryId: "a", audience: [], at: "t" }, entries, held: [] })?.id, "a");
  });
  test("nothing without a spotlight or for an entry the seat does not hold", () => {
    assert.equal(spotlitEntry({ spotlight: null, entries, held: [] }), null);
    assert.equal(spotlitEntry({ spotlight: { entryId: "b", audience: [], at: "t" }, entries, held: [] }), null);
  });
  test("a listed spotlight only for a seat holding one of its characters", () => {
    const spotlight = { entryId: "a", audience: ["pc1"], at: "t" };
    assert.equal(spotlitEntry({ spotlight, entries, held: ["pc1", "pc2"] })?.id, "a");
    assert.equal(spotlitEntry({ spotlight, entries, held: ["pc2"] }), null);
  });
});

describe("canHoldUp", () => {
  test("a handout, or an entry with a picture", () => {
    assert.equal(canHoldUp(entry({ kind: "handout" })), true);
    assert.equal(canHoldUp(entry({ imageId: "img" })), true);
    assert.equal(canHoldUp(entry({})), false);
  });
});

test("the dismiss key is per room", () => {
  assert.notEqual(dismissKey("a"), dismissKey("b"));
});

describe("xcardUp", () => {
  test("no touch yet: a spotlight shows", () => {
    assert.equal(xcardUp({ signal: 0, closedAt: 0 }), false);
  });
  test("an X-card touched before or after the card is up wins until it comes down", () => {
    // Either order is one state: touched since it last came down. The card yields, then opens again.
    assert.equal(xcardUp({ signal: 1, closedAt: 0 }), true);
    assert.equal(xcardUp({ signal: 1, closedAt: 1 }), false);
    assert.equal(xcardUp({ signal: 2, closedAt: 1 }), true);
  });
});
