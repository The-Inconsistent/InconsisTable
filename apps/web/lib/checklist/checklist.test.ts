import assert from "node:assert/strict";
import { test } from "node:test";

import type { CodexEntry, LiveState } from "@inconsistable/core-schema";
import { CHECKLIST_ANCHOR_IDS } from "@inconsistable/rules-engine";

import { anchorId, checklistRoom } from "./checklist.ts";

// House decision #90: the checklist counts what the GM's page already holds.
test("the room the checklist counts is the live state, the codex and the attached packs", () => {
  const state = {
    actors: [
      { entity: "character", ledger: null },
      { entity: "character", ledger: {} },
    ],
    campaign: { fields: { chapter: 2 }, safety: { lines: ["Fire"], veils: [], xCard: true } },
    pools: [{ id: "momentum", value: 1, min: 0, max: 6 }],
    journal: [{}, {}],
  } as unknown as Pick<LiveState, "actors" | "campaign" | "pools" | "journal">;
  const entries = [{ kind: "scene", fields: {}, prep: null }] as unknown as CodexEntry[];
  const room = checklistRoom({ state, entries, packs: [{ slug: "bestiary" }] });
  assert.deepEqual(room.actors, [
    { entity: "character", built: false },
    { entity: "character", built: true },
  ]);
  assert.equal(room.sessions, 2);
  assert.deepEqual(room.pools, [{ id: "momentum", value: 1 }]);
  assert.deepEqual(room.safety.lines, ["Fire"]);
  assert.deepEqual(room.entries, [{ kind: "scene", fields: {}, prep: null }]);
});

// House decision #200: each place GO TO lands on has an element id of its own.
test("every checklist anchor has its own element id", () => {
  const ids = CHECKLIST_ANCHOR_IDS.map((a) => anchorId(a));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(anchorId("session"), "goto-session");
});
