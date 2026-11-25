import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodexEntry } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";
import { EMPTY_PREP, type PrepWorld } from "@/lib/scene-prep/scene-prep";
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";

import {
  beginTakenBack,
  nextUp,
  pageFields,
  sceneCast,
  sceneFixes,
  sceneGlance,
  sceneMissions,
  scenePoolLines,
  sceneTagline,
  scenePlay,
  sceneNumber,
} from "./scene-play.ts";

const entry = (id: string, over: Partial<CodexEntry> = {}): CodexEntry => ({
  id,
  kind: "scene",
  title: id,
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
const adv = (id: string, position: number) => entry(id, { kind: "adventure", position });
const scene = (id: string, parentId: string | null, position: number, status: CodexEntry["status"]) =>
  entry(id, { parentId, position, status });

test("scenePlay: the active scene, its adventure, the strip in order with played ones marked", () => {
  const entries = [
    scene("s3", "a", 2, "planned"),
    scene("s1", "a", 0, "done"),
    scene("s2", "a", 1, "active"),
    scene("x", "b", 0, "skipped"),
    adv("a", 0),
    adv("b", 1),
  ];
  const p = scenePlay(entries);
  assert.equal(p.playing?.id, "s2");
  assert.equal(p.adventure?.id, "a");
  assert.deepEqual(
    p.strip.map((s) => [s.scene.id, s.played, s.playing]),
    [
      ["s1", true, false],
      ["s2", false, true],
      ["s3", false, false],
    ],
  );
  assert.equal(sceneNumber({ strip: p.strip, id: "s3" }), 3);
  assert.equal(sceneNumber({ strip: p.strip, id: "zzz" }), null);
});

test("scenePlay: no active scene gives an empty page; a skipped one counts as played", () => {
  const p = scenePlay([adv("a", 0), scene("s1", "a", 0, "skipped")]);
  assert.deepEqual([p.playing, p.adventure, p.strip], [null, null, []]);
  const q = scenePlay([adv("a", 0), scene("s1", "a", 0, "active"), scene("s2", "a", 1, "skipped")]);
  assert.equal(q.strip[1]?.played, true);
});

test("nextUp: first planned scene per adventure, running adventures first, none for a finished or loose one", () => {
  const entries = [
    adv("fresh", 0),
    scene("f1", "fresh", 0, null),
    adv("running", 1),
    scene("r1", "running", 0, "done"),
    scene("r2", "running", 1, "planned"),
    adv("over", 2),
    scene("o1", "over", 0, "done"),
    scene("o2", "over", 1, "skipped"),
    scene("loose", null, 0, "planned"),
  ];
  assert.deepEqual(
    nextUp(entries).map((o) => [o.adventure.id, o.scene.id]),
    [
      ["running", "r2"],
      ["fresh", "f1"],
    ],
  );
  assert.deepEqual(nextUp([]), []);
});

test("sceneCast: links by kind in the scene's order; shown once visible to the party or public", () => {
  const s = entry("s", { links: ["h", "n", "gone"] });
  const entries = [
    s,
    entry("h", { kind: "handout", visibility: "party" }),
    entry("n", { kind: "npc", visibility: "gm" }),
    entry("unlinked", { kind: "npc" }),
  ];
  assert.deepEqual(
    sceneCast({ scene: s, entries }).map((g) => [g.kind, g.entries.map((e) => [e.entry.id, e.shown])]),
    [
      ["npc", [["n", false]]],
      ["handout", [["h", true]]],
    ],
  );
});

test("pageFields: a gm field lands in closed, the rest open", () => {
  const rs = Ruleset.parse({
    ...SAMPLE_D20,
    codex: {
      kinds: {
        scene: {
          fields: {
            aloud: { type: "text", label: "Read aloud", visibility: "party" },
            secret: { type: "text", label: "Secret", visibility: "gm" },
            goal: { type: "text", label: "Goal", visibility: "party" },
          },
        },
      },
    },
  });
  const e = entry("s", { fields: { aloud: "a", secret: "b", goal: "c" } });
  const { open, closed } = pageFields({ ruleset: rs, entry: e });
  assert.deepEqual(open.map((f) => f.id).sort(), ["aloud", "goal"]);
  assert.deepEqual(
    closed.map((f) => f.id),
    ["secret"],
  );
  assert.deepEqual(pageFields({ ruleset: null, entry: e }), { open: [], closed: [] });
});

test("beginTakenBack: only while the begin's scene is still active", () => {
  const begin = { id: "b", sceneId: "s", revealed: [] };
  assert.equal(beginTakenBack({ begin, entries: [scene("s", null, 0, "active")] })?.scene.id, "s");
  assert.equal(beginTakenBack({ begin, entries: [scene("s", null, 0, "done")] }), null);
  assert.equal(beginTakenBack({ begin: null, entries: [scene("s", null, 0, "active")] }), null);
});

const readyRules = Ruleset.parse({
  ...SAMPLE_D20,
  codex: {
    kinds: {
      scene: {
        fields: {
          goal: { type: "text", label: "Goal", visibility: "gm", cite: "Sample p.1" },
          aloud: { type: "text", label: "Read aloud", visibility: "party", maxLength: 5, cite: "Sample p.1" },
        },
        ready: ["goal", "aloud"],
      },
    },
  },
});
const exitTo = (id: string, sceneId: string) => ({ id, label: `To ${sceneId}`, sceneId });
const prepOf = (over: object) => ({ roster: [], tests: [], pools: [], exits: [], reveals: [], picks: [], ...over });

test("sceneFixes: an empty or no longer fitting ready field, and an exit leading nowhere", () => {
  const b = scene("b", "a", 1, "planned");
  const a = entry("a2", {
    parentId: "a",
    fields: { goal: "  ", aloud: "too long for it" },
    prep: prepOf({ exits: [exitTo("e1", "b"), exitTo("e2", "gone")] }) as CodexEntry["prep"],
  });
  assert.deepEqual(sceneFixes({ ruleset: readyRules, scene: a, entries: [a, b] }), [
    { kind: "field", fieldId: "goal", label: "Goal" },
    { kind: "field", fieldId: "aloud", label: "Read aloud" },
    { kind: "exit", lineId: "e2", label: "To gone" },
  ]);
});

test("sceneFixes: ready is the empty list; no ready declared leaves only exits", () => {
  const ok = entry("s", { fields: { goal: "x", aloud: "ok" } });
  assert.deepEqual(sceneFixes({ ruleset: readyRules, scene: ok, entries: [ok] }), []);
  const bare = entry("s", { prep: prepOf({ exits: [exitTo("e", "gone")] }) as CodexEntry["prep"] });
  assert.deepEqual(sceneFixes({ ruleset: null, scene: bare, entries: [bare] }), [
    { kind: "exit", lineId: "e", label: "To gone" },
  ]);
  assert.deepEqual(sceneFixes({ ruleset: null, scene: entry("s"), entries: [] }), []);
});

test("sceneTagline: the first open text field, else the body's first line, cut short", () => {
  const withGoal = entry("s", { body: "Body line", fields: { goal: "secret goal", aloud: "Aloud" } });
  assert.equal(sceneTagline({ ruleset: readyRules, scene: withGoal }), "Aloud");
  const mention = entry("s", { body: "\n  Meet @[Mira](n1) at dawn\nsecond" });
  assert.equal(sceneTagline({ ruleset: null, scene: entry("s", { body: "A\nB" }) }), "A");
  assert.equal(sceneTagline({ ruleset: null, scene: mention }), "Meet Mira at dawn");
  assert.equal(sceneTagline({ ruleset: null, scene: entry("s", { body: "x".repeat(200) }) }).length, 90);
  assert.equal(sceneTagline({ ruleset: null, scene: entry("s") }), "");
});

test("sceneGlance: links by kind, handouts and items, lines, fighters and what is shown on entry", () => {
  const npc = entry("n", { kind: "npc" });
  const handout = entry("h", { kind: "handout" });
  const item = entry("i", { kind: "item" });
  const s = entry("s", {
    links: ["n", "h", "i"],
    prep: prepOf({
      tests: [{ id: "t1" }],
      roster: [
        { id: "r1", count: 2 },
        { id: "r2", count: 3 },
      ],
      exits: [exitTo("e", "s")],
      reveals: [
        { id: "v1", entryId: "h" },
        { id: "v2", entryId: "gone" },
      ],
    }) as CodexEntry["prep"],
  });
  const g = sceneGlance({ scene: s, entries: [s, npc, handout, item] });
  assert.deepEqual(g.byKind, [
    { kind: "npc", count: 1 },
    { kind: "item", count: 1 },
    { kind: "handout", count: 1 },
  ]);
  assert.deepEqual([g.handouts, g.items, g.tests, g.combatants, g.exits], [1, 1, 1, 5, 1]);
  assert.deepEqual(
    g.shownOnEntry.map((e) => e.id),
    ["h"],
  );
  assert.deepEqual(sceneGlance({ scene: entry("e"), entries: [] }).byKind, []);
});

test("sceneMissions: quests linked to the scene or its adventure, once each, with status and who they are listed to", () => {
  const quest = (id: string, over: Partial<CodexEntry> = {}) => entry(id, { kind: "quest", status: "open", ...over });
  const entries = [
    quest("q1", { audienceMode: "listed", audience: ["a1", "a2"] }),
    quest("q2", { status: "done" }),
    entry("n", { kind: "npc" }),
  ];
  const s = entry("s", { links: ["q1", "n", "gone", "q2"] });
  const a = entry("a", { kind: "adventure", links: ["q2", "q1"] });
  const got = sceneMissions({ scene: s, adventure: a, entries });
  assert.deepEqual(
    got.map((m) => [m.quest.id, m.status, m.audience]),
    [
      ["q1", "open", ["a1", "a2"]],
      ["q2", "done", []],
    ],
  );
  assert.deepEqual(
    sceneMissions({ scene: entry("s2"), adventure: entry("a2", { kind: "adventure", links: ["q2"] }), entries }).map(
      (m) => m.quest.id,
    ),
    ["q2"],
  );
  assert.deepEqual(sceneMissions({ scene: entry("s3"), adventure: null, entries }), []);
});

test("scenePoolLines: the pool lines of the scene being played that name the pool", () => {
  const prep = {
    ...EMPTY_PREP,
    pools: [
      { id: "p1", pool: "glory", amount: 1, text: "" },
      { id: "p2", pool: "ruin", amount: -1, text: "" },
      { id: "p3", pool: "glory", amount: -2, text: "" },
    ],
  };
  const entries = [entry("s1", { status: "done", prep }), entry("s2", { status: "active", prep })];
  const world = { state: { pools: [] }, entries, spawnable: { packs: [], entries: [], complete: true } };
  const got = scenePoolLines({ entries, pool: "glory", world: world as unknown as PrepWorld });
  assert.deepEqual(
    got.map((g) => [g.line.id, g.resolved.state]),
    [
      ["p1", "broken"],
      ["p3", "broken"],
    ],
  );
  assert.deepEqual(
    scenePoolLines({ entries: [entry("s", { prep })], pool: "glory", world: world as unknown as PrepWorld }),
    [],
  );
});
