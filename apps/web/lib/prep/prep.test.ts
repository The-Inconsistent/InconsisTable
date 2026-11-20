import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CodexEntry } from "@inconsistable/core-schema";

import { groupLinks, linkCandidates, prepTree, stepIndex } from "./prep.ts";

const entry = (over: Partial<CodexEntry>): CodexEntry => ({
  id: "e",
  kind: "npc",
  title: "Maren",
  body: "",
  gmNotes: "",
  visibility: "gm",
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
  ...over,
});

const entries = [
  entry({ id: "adv", kind: "adventure" }),
  entry({ id: "s2", kind: "scene", parentId: "adv", position: 1, links: ["n", "h", "gone"] }),
  entry({ id: "s1", kind: "scene", parentId: "adv", position: 0 }),
  entry({ id: "orphan", kind: "scene", parentId: "hidden" }),
  entry({ id: "n", kind: "npc", title: "Maren" }),
  entry({ id: "h", kind: "handout", title: "Map" }),
];
const ids = (list: CodexEntry[]) => list.map((e) => e.id);

describe("prepTree", () => {
  test("scenes follow their position, and one whose adventure is unseen is loose", () => {
    const tree = prepTree(entries);
    assert.deepEqual(ids(tree.adventures[0]?.scenes ?? []), ["s1", "s2"]);
    assert.deepEqual(ids(tree.loose), ["orphan"]);
  });
});

describe("stepIndex", () => {
  const scenes = entries.filter((e) => e.id.startsWith("s"));
  test("a step inside the list is the new index; off either end is null", () => {
    assert.equal(stepIndex({ siblings: scenes, id: "s2", step: 1 }), 1);
    assert.equal(stepIndex({ siblings: scenes, id: "s2", step: -1 }), null);
    assert.equal(stepIndex({ siblings: scenes, id: "orphan", step: 1 }), null);
  });
});

describe("groupLinks and linkCandidates", () => {
  const scene = entries[1] as CodexEntry;
  test("links group by kind and skip an entry the seat lost", () => {
    const groups = groupLinks({ entry: scene, entries });
    assert.deepEqual(
      groups.map((g) => [g.kind, ids(g.entries)]),
      [
        ["npc", ["n"]],
        ["handout", ["h"]],
      ],
    );
  });
  test("candidates are linkable kinds not linked yet, filtered by title", () => {
    assert.deepEqual(ids(linkCandidates({ entry: scene, entries, query: "" })), []);
    assert.deepEqual(ids(linkCandidates({ entry: entries[2] as CodexEntry, entries, query: " MAP " })), ["h"]);
  });
});
