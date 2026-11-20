import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodexEntry } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";

import {
  declaredFields,
  entryUrl,
  enumWords,
  fieldsPatch,
  linkedEntry,
  linkOptions,
  listChips,
  shownFields,
} from "./entry-fields.ts";

const ruleset = Ruleset.parse(SAMPLE_D20);

const npc = (fields: CodexEntry["fields"]): CodexEntry => ({
  id: "n",
  kind: "npc",
  title: "Harbourmaster",
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
  fields,
  layout: null,
  header: null,
  prep: null,
});

test("the declared fields of a kind, in order; none without a block or a ruleset", () => {
  assert.deepEqual(
    declaredFields({ ruleset, kind: "npc" }).map((f) => f.id),
    ["mood", "disposition", "patron", "home"],
  );
  assert.deepEqual(declaredFields({ ruleset, kind: "lore" }), []);
  assert.deepEqual(declaredFields({ ruleset: null, kind: "npc" }), []);
});

test("only declared fields with a value that fits are shown; a list's chips are its enums", () => {
  const entry = npc({ mood: "cold", disposition: 9, patron: "ember-wisp", gone: "x" });
  assert.deepEqual(
    shownFields({ ruleset, entry }).map((f) => f.id),
    ["mood", "patron"],
  );
  assert.deepEqual(listChips({ ruleset, entry }), [
    { id: "mood", label: "Cold", note: "-2 to sway them", tone: "bad" },
  ]);
  assert.deepEqual(listChips({ ruleset: null, entry }), []);
});

test("an enum value reads as its label, note and tone, or as its id", () => {
  const mood = declaredFields({ ruleset, kind: "npc" })[0]?.def;
  assert.ok(mood);
  assert.deepEqual(enumWords({ def: mood, value: "warm" }), { label: "Warm", note: null, tone: "good" });
  // A value without a tone draws as before.
  assert.deepEqual(enumWords({ def: mood, value: "wary" }), { label: "Wary", note: null, tone: null });
  const bare = { type: "enum" as const, label: "B", values: ["x"], visibility: "gm" as const };
  assert.deepEqual(enumWords({ def: bare, value: "x" }), { label: "x", note: null, tone: null });
  assert.deepEqual(enumWords({ def: { ...bare, labels: {}, tones: {} }, value: "constructor" }), {
    label: "constructor",
    note: null,
    tone: null,
  });
});

// House decision #76: a link field names another entry of the room.
const place = (id: string, title: string, over: Partial<CodexEntry> = {}): CodexEntry => ({
  ...npc({}),
  id,
  title,
  kind: "location",
  ...over,
});
const QUAY = "00000000-0000-4000-8000-000000000001";

test("a link's picker offers the room's entries of its kind by title, never the entry itself, narrowed by a search", () => {
  const entries = [
    place(QUAY, "Quay"),
    place("b", "Bell tower"),
    place("self", "Here", { kind: "npc" }),
    place("n", "Ned", { kind: "npc" }),
  ];
  assert.deepEqual(
    linkOptions({ entries, kind: "location", self: "self" }).map((e) => e.title),
    ["Bell tower", "Quay"],
  );
  assert.deepEqual(
    linkOptions({ entries, kind: "npc", self: "self" }).map((e) => e.id),
    ["n"],
  );
  assert.deepEqual(
    linkOptions({ entries, kind: "location", self: "self", q: " TOWER " }).map((e) => e.id),
    ["b"],
  );
  assert.deepEqual(linkOptions({ entries, kind: "faction", self: "self" }), []);
});

test("a reader sees a link it received as the entry it names, and nothing for an id it has no entry for", () => {
  const entry = npc({ home: QUAY, mood: "warm" });
  const home = shownFields({ ruleset, entry }).find((f) => f.id === "home");
  assert.ok(home);
  assert.equal(linkedEntry({ entries: [place(QUAY, "Quay")], id: home.value })?.title, "Quay");
  assert.equal(linkedEntry({ entries: [], id: home.value }), undefined);
  // Not an id: not shown at all, and never a chip.
  assert.deepEqual(
    shownFields({ ruleset, entry: npc({ home: "quay" }) }).map((f) => f.id),
    [],
  );
  assert.deepEqual(
    listChips({ ruleset, entry }).map((c) => c.id),
    ["mood"],
  );
});

test("a save sends only the fields that changed, null to clear one", () => {
  const entry = npc({ mood: "cold", disposition: 1 });
  assert.equal(fieldsPatch({ entry, draft: { mood: "cold", disposition: 1 } }), null);
  assert.deepEqual(fieldsPatch({ entry, draft: { mood: "warm", disposition: null, patron: null } }), {
    mood: "warm",
    disposition: null,
  });
});

test("one entry is read from the rules route by type and key", () => {
  assert.equal(
    entryUrl({ campaignId: "c 1", type: "creature", key: "ember-wisp" }),
    "/api/campaigns/c%201/rules?type=creature&key=ember-wisp&limit=1",
  );
});
