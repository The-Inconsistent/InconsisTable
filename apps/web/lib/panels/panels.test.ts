import assert from "node:assert/strict";
import { test } from "node:test";

import type { Actor, Combatant, LiveState } from "@inconsistable/core-schema";
import { compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_HARM, SAMPLE_HARM_STANCES } from "../../../../packages/rules-engine/src/fixtures/sample-harm.ts";
import {
  SAMPLE_SKIRMISH,
  SAMPLE_SKIRMISH_MOVES,
} from "../../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import type { RulesEntry } from "@/lib/library/library";
import { layoutRows, optionGroups, panelNow, panelOfRow, panelScope } from "./panels.ts";

const rules = (input: unknown): Ruleset => {
  const r = compileRuleset(input);
  assert.ok(r.ok);
  return r.compiled.ruleset;
};
const HARM = rules(SAMPLE_HARM);
const SKIRMISH = rules(SAMPLE_SKIRMISH);

const hero = (resources: Record<string, number>, fields: Record<string, number> = {}): Actor =>
  ({
    id: "h",
    entity: "hero",
    fields: { grit: 3, scars: 1, ...fields },
    resources,
    derived: { limit: 6, strainCap: 3, might: 2 },
  }) as unknown as Actor;
const cb = (id: string, actorId: string, over: Partial<Combatant> = {}) =>
  ({ id, actorId, side: "party", states: [], ...over }) as Combatant;
const table = (currentId: string | null, combatants: Combatant[]): Pick<LiveState, "encounter" | "campaign"> =>
  ({
    encounter: { round: 1, currentId, combatants },
    campaign: { fields: {} },
  }) as unknown as Pick<LiveState, "encounter" | "campaign">;
const NO_FIGHT = { encounter: null, campaign: { fields: {} } } as unknown as Pick<LiveState, "encounter" | "campaign">;

const panel = (r: Ruleset, id: string) => r.panels!.find((p) => p.id === id)!;
const now = (r: Ruleset, id: string, actor: Actor, t: Pick<LiveState, "encounter" | "campaign">) =>
  panelNow({ ruleset: r, panel: panel(r, id), actor, table: t, characters: 2 });

test("the phone's turn and strip rows come from the character's own layout, else the shared one", () => {
  const turn = layoutRows({ ruleset: HARM, entity: "hero", target: "phoneTurn" });
  assert.deepEqual(
    turn?.map((row) => panelOfRow(HARM, row)?.id ?? null),
    ["incoming", "hit", "fallen", "stances", null, null],
  );
  assert.equal(layoutRows({ ruleset: HARM, entity: "brute", target: "phoneStrip" }), null);
  assert.equal(layoutRows({ ruleset: SKIRMISH, entity: "character", target: "phoneStrip" })?.length, 5);
});

test("incoming holds while a foe acts, with the lines and figures it reads (house decision #114)", () => {
  const fighting = [cb("c-h", "h"), cb("c-b", "b", { side: "foe" })];
  const shown = now(HARM, "incoming", hero({ wounds: 2, resolve: 1 }), table("c-b", fighting));
  assert.deepEqual(
    shown?.lines.map((l) => l.text),
    ["Say how you meet the blow before the dice land", "Resolve left: you may try again"],
  );
  assert.deepEqual(
    shown?.figures.map((f) => [f.label, f.value]),
    [
      ["Grit", 3],
      ["Wounds before you fall", 4],
    ],
  );
  assert.equal(now(HARM, "incoming", hero({ wounds: 2, resolve: 0 }), table("c-b", fighting))?.lines.length, 1);
  assert.equal(now(HARM, "incoming", hero({ wounds: 2, resolve: 0 }), table("c-h", fighting)), null);
  assert.equal(now(HARM, "incoming", hero({ wounds: 2, resolve: 0 }), NO_FIGHT), null);
});

test("a health state gates a panel both ways, read from the fight; outside a fight none holds", () => {
  const fallen = [cb("c-h", "h", { states: [{ id: "fallen", label: "Fallen" }] })];
  const standing = [cb("c-h", "h")];
  const actor = hero({ wounds: 8, resolve: 0 });
  assert.deepEqual(
    now(HARM, "fallen", actor, table(null, fallen))?.figures.map((f) => f.value),
    [1],
  );
  assert.equal(now(HARM, "fallen", actor, table(null, standing)), null);
  assert.equal(now(HARM, "stances", actor, table("c-h", fallen)), null);
  assert.ok(now(HARM, "stances", actor, table("c-h", standing)));
});

