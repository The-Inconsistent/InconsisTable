import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodexEntry, LiveState } from "@inconsistable/core-schema";
import { compileRuleset } from "@inconsistable/rules-engine";

import { SAMPLE_HARM } from "../../../../packages/rules-engine/src/fixtures/sample-harm.ts";
import { SAMPLE_LEDGER_RULESET } from "../../../../packages/rules-engine/src/fixtures/sample-ledger-ruleset.ts";
import { isSeated, lineOf, objectivesOf, partyCardOf } from "./party-card.ts";

test("a card draws harm as what is left of its limit, the strip's other numbers, and the states that hold (#222)", () => {
  const c = compileRuleset(SAMPLE_HARM);
  assert.ok(c.ok);
  const ruleset = c.compiled.ruleset;
  const hero = {
    entity: "hero",
    fields: { grit: 3, scars: 0 },
    resources: { wounds: 2, strain: 0, resolve: 1 },
    derived: { limit: 6, strainCap: 3 },
  };
  const card = partyCardOf({ ruleset, compiled: c.compiled, actor: hero, characters: 1 });
  assert.deepEqual(
    card.bars.map((b) => [b.id, b.left, b.max]),
    [
      ["wounds", 4, 6],
      ["strain", 3, 3],
    ],
  );
  // The strip's wounds track is a bar already; grit and resolve are the line.
  assert.deepEqual(
    card.numbers.map((n) => [n.id, n.value]),
    [
      ["grit", 3],
      ["resolve", 1],
    ],
  );
  assert.deepEqual(card.states, ["Hurt"]);

  // Past its limit, nothing is left (never below 0), and only what the seat was sent is drawn.
  const fallen = partyCardOf({
    ruleset,
    compiled: c.compiled,
    actor: { ...hero, resources: { wounds: 9 } },
    characters: 1,
  });
  assert.deepEqual(
    fallen.bars.map((b) => [b.id, b.left]),
    [["wounds", 0]],
  );
  assert.deepEqual(fallen.states, ["Fallen"]);

  // Without the compiled ruleset there are no limits to draw against and no states.
  const bare = partyCardOf({ ruleset, compiled: null, actor: hero, characters: 1 });
  assert.deepEqual([bare.bars, bare.states], [[], []]);
});

test("the card's line is the library line's choice, else the first text field with a value (#222)", () => {
  const c = compileRuleset(SAMPLE_LEDGER_RULESET);
  assert.ok(c.ok);
  const ruleset = c.compiled.ruleset;
  const build = ruleset.build;
  assert.ok(build);
  const actor = (fields: Record<string, string>) => ({ entity: build.actor, fields, resources: {}, derived: {} });
  assert.equal(lineOf({ ruleset, actor: actor({ [build.sheet.archetype]: "Wanderer" }) }), "Wanderer");
  assert.equal(lineOf({ ruleset, actor: actor({}) }), null);
});

test("seated characters, and the quests listed to one character are its objectives (#223)", () => {
  const access: LiveState["access"] = {
    members: [{ userId: "u1", name: "Ana", role: "player", scopes: [], characterIds: ["a1"] }],
    invites: [],
    guests: [{ actorId: "a2" }],
    screens: 0,
    transfer: null,
  };
  assert.deepEqual(
    ["a1", "a2", "a3"].map((actorId) => isSeated({ access, actorId })),
    [true, true, false],
  );

  const quest = (id: string, more: Partial<CodexEntry>) => ({ id, kind: "quest", ...more }) as CodexEntry;
  const entries = [
    quest("q1", { visibility: "party", audienceMode: "listed", audience: ["a1"], status: "open" }),
    quest("q2", { visibility: "party", audienceMode: "listed", audience: ["a1", "a2"], status: "done" }),
    quest("q3", { visibility: "party", audienceMode: "all", audience: [], status: "open" }),
    quest("q4", { visibility: "gm", audienceMode: "listed", audience: ["a1"], status: "open" }),
    { ...quest("n1", { visibility: "party", audienceMode: "listed", audience: ["a1"] }), kind: "npc" } as CodexEntry,
  ];
  assert.deepEqual(
    objectivesOf({ entries, actorId: "a1" }).map((e) => e.id),
    ["q1", "q2"],
  );
  assert.deepEqual(
    objectivesOf({ entries, actorId: "a2" }).map((e) => e.id),
    ["q2"],
  );
});
