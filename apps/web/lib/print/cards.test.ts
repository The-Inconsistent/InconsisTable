import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodexEntry } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { creatureCard, handoutPage, itemCard, layoutCards, tableText, tentCard, type PrintCard } from "./cards.ts";
import type { PrintWords } from "./sheet.ts";

const ruleset = Ruleset.parse(SAMPLE_D20);
const t: PrintWords = (key) => key;

const entry = (over: Partial<CodexEntry> & Pick<CodexEntry, "id" | "kind" | "title">): CodexEntry =>
  ({
    body: "",
    gmNotes: "",
    visibility: "party",
    audienceMode: "all",
    fields: {},
    layout: null,
    header: null,
    imageId: null,
    source: null,
    ...over,
  }) as CodexEntry;

const ash = {
  name: "Ash",
  entity: "character",
  fields: { level: 3 },
  resources: { hp: 9 },
  derived: { initBonus: 3, maxHp: 15, defense: 14 },
};

test("a tent card carries the name and the layout's trackerRow numbers, a resource at its limit", () => {
  const tracked = Ruleset.parse({
    ...SAMPLE_D20,
    layout: { ...SAMPLE_D20.layout, character: { sections: [], trackerRow: ["derived.defense", "res.hp", "gone"] } },
  });
  const card = tentCard({ ruleset: tracked, actor: ash, t, maxOf: (r) => (r === "hp" ? 15 : null) });
  assert.deepEqual(card, {
    kind: "tent",
    name: "Ash",
    stats: [
      { label: "Defense", value: "14" },
      { label: "Vigour", value: "15" },
    ],
  });
});

test("without a trackerRow, a tent card prints the derived values the seat holds, six at most", () => {
  const card = tentCard({ ruleset, actor: ash, t });
  assert.ok(card.kind === "tent");
  assert.ok(card.stats.length > 0 && card.stats.length <= 6);
  assert.ok(card.stats.every((s) => /^\d+$/.test(s.value)));
});

test("a creature card prints its numbers and cite, never its text", () => {
  const card = creatureCard({
    ruleset,
    entry: {
      name: "Ember Wisp",
      type: "creature",
      body: { level: 2, notes: "A long description from somewhere" },
      tags: ["fire"],
      cite: "Sample p.20",
    },
  });
  assert.ok(card.kind === "creature");
  assert.equal(card.cite, "Sample p.20");
  assert.deepEqual(card.tags, ["fire"]);
  assert.deepEqual(card.stats, [{ label: "Level", value: "2" }]);
  assert.ok(!JSON.stringify(card).includes("long description"));
});

test("an item card prints its fields and table text, never the GM's notes", () => {
  const secret = entry({ id: "s", kind: "npc", title: "The Hidden Hand", visibility: "gm" });
  const known = entry({ id: "k", kind: "npc", title: "Mira" });
  const item = entry({
    id: "i",
    kind: "item",
    title: "Lantern",
    body: "Given by @[Mira](k), forged for @[The Hidden Hand](s).",
    gmNotes: "Cursed",
    source: { entity: "gear", key: "lantern", cite: "Sample p.30" },
  });
  const card = itemCard({ ruleset, entry: item, entries: [secret, known, item], t });
  assert.deepEqual(card, {
    kind: "item",
    name: "Lantern",
    stats: [],
    text: "Given by Mira, forged for ….",
    cite: "Sample p.30",
  });
});

test("an item card names a linked entry only when every seat reads it, and leaves GM-only fields off", () => {
  // An item's fields as a ruleset might declare them: a link the party sees, and a GM-only note.
  const withFields = Ruleset.parse({
    ...SAMPLE_D20,
    codex: {
      kinds: {
        ...SAMPLE_D20.codex?.kinds,
        item: {
          fields: {
            maker: { type: "entry", label: "Maker", kind: "npc", visibility: "party" },
            curse: { type: "text", label: "Curse" },
          },
        },
      },
    },
  });
  // An entry field holds an entry id.
  const [S, L, K] = ["1", "2", "3"].map((n) => `00000000-0000-4000-8000-00000000000${n}`) as [string, string, string];
  const secret = entry({ id: S, kind: "npc", title: "The Hidden Hand", visibility: "gm" });
  const listed = entry({ id: L, kind: "npc", title: "Spy", audienceMode: "listed", audience: ["a"] });
  const known = entry({ id: K, kind: "npc", title: "Mira" });
  const item = (maker: string) =>
    entry({ id: "i", kind: "item", title: "Lantern", fields: { maker, curse: "Burns its holder" } });
  const card = (maker: string) =>
    itemCard({ ruleset: withFields, entry: item(maker), entries: [secret, listed, known], t });
  const stats = (maker: string) => {
    const c = card(maker);
    return c.kind === "item" ? c.stats : [];
  };
  assert.deepEqual(stats(K), [{ label: "Maker", value: "Mira" }]);
  assert.deepEqual(stats(S), [{ label: "Maker", value: "…" }]);
  assert.deepEqual(stats(L), [{ label: "Maker", value: "…" }]);
  assert.ok(!JSON.stringify(card(S)).includes("Burns"));
});

test("a mention to an entry only some characters read prints hidden", () => {
  const listed = entry({ id: "l", kind: "npc", title: "Spy", audienceMode: "listed", audience: ["a"] });
  assert.equal(tableText({ body: "@[Spy](l)", entries: [listed] }), "…");
});

test("cards go nine to a sheet", () => {
  const cards: PrintCard[] = Array.from({ length: 10 }, (_, i) => ({ kind: "tent", name: `N${i}`, stats: [] }));
  assert.deepEqual(
    layoutCards(cards).map((p) => p.length),
    [9, 1],
  );
  assert.deepEqual(layoutCards([]), []);
});

test("a transcript handout keeps its stamps; another layout has no lines", () => {
  const h = entry({
    id: "h",
    kind: "handout",
    title: "Tape",
    layout: "transcript",
    header: " REC ",
    body: "[03:12] Hello",
  });
  assert.deepEqual(handoutPage({ entry: h, entries: [h] }), {
    id: "h",
    title: "Tape",
    layout: "transcript",
    header: "REC",
    body: "[03:12] Hello",
    lines: [{ stamp: "03:12", text: "Hello" }],
    imageId: null,
  });
  assert.deepEqual(handoutPage({ entry: { ...h, layout: null }, entries: [] }).lines, []);
});
