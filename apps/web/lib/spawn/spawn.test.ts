import assert from "node:assert/strict";
import { test } from "node:test";

import type { Actor, Encounter, LiveState } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_SKIRMISH } from "../../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import { SAMPLE_SKIRMISH_PACK } from "../../../../packages/rules-engine/src/fixtures/sample-skirmish-pack.ts";
import { entryValues, fightPicks, optionsFor, rosterPicks, spawnRoom, toggled } from "./spawn.ts";

const ruleset = Ruleset.parse(SAMPLE_SKIRMISH);
const body = (key: string) => SAMPLE_SKIRMISH_PACK.entries.find((e) => e.key === key)?.body ?? {};

test("the room counts the active characters and those a member's seat holds (house decision #92)", () => {
  const actor = (id: string, kind: string, status = "active") => ({ id, kind, status }) as unknown as Actor;
  const state = {
    actors: [actor("a", "pc"), actor("b", "pc"), actor("c", "pc", "retired"), actor("d", "creature")],
    access: { members: [{ characterIds: ["a", "c", "d"] }] },
    campaign: { fields: { peril: 2 } },
  } as unknown as Pick<LiveState, "actors" | "access" | "campaign">;
  assert.deepEqual(spawnRoom(state), { campaign: { peril: 2 }, characters: 2, seated: 1 });
});

test("an entry is offered the options its type and values may take", () => {
  const room = { campaign: { peril: 1 }, characters: 1, seated: 1 };
  const ids = (key: string | null) =>
    optionsFor({
      ruleset,
      type: "creature",
      values: key === null ? undefined : entryValues(body(key)),
      room,
      mob: false,
    }).map((o) => o.id);
  assert.deepEqual(ids("ash-hound"), ["quick", "scaled"]);
  assert.deepEqual(ids("iron-warden"), ["hardened", "quick", "scaled"]);
  assert.deepEqual(ids(null), ["hardened", "quick", "scaled"]);
  assert.deepEqual(optionsFor({ ruleset, type: "character", room, mob: false }), []);
  assert.deepEqual(toggled({ ids: ["a"], id: "b" }), ["a", "b"]);
  assert.deepEqual(toggled({ ids: ["a", "b"], id: "a" }), ["b"]);
});

test("the budget's picks: the creatures in the fight, and a roster's lines from the entries read", () => {
  const encounter = { combatants: [{ actorId: "x" }, { actorId: "pc" }] } as unknown as Encounter;
  const actors = [
    { id: "x", kind: "creature", fields: { kind: "brute" } },
    { id: "pc", kind: "pc", fields: {} },
  ] as unknown as Actor[];
  assert.deepEqual(fightPicks({ ruleset, encounter, actors }), [{ values: { kind: "brute" }, count: 1, mob: false }]);
  const bodies = new Map([["p/k", { kind: "minion", note: { x: 1 } }]]);
  const line = { id: "r", pack: "p", key: "k", count: 2, visibility: "hidden", temporary: true } as const;
  assert.deepEqual(rosterPicks({ prep: { roster: [line, { ...line, mob: 5 }, { ...line, key: "gone" }] }, bodies }), [
    { values: { kind: "minion" }, count: 2, mob: false },
    { values: { kind: "minion" }, count: 5, mob: true },
    { values: { kind: "minion" }, count: 5, mob: true },
  ]);
});
