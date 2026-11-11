import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { CodexEntry } from "@inconsistable/core-schema";

import { filterEntries, savePatch } from "./codex.ts";

const entry = (over: Partial<CodexEntry>): CodexEntry => ({
  id: "e1",
  kind: "npc",
  title: "Old Maren",
  body: "Keeps the Lantern inn",
  gmNotes: "Is the spy",
  visibility: "gm",
  audienceMode: "all",
  audience: [],
  ...over,
});

const entries = [
  entry({ id: "a" }),
  entry({ id: "b", kind: "location", title: "The Lantern", body: "" }),
  entry({ id: "c", kind: "lore", title: "Tides", body: "Rise at dusk", gmNotes: "secret lantern" }),
];

const ids = (list: CodexEntry[]) => list.map((e) => e.id);

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
});
