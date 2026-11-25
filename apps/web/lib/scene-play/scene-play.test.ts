import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodexEntry } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";
import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";

import { beginTakenBack, nextUp, pageFields, sceneCast, scenePlay, sceneNumber } from "./scene-play.ts";

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
