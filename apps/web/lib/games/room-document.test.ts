import assert from "node:assert/strict";
import { test } from "node:test";

import { RoomDocument } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_D20 } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import {
  SAMPLE_SKIRMISH,
  SAMPLE_SKIRMISH_PREMISE,
} from "../../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import {
  documentProblem,
  premiseOf,
  roomDocument,
  stepOfPath,
  toLines,
  wizardGame,
  type WizardDraft,
} from "./room-document.ts";

const ID = "00000000-0000-4000-8000-000000000001";
const draft = (over: Partial<WizardDraft> = {}): WizardDraft => ({
  name: "  Raid on the ford ",
  ruleset: { slug: "sample-skirmish-premise", version: "0.1.0" },
  packs: [],
  fields: {},
  premise: null,
  safety: { lines: [], veils: [], xCard: false },
  ...over,
});

test("the premise is the kind the first checklist step asks a party field written of (house decision #142)", () => {
  const premise = premiseOf(Ruleset.parse(SAMPLE_SKIRMISH_PREMISE));
  assert.equal(premise?.kind, "lore");
  assert.equal(premise?.step.id, "premise");
  assert.deepEqual(
    premise?.fields.map((f) => f.id),
    ["premise", "patron", "style", "aim"],
  );
  const style = premise?.fields.find((f) => f.id === "style")?.def;
  assert.ok(style?.type === "tags");
  assert.deepEqual(style.options, ["raids", "intrigue", "survival"]);
});

test("a step that asks a value equal, or no checklist at all, names no premise", () => {
  // The skirmish's entry step asks for a faction whose standing is rival: not a premise written.
  assert.equal(premiseOf(Ruleset.parse(SAMPLE_SKIRMISH)), null);
  assert.equal(premiseOf(Ruleset.parse(SAMPLE_D20)), null);
  assert.equal(premiseOf(null), null);
});

test("what the wizard asks of a game: its campaign fields, premise and suggested lines", () => {
  const game = wizardGame(Ruleset.parse(SAMPLE_SKIRMISH_PREMISE));
  assert.deepEqual(Object.keys(game.campaignFields).sort(), ["chapter", "peril"]);
  assert.deepEqual(game.examples, { lines: ["Spiders", "Drowning", "Harm to animals"], cite: "Sample p.22" });
  assert.deepEqual(wizardGame(null), { campaignFields: {}, premise: null, examples: { lines: [], cite: null } });
});

test("an empty wizard is a room with its name and the ruleset it expects, nothing else", () => {
  const doc = roomDocument({ draft: draft() });
  assert.deepEqual(doc, {
    format: "inconsistable-room",
    version: 1,
    room: { name: "Raid on the ford" },
    expects: { ruleset: { slug: "sample-skirmish-premise", version: "0.1.0" } },
  });
  assert.ok(RoomDocument.safeParse(doc).success);
});

test("every part the GM filled goes in: packs, campaign values, limits and the premise the party sees", () => {
  const doc = roomDocument({
    draft: draft({
      packs: [{ slug: "sample-raiders", version: "0.1.0" }],
      fields: { chapter: 3, peril: 1 },
      premise: {
        kind: "lore",
        title: " The ford ",
        fields: { premise: "Hold the ford", patron: "", style: ["raids", "night work"], aim: null },
      },
      safety: { lines: ["Spiders"], veils: [], xCard: true },
    }),
    newId: () => ID,
  });
  assert.deepEqual(doc.expects?.packs, [{ slug: "sample-raiders", version: "0.1.0" }]);
  assert.deepEqual(doc.campaignFields, { chapter: 3, peril: 1 });
  assert.deepEqual(doc.room.safety, { lines: ["Spiders"], veils: [], xCard: true });
  assert.deepEqual(doc.codex, [
    {
      id: ID,
      kind: "lore",
      title: "The ford",
      visibility: "party",
      fields: { premise: "Hold the ford", style: ["raids", "night work"] },
    },
  ]);
  assert.ok(RoomDocument.safeParse(doc).success);
});

test("a game module's room names no ruleset, and a premise left blank makes no entry", () => {
  const doc = roomDocument({
    draft: draft({ ruleset: null, premise: { kind: "lore", title: "Premise", fields: { premise: "", style: [] } } }),
  });
  assert.equal(doc.expects, undefined);
  assert.equal(doc.codex, undefined);
});

test("a refusal's path names the step it belongs to", () => {
  assert.equal(stepOfPath("room.name"), "name");
  assert.equal(stepOfPath("room.safety.lines[2]"), "table");
  assert.equal(stepOfPath("campaignFields.chapter"), "campaign");
  assert.equal(stepOfPath("codex[0].fields.premise"), "premise");
  assert.equal(stepOfPath("expects.packs[0]"), "game");
  assert.equal(stepOfPath("module"), "game");
  assert.equal(stepOfPath("tableMode"), "table");
  assert.equal(stepOfPath(""), null);
});

test("the document is checked before it is sent: a blank name is the NAME step's", () => {
  assert.equal(documentProblem(roomDocument({ draft: draft() })), null);
  assert.equal(documentProblem(roomDocument({ draft: draft({ name: "  " }) }))?.step, "name");
  assert.deepEqual(
    documentProblem(roomDocument({ draft: draft({ safety: { lines: ["x".repeat(81)], veils: [], xCard: false } }) })),
    { step: "table", path: "room.safety.lines.0" },
  );
});

test("a ticked pack goes in as slug and version only, whatever else the page holds of it", () => {
  const ticked = { slug: "sample-raiders", version: "0.1.0", fromModule: false };
  const doc = roomDocument({ draft: draft({ packs: [ticked] }) });
  assert.deepEqual(doc.expects?.packs, [{ slug: "sample-raiders", version: "0.1.0" }]);
  assert.ok(RoomDocument.safeParse(doc).success);
});

test("the field the premise step asks for comes first, whatever order the stored manifest keeps", () => {
  const parsed = Ruleset.parse(SAMPLE_SKIRMISH_PREMISE);
  const lore = parsed.codex?.kinds.lore;
  assert.ok(lore);
  const { premise: asked, ...rest } = lore.fields;
  assert.ok(asked);
  const stored = {
    ...parsed,
    codex: { kinds: { ...parsed.codex?.kinds, lore: { ...lore, fields: { ...rest, premise: asked } } } },
  };
  assert.equal(premiseOf(stored)?.fields[0]?.id, "premise");
});

test("lines typed one per line are trimmed and blanks dropped", () => {
  assert.deepEqual(toLines(" Spiders \n\n  Drowning\n"), ["Spiders", "Drowning"]);
});
