import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CodexEntry } from "@inconsistable/core-schema";

import { canHoldUp, dismissKey, spotlitEntry } from "./spotlight.ts";

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
    assert.equal(spotlitEntry({ spotlight: { entryId: "a", audience: [], at: "t" }, entries })?.id, "a");
  });
  test("nothing without a spotlight or for an entry the seat does not hold", () => {
    assert.equal(spotlitEntry({ spotlight: null, entries }), null);
    assert.equal(spotlitEntry({ spotlight: { entryId: "b", audience: [], at: "t" }, entries }), null);
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
