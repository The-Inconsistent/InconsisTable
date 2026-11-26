import assert from "node:assert/strict";
import { test } from "node:test";

import { ScenePrep, type CodexEntry } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { lineNames, type PrepWorld, type SummaryWords } from "../scene-prep/scene-prep.ts";
import { plainText, printRunSheet } from "./run-sheet.ts";
import type { PrintWords } from "./sheet.ts";

const ruleset = Ruleset.parse(SAMPLE_D20);
const t: PrintWords = (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key);
const summary: SummaryWords = (key, values) => `${key} ${JSON.stringify(values ?? {})}`;

const ADV = "00000000-0000-4000-8000-0000000000a0";
const ONE = "00000000-0000-4000-8000-0000000000a1";
const TWO = "00000000-0000-4000-8000-0000000000a2";
const NPC = "00000000-0000-4000-8000-0000000000b1";

const entry = (over: Partial<CodexEntry> & Pick<CodexEntry, "id" | "kind" | "title">): CodexEntry => ({
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
  entry({ id: ADV, kind: "adventure", title: "The Ford", body: "Rain for three days.", gmNotes: "The bridge is out." }),
  entry({
    id: ONE,
    kind: "scene",
    title: "At the ford",
    parentId: ADV,
    body: "The water roars. @[Mira](" + NPC + ") waves from the bank.",
    gmNotes: "Mira lies about the toll.",
    links: [NPC],
    prep: ScenePrep.parse({
      tests: [{ id: "t", testId: "check", outcomes: [{ label: "Fail", text: "Swept away" }] }],
      exits: [{ id: "e", label: "Across", sceneId: TWO }],
    }),
  }),
  entry({ id: TWO, kind: "scene", title: "The far bank", parentId: ADV, position: 1 }),
  entry({ id: NPC, kind: "npc", title: "Mira", fields: { mood: "wary" } }),
];
const world: PrepWorld = {
  state: {
    testDefs: [{ id: "check", dice: "1d20", advantage: false, pool: null, outcomes: null, inputs: [] }],
    pools: [],
    actors: [],
    encounter: null,
    access: { members: [], guests: [] } as never,
    campaign: { fields: {} } as never,
  },
  entries,
  spawnable: { packs: [], entries: [], complete: true },
  ruleset,
};
const sheet = (gm: boolean) =>
  printRunSheet({
    adventure: entries[0]!,
    scenes: [entries[1]!, entries[2]!],
    world,
    names: lineNames(world),
    summary,
    t,
    gm,
  });

test("scenes print in order, with the body to read aloud, the links with their fields, and the lines", () => {
  const run = sheet(true);
  assert.equal(run.title, "The Ford");
  assert.deepEqual(
    run.scenes.map((s) => s.title),
    ["At the ford", "The far bank"],
  );
  const [first] = run.scenes;
  assert.equal(first?.readAloud, "The water roars. Mira waves from the bank.");
  assert.deepEqual(first?.links, [{ label: "kind.npc", items: ["Mira (Mood: Wary)"] }]);
  assert.deepEqual(
    first?.lines.map((l) => l.label),
    ["line.tests", "line.exits"],
  );
  assert.ok(first?.lines[0]?.items[0]?.endsWith("Fail: Swept away"));
  assert.equal(first?.lines[1]?.items[0], "Across");
});

test("the GM's notes and a Test's outcomes print only from the GM side", () => {
  const gm = sheet(true);
  assert.equal(gm.gmNotes, "The bridge is out.");
  assert.equal(gm.scenes[0]?.gmNotes, "Mira lies about the toll.");
  const not = sheet(false);
  assert.equal(not.gmNotes, "");
  assert.equal(not.scenes[0]?.gmNotes, "");
  assert.ok(!JSON.stringify(not).includes("Swept away"));
});

test("a mention prints as its title", () => {
  assert.equal(plainText("Ask @[Mira](x) and @[…](hidden)."), "Ask Mira and ….");
});
