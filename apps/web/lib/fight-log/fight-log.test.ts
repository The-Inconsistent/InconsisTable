import assert from "node:assert/strict";
import { test } from "node:test";

import type { FightLogLine } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_HARM } from "../../../../packages/rules-engine/src/fixtures/sample-harm.ts";
import { fightLog } from "./fight-log.ts";

const ruleset = Ruleset.parse(SAMPLE_HARM);
const names = new Map([
  ["hal", { name: "Hal" }],
  ["ogre", { name: "Ogre" }],
]);
const line = (over: Partial<FightLogLine>): FightLogLine => ({
  id: "a",
  round: 1,
  actorId: null,
  undone: false,
  writes: [],
  ...over,
});

test("each action is worded from what it wrote: who, what, how much, in rounds and turns, newest first", () => {
  const log: FightLogLine[] = [
    line({
      id: "strike",
      actorId: "hal",
      strike: {
        strikeId: "blow",
        attackerId: "hal",
        targetId: "ogre",
        means: "Maul",
        total: 8,
        outcome: "wounded",
        wounds: 3,
        shock: 0,
      },
      writes: [{ target: { actorId: "ogre", resource: "wounds" }, kind: "add", before: 0, after: 3 }],
    }),
    line({
      id: "dazed",
      actorId: "hal",
      undone: true,
      writes: [
        {
          target: { actorId: "ogre", condition: "c1" },
          kind: "set",
          before: null,
          after: { conditionId: "dazed", stacks: 1, source: "manual", expiresOn: "manual" },
        },
      ],
    }),
    line({
      id: "step",
      actorId: "hal",
      writes: [
        { target: { turn: "currentId" }, kind: "set", before: null, after: "hal" },
        { target: { turn: "used" }, kind: "set", before: [], after: [] },
      ],
    }),
    line({ id: "quiet", writes: [{ target: { turn: "used" }, kind: "set", before: [], after: ["x"] }] }),
  ];
  const rounds = fightLog({ log, names, ruleset });
  assert.equal(rounds.length, 1);
  const [turn, ...rest] = rounds[0]!.turns;
  assert.equal(rest.length, 0); // the bookkeeping-only action says nothing and is left out
  assert.equal(turn?.name, "Hal");
  assert.deepEqual(
    turn?.lines.map((l) => [l.id, l.undone, l.parts]),
    [
      [
        "strike",
        false,
        [
          { kind: "strike", attacker: "Hal", target: "Ogre", means: "Maul", outcome: "Wounded", total: 8 },
          { kind: "change", name: "Ogre", label: "Wounds", by: 3 },
        ],
      ],
      ["dazed", true, [{ kind: "condition", name: "Ogre", label: "Dazed", on: true }]],
      ["step", false, [{ kind: "acts", name: "Hal" }]],
    ],
  );
});

test("a new round and a turn's end start their own groups", () => {
  const rounds = fightLog({
    log: [
      line({
        id: "r2",
        round: 2,
        writes: [{ target: { turn: "round" }, kind: "set", before: 1, after: 2 }],
      }),
      line({
        id: "end",
        round: 1,
        writes: [{ target: { turn: "currentId" }, kind: "set", before: "ogre", after: null }],
      }),
      line({
        id: "pool",
        round: 1,
        actorId: "ogre",
        writes: [{ target: { pool: "resolve" }, kind: "add", before: 2, after: 1 }],
      }),
    ],
    names,
    ruleset,
  });
  assert.deepEqual(
    rounds.map((r) => [r.round, r.turns.map((t) => [t.name, t.lines.map((l) => l.parts[0])])]),
    [
      [2, [[null, [{ kind: "round", round: 2 }]]]],
      [
        1,
        [
          [null, [{ kind: "ends", name: "Ogre" }]],
          ["Ogre", [{ kind: "change", name: null, label: "Resolve", by: -1 }]],
        ],
      ],
    ],
  );
});
