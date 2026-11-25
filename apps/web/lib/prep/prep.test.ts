import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CodexEntry } from "@inconsistable/core-schema";

import {
  groupLinks,
  linkCandidates,
  nameMatchesNone,
  namedNotLinked,
  prepTree,
  sceneTargets,
  stepIndex,
} from "./prep.ts";

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
  source: null,
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

describe("namedNotLinked", () => {
  const m = (e: CodexEntry) => `@[${e.title}](${e.id})`;
  const maren = entry({ id: "n", kind: "npc", title: "Maren" });
  const map = entry({ id: "h", kind: "handout", title: "Map" });
  const hall = entry({ id: "l", kind: "location", title: "Hall" });
  const all = [maren, map, hall, entry({ id: "adv2", kind: "adventure", title: "Saga" })];
  const named = (scene: CodexEntry) => ids(namedNotLinked({ scene, entries: [...all, scene] }));

  test("a scene that names nothing has nothing to link", () => {
    assert.deepEqual(named(entry({ id: "s", kind: "scene", body: "plain text" })), []);
  });
  test("a named entry already linked is left out", () => {
    assert.deepEqual(named(entry({ id: "s", kind: "scene", body: m(maren), links: ["n"] })), []);
  });
  test("an unknown id, an adventure and the scene itself are left out", () => {
    const body = `@[Ghost](gone) ${m(entry({ id: "adv2", title: "Saga" }))} @[Me](s)`;
    assert.deepEqual(named(entry({ id: "s", kind: "scene", body })), []);
  });
  test("an entry named twice is offered once, in first-mention order, across the body and the fields", () => {
    const scene = entry({
      id: "s",
      kind: "scene",
      body: `${m(map)} then ${m(maren)} and ${m(map)}`,
      fields: { readAloud: `the ${m(hall)} and ${m(maren)}`, level: 3, tags: ["x"] },
    });
    assert.deepEqual(named(scene), ["h", "n", "l"]);
  });
  test("a mention inside a field alone is found", () => {
    assert.deepEqual(named(entry({ id: "s", kind: "scene", fields: { goal: `find ${m(hall)}` } })), ["l"]);
  });
});

test("nameMatchesNone: a typed name is offered as new unless an entry has exactly that title", () => {
  assert.equal(nameMatchesNone({ entries, name: "maren" }), false);
  assert.equal(nameMatchesNone({ entries, name: "Maren Vale" }), true);
  assert.equal(nameMatchesNone({ entries, name: "  " }), false);
});

describe("sceneTargets", () => {
  test("scenes with a scene in play first, then planned, then played; loose scenes last", () => {
    const list = [
      entry({ id: "a", kind: "adventure" }),
      entry({ id: "d", kind: "scene", parentId: "a", position: 0, status: "done" }),
      entry({ id: "p", kind: "scene", parentId: "a", position: 1, status: "planned" }),
      entry({ id: "x", kind: "scene", parentId: "a", position: 2, status: "active" }),
      entry({ id: "free", kind: "scene", status: "planned" }),
    ];
    const got = sceneTargets(list);
    assert.deepEqual(
      got.map((g) => [g.adventure?.id ?? null, ids(g.scenes)]),
      [
        ["a", ["x", "p", "d"]],
        [null, ["free"]],
      ],
    );
  });
});
