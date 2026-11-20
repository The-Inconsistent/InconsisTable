import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodexEntry } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";

import { declaredFields, entryUrl, enumWords, fieldsPatch, listChips, shownFields } from "./entry-fields.ts";

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
});

test("the declared fields of a kind, in order; none without a block or a ruleset", () => {
  assert.deepEqual(
    declaredFields({ ruleset, kind: "npc" }).map((f) => f.id),
    ["mood", "disposition", "patron"],
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
  assert.deepEqual(listChips({ ruleset, entry }), [{ id: "mood", label: "Cold", note: "-2 to sway them" }]);
  assert.deepEqual(listChips({ ruleset: null, entry }), []);
});

test("an enum value reads as its label and note, or as its id", () => {
  const mood = declaredFields({ ruleset, kind: "npc" })[0]?.def;
  assert.ok(mood);
  assert.deepEqual(enumWords({ def: mood, value: "warm" }), { label: "Warm", note: null });
  const bare = { type: "enum" as const, label: "B", values: ["x"], visibility: "gm" as const };
  assert.deepEqual(enumWords({ def: bare, value: "x" }), { label: "x", note: null });
  assert.deepEqual(enumWords({ def: { ...bare, labels: {} }, value: "constructor" }), {
    label: "constructor",
    note: null,
  });
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