test("a sides order's panels read the bar, the held action and a status field", () => {
  const warden = {
    id: "w",
    entity: "character",
    fields: { healthState: "ok", deathSaveSuccesses: 0, deathSaveFailures: 0 },
    resources: { nerve: 1 },
    derived: { defense: 12 },
  } as unknown as Actor;
  const sides = (over: Partial<Combatant>, currentId: string | null) =>
    table(currentId, [cb("c-w", "w", { side: "wardens", ...over }), cb("c-r", "r", { side: "raiders" })]);
  assert.ok(now(SKIRMISH, "ambushed", warden, sides({ barred: true }, null)));
  assert.equal(now(SKIRMISH, "ambushed", warden, sides({}, null)), null);
  assert.deepEqual(now(SKIRMISH, "incoming", warden, sides({ held: true }, "c-r"))?.lines.length, 2);
  const dying = { ...warden, fields: { ...warden.fields, healthState: "dying" } } as Actor;
  assert.ok(now(SKIRMISH, "dying", dying, sides({}, "c-r")));
  assert.equal(now(SKIRMISH, "moves", dying, sides({}, "c-w")), null);
  assert.ok(now(SKIRMISH, "moves", warden, sides({}, "c-w")));
});

const entries = (list: readonly { key: string; type: string; name: string; cite: string; body: object }[]) =>
  list.map((e) => ({ ...e, pack: "p", level: null, tags: [], visibility: "party" }) as unknown as RulesEntry);

test("options are grouped, summarised, and the ones the holder cannot use sink with what they need", () => {
  const warden = {
    id: "w",
    entity: "character",
    fields: { healthState: "ok" },
    resources: { nerve: 1 },
    derived: {},
  } as unknown as Actor;
  const scope = panelScope({ ruleset: SKIRMISH, actor: warden, table: NO_FIGHT, characters: 2 });
  const groups = optionGroups({
    ruleset: SKIRMISH,
    options: panel(SKIRMISH, "moves").options!,
    entries: entries(SAMPLE_SKIRMISH_MOVES),
    scope,
  });
  assert.deepEqual(
    groups.map((g) => [g.label, g.lines.map((l) => [l.name, l.usable, l.needs])]),
    [
      [
        "Strikes",
        [
          ["Lunge", true, null],
          ["Feint", false, "2 Nerve"],
        ],
      ],
      ["Guards", [["Brace", true, null]]],
      ["Steps", [["Sidestep", true, null]]],
    ],
  );
  const stances = optionGroups({
    ruleset: HARM,
    options: panel(HARM, "stances").options!,
    entries: entries(SAMPLE_HARM_STANCES),
    scope: panelScope({ ruleset: HARM, actor: hero({}), table: NO_FIGHT, characters: 2 }),
  });
  // Guarded needs the maul carried (house decision #180): without it, it sinks.
  assert.deepEqual(
    stances.map((g) => [g.label, g.lines.map((l) => l.summary)]),
    [[null, ["One more die, one less guard", "Strain first, wounds after"]]],
  );
  const armed = { ...hero({}), items: [{ kind: "carried", entry: "maul", tags: ["heavy"] }] } as unknown as Actor;
  const carried = panelScope({ ruleset: HARM, actor: armed, table: NO_FIGHT, characters: 2 });
  assert.deepEqual((carried.ctx as { carried: unknown }).carried, { carried: ["maul", "heavy"] });
  assert.ok(
    optionGroups({
      ruleset: HARM,
      options: panel(HARM, "stances").options!,
      entries: entries(SAMPLE_HARM_STANCES),
      scope: carried,
    })[0]!.lines.every((l) => l.usable),
  );
});

test("Incoming reads the acting swarm only when the seat was sent it (house decision #180)", () => {
  const swarm = (size?: number) =>
    ({
      id: "s",
      entity: "swarm",
      fields: size === undefined ? {} : { size },
      resources: {},
      derived: {},
    }) as unknown as Actor;
  const fight = (foe: Actor | null) => ({
    ...table("c2", [cb("c1", "h"), cb("c2", "s", { side: "foes" })]),
    actors: foe === null ? [] : [foe],
  });
  const lines = (foe: Actor | null) =>
    panelNow({
      ruleset: HARM,
      panel: panel(HARM, "incoming"),
      actor: hero({ resolve: 0 }),
      table: fight(foe),
      characters: 2,
    })?.lines.map((l) => l.text);
  assert.ok(lines(swarm(12))?.includes("A swarm this big strikes twice"));
  assert.ok(!lines(swarm(4))?.includes("A swarm this big strikes twice"));
  assert.ok(!lines(swarm())?.includes("A swarm this big strikes twice"), "a size not sent");
  assert.ok(!lines(null)?.includes("A swarm this big strikes twice"), "a foe not sent");
});
