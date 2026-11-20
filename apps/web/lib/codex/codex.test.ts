import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CodexEntry } from "@inconsistable/core-schema";

import { entryPath, filterEntries, newestRevealed, parentOptions, savePatch, treeRows, unfolded } from "./codex.ts";

const entry = (over: Partial<CodexEntry>): CodexEntry => ({
  id: "e1",
  kind: "npc",
  title: "Old Maren",
  body: "Keeps the Lantern inn",
  gmNotes: "Is the spy",
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
  entry({ id: "a" }),
  entry({ id: "b", kind: "location", title: "The Lantern", body: "" }),
  entry({ id: "c", kind: "lore", title: "Tides", body: "Rise at dusk", gmNotes: "secret lantern" }),
];

const ids = (list: CodexEntry[]) => list.map((e) => e.id);

test("newestRevealed: the latest reveal first, an entry with no time last", () => {
  const list = [
    entry({ id: "old", revealedAt: "2026-01-01T10:00:00.000Z" }),
    entry({ id: "none" }),
    entry({ id: "new", revealedAt: "2026-02-01T10:00:00.000Z" }),
  ];
  assert.deepEqual(ids(newestRevealed(list)), ["new", "old", "none"]);
});

describe("filterEntries", () => {
  test("a kind keeps only that kind", () => {
    assert.deepEqual(ids(filterEntries({ entries, kind: "location", query: "" })), ["b"]);
  });
  test("the query hits title and body, ignoring case, and not GM notes", () => {
    assert.deepEqual(ids(filterEntries({ entries, kind: "all", query: " LANTERN " })), ["a", "b"]);
  });
  test("kind and query combine", () => {
    assert.deepEqual(ids(filterEntries({ entries, kind: "npc", query: "lantern" })), ["a"]);
    assert.deepEqual(ids(filterEntries({ entries, kind: "lore", query: "lantern" })), []);
  });
});

describe("savePatch", () => {
  const e = entry({});
  const same = { title: e.title, body: e.body, gmNotes: e.gmNotes };
  test("nothing changed is an empty patch", () => {
    assert.deepEqual(savePatch({ entry: e, draft: same, canSecrets: true }), {});
  });
  test("only the changed fields are sent", () => {
    assert.deepEqual(savePatch({ entry: e, draft: { ...same, body: "New" }, canSecrets: true }), { body: "New" });
    assert.deepEqual(savePatch({ entry: e, draft: { ...same, title: "  Maren  " }, canSecrets: true }), {
      title: "Maren",
    });
  });
  test("gmNotes is omitted when the seat may not read secrets", () => {
    assert.deepEqual(savePatch({ entry: e, draft: { ...same, gmNotes: "" }, canSecrets: false }), {});
    assert.deepEqual(savePatch({ entry: e, draft: { ...same, gmNotes: "" }, canSecrets: true }), { gmNotes: "" });
  });
  test("a handout's layout and header are sent when they changed, and only then", () => {
    const h = entry({ kind: "handout", layout: "plain", header: "" });
    const kept = { ...same, layout: "plain" as const, header: "" };
    assert.deepEqual(savePatch({ entry: h, draft: kept, canSecrets: true }), {});
    assert.deepEqual(savePatch({ entry: h, draft: { ...kept, layout: "form", header: "No. 4" }, canSecrets: true }), {
      layout: "form",
      header: "No. 4",
    });
  });
});

describe("the entry tree", () => {
  const place = (id: string, parentId: string | null, position = 0) =>
    entry({ id, kind: "location", title: id, parentId, position });
  // top > (mid > leaf, side); "lost" names a parent the seat was not sent, so it is a root.
  const tree = [
    place("top", null),
    place("side", "top", 1),
    place("mid", "top", 0),
    place("leaf", "mid"),
    place("lost", "gone"),
  ];
  const rows = treeRows(tree);
  const shape = (list: { entry: CodexEntry; depth: number }[]) => list.map((r) => `${r.entry.id}:${r.depth}`);

  test("children follow their parent by position, one level deeper; an unknown parent makes a root", () => {
    assert.deepEqual(shape(rows), ["top:0", "mid:1", "leaf:2", "side:1", "lost:0"]);
    assert.deepEqual(
      rows.map((r) => r.inside),
      [3, 1, 0, 0, 0],
    );
  });
  test("a folded entry stays, its inside goes", () => {
    assert.deepEqual(shape(unfolded({ rows, folded: new Set(["mid"]) })), ["top:0", "mid:1", "side:1", "lost:0"]);
    assert.deepEqual(shape(unfolded({ rows, folded: new Set(["top"]) })), ["top:0", "lost:0"]);
  });
  test("the INSIDE picker leaves out the entry, its descendants and other kinds", () => {
    const all = [...tree, entry({ id: "npc" })];
    const options = (list: CodexEntry[], e: CodexEntry) =>
      ids(parentOptions({ entries: list, entry: e }).map((r) => r.entry));
    assert.deepEqual(options(all, place("mid", "top")), ["top", "side", "lost"]);
    const scene = entry({ id: "s", kind: "scene" });
    assert.deepEqual(options([...all, scene, entry({ id: "adv", kind: "adventure" })], scene), ["adv"]);
  });
  test("the path is the readable ancestors, root first, and stops on a loop", () => {
    assert.deepEqual(ids(entryPath({ entries: tree, entry: place("leaf", "mid") })), ["top", "mid"]);
    assert.deepEqual(ids(entryPath({ entries: tree, entry: place("lost", "gone") })), []);
    const x = place("x", "y");
    assert.equal(entryPath({ entries: [x, place("y", "x")], entry: x }).length, 2);
  });
});
