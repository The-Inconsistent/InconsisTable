import assert from "node:assert/strict";
import { test } from "node:test";

import type { Actor } from "@inconsistable/core-schema";
import { compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_HARM, SAMPLE_HARM_ARMS } from "../../../../packages/rules-engine/src/fixtures/sample-harm.ts";
import {
  entryTypesOf,
  isPlan,
  meansOf,
  meansTexts,
  previewStrike,
  sayAloud,
  strikeHold,
  strikesFor,
  targetsOf,
} from "./strike.ts";

const made = compileRuleset(SAMPLE_HARM);
if (!made.ok) throw new Error(JSON.stringify(made.problems));
const compiled = made.compiled;
const ruleset = compiled.ruleset;
const blow = ruleset.strikes![0]!;
const entries = SAMPLE_HARM_ARMS.map((e) => ({ ...e, pack: "p", level: null, tags: [] }));

const actor = (id: string, entity: string, fields: Record<string, unknown>, derived: Record<string, number>) => ({
  id,
  name: id,
  entity,
  fields: fields as never,
  derived,
  resources: { wounds: 0, strain: 0, ...(entity === "swarm" ? { members: 6 } : {}) },
  ledger: null,
});
const hal = actor(
  "Hal",
  "hero",
  { grit: 4, arms: ["maul", "gone", "sling"] },
  { might: 4, guard: 3, toughness: 5, strainCap: 4 },
);
const ogre = actor("Ogre", "brute", { hide: 5, arms: ["claw"] }, { might: 5, guard: 2, toughness: 5, strainCap: 0 });
const rats = actor("Rats", "swarm", { size: 6 }, { might: 1, guard: 1, toughness: 1, strainCap: 2 });

test("the guide offers each type's strikes, the means it holds that the packs have, and every other fighter", () => {
  assert.deepEqual(
    strikesFor({ ruleset, actor: hal }).map((s) => s.id),
    ["blow", "sweep"],
  );
  assert.deepEqual(entryTypesOf({ ruleset, strike: blow }), ["arm"]);
  assert.deepEqual(
    meansOf({ ruleset, strike: blow, actor: hal, entries }).map((m) => [m.source, m.ref, m.name]),
    [
      [0, "maul", "Maul"],
      [0, "sling", "Sling"],
    ],
  );
  assert.deepEqual(
    targetsOf({ ruleset, strike: blow, attackerId: hal.id, fighting: [hal, ogre, rats] }).map((a) => a.id),
    ["Ogre", "Rats"],
  );
});

test("the preview is the engine's answer: wounds over the soak, a member off a swarm", () => {
  const [maul] = meansOf({ ruleset, strike: blow, actor: hal, entries });
  const preview = (target: typeof ogre, total: number | null) =>
    previewStrike({
      compiled,
      strike: blow,
      attacker: hal,
      target,
      means: maul,
      inputs: { aim: true },
      total,
      characters: 2,
      campaign: {},
    });
  const p = preview(ogre, 9);
  assert.ok(isPlan(p));
  assert.equal(p.pool.total, 5);
  assert.deepEqual(p.harm, { wounds: 4, shock: 0 });
  const swarm = preview(rats, 9);
  assert.ok(isPlan(swarm));
  assert.equal(swarm.outcome?.id, "thinned");
  const before = preview(ogre, null);
  assert.ok(isPlan(before));
  assert.equal(before.outcome, null); // nothing typed yet: the numbers and the notes only
  assert.equal(before.notes.length, 3); // the edge die, a brute without strain, a brutal maul
  assert.equal(
    previewStrike({
      compiled,
      strike: blow,
      attacker: hal,
      target: undefined,
      means: maul,
      inputs: {},
      total: 1,
      characters: 2,
      campaign: {},
    }),
    null,
  );
});

test("a held item of the strike's kind is a means, read from its loaded entry; a hand-written one is not", () => {
  const items = { kinds: [{ id: "arms", label: "Arms", entry: "arm", entities: ["hero"] }] } as Ruleset["items"];
  const carried = { ...blow, means: [{ from: "items" as const, kind: "arms" }] };
  const item = (id: string, kind: string, entry: string | null, name: string) =>
    ({ id, kind, entry, name }) as NonNullable<Actor["items"]>[number];
  const holder = {
    ...hal,
    items: [
      item("i1", "arms", "sling", "Sling"),
      item("i2", "arms", null, "Stick"),
      item("i3", "gear", "maul", "Maul"),
      item("i4", "arms", "gone", "gone"),
    ],
  };
  assert.deepEqual(entryTypesOf({ ruleset: { items }, strike: carried }), ["arm"]);
  assert.deepEqual(
    meansOf({ ruleset: { items }, strike: carried, actor: holder, entries }).map((m) => [m.source, m.ref, m.name]),
    [[0, "i1", "Sling"]],
  );
});

test("a held weapon strikes as its card shows it: its profile over the entry, with what is fitted to it", () => {
  const items = { kinds: [{ id: "arms", label: "Arms", entry: "arm", entities: ["hero"] }] } as Ruleset["items"];
  const sight = { path: "host.damage", mode: "add", value: "2", phase: "derived" } as const;
  const keen = { path: "derived.limit", mode: "add", value: "5", phase: "derived" } as const;
  const holder = {
    ...hal,
    ledger: {
      sheet: {
        weapons: [
          { name: "Maul", damage: 4 },
          { name: "Club", damage: 1 },
        ],
      },
    } as never,
    items: [
      { id: "i1", kind: "arms", entry: "sling", name: "Sling", profile: { damage: 5 } },
      { id: "i2", kind: "arms", entry: null, name: "Scope", fittedTo: "i1", effects: [sight, keen] },
      {
        id: "i3",
        kind: "arms",
        entry: null,
        name: "Weight",
        fittedTo: null,
        fittedLine: "weapons/Maul",
        effects: [sight],
      },
    ] as unknown as NonNullable<Actor["items"]>,
  };
  const carried = { ...blow, means: [{ from: "items" as const, kind: "arms" }] };
  const [sling] = meansOf({ ruleset: { items }, strike: carried, actor: holder, entries });
  // The profile's damage 5 over the entry's 3, the scope's 2 more; an effect on the holder changes no card number.
  assert.equal(sling?.values.damage, 7);
  assert.equal(sling?.values.pierce, -1);
  const lined = { ...blow, means: [{ from: "ledger" as const, lines: "weapons" as const }] };
  const [maul, club] = meansOf({ ruleset, strike: lined, actor: holder, entries });
  assert.equal(maul?.values.damage, 6);
  assert.equal(club?.values.damage, 1);
});

test("a means' text values are shown beside it, and the further numbers come with the plan", () => {
  const [maul, sling] = meansOf({ ruleset, strike: blow, actor: hal, entries });
  assert.deepEqual(meansTexts({ strike: blow, means: maul }), ["Brutal"]);
  assert.deepEqual(meansTexts({ strike: blow, means: sling }), ["Far", "Light"]);
  assert.deepEqual(meansTexts({ strike: blow, means: { source: 0, ref: "x", name: "X", values: { traits: 3 } } }), []);
  assert.deepEqual(meansTexts({ strike: blow, means: undefined }), []);
  const p = previewStrike({
    compiled,
    strike: blow,
    attacker: hal,
    target: ogre,
    means: maul,
    inputs: {},
    total: null,
    characters: 2,
    campaign: {},
  });
  assert.ok(isPlan(p));
  assert.deepEqual(
    p.shows.map((s) => [s.id, s.total]),
    [["damage", 9]],
  );
});

test("a phone sends a strike only as the server lets its owner, and says why not otherwise (house decision #113)", () => {
  const sweep = ruleset.strikes![1]!;
  const cb = (id: string, actorId: string, visibility: "full" | "bar", used?: string[]) =>
    ({ id, actorId, visibility, ...(used ? { used } : {}) }) as never;
  const encounter = (over: {
    currentId?: string | null;
    paused?: boolean;
    used?: string[];
    rats?: "full" | "bar";
  }) => ({
    currentId: over.currentId === undefined ? "c1" : over.currentId,
    paused: over.paused ?? false,
    combatants: [cb("c1", "Hal", "full", over.used), cb("c2", "Rats", over.rats ?? "full")],
  });
  const hold = (over: Parameters<typeof encounter>[0], strike = sweep, tableMode: "gm" | "gmless" = "gm") =>
    strikeHold({ strike, encounter: encounter(over), tableMode, attackerId: "Hal", targetId: "Rats" });
  assert.equal(hold({}), null);
  assert.equal(hold({}, blow), "strikeNotByOwner");
  assert.equal(hold({}, blow, "gmless"), null);
  assert.equal(hold({ currentId: "c2" }), "strikeNotYourTurn");
  assert.equal(hold({ currentId: null }), "strikeNotYourTurn");
  assert.equal(hold({ paused: true }), "sessionPaused");
  assert.equal(hold({ rats: "bar" }), "strikeTargetHidden");
  assert.equal(hold({ used: ["strike:sweep"] }), "usedThisRound");
  assert.equal(hold({ used: ["sweep", "strike:blow"] }), null);
});

test("the GM says the number to beat aloud when the target's players see only a bar, or nothing", () => {
  const combatants = [
    { actorId: "a", visibility: "bar" as const },
    { actorId: "b", visibility: "full" as const },
    { actorId: "c", visibility: "hidden" as const },
  ];
  assert.equal(sayAloud({ combatants, targetId: "a" }), true);
  assert.equal(sayAloud({ combatants, targetId: "b" }), false);
  assert.equal(sayAloud({ combatants, targetId: "c" }), true);
  assert.equal(sayAloud({ combatants, targetId: undefined }), false);
});
