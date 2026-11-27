import assert from "node:assert/strict";
import { test } from "node:test";

import type { FightLogLine } from "@inconsistable/core-schema";
import { compileRuleset, Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_HARM } from "../../../../packages/rules-engine/src/fixtures/sample-harm.ts";
import { fightLog, historyLines } from "./fight-log.ts";

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

test("HISTORY keeps every action, newest first, and counts the writes the log does not tell", () => {
  const lines = historyLines({
    history: [
      {
        id: "hit",
        at: "2026-11-01T10:01:00.000Z",
        undone: true,
        writes: [{ target: { actorId: "ogre", resource: "hp" }, kind: "add", before: 9, after: 6 }],
      },
      {
        id: "quiet",
        at: "2026-11-01T10:00:00.000Z",
        undone: false,
        writes: [
          { target: { turn: "used" }, kind: "set", before: [], after: ["hal"] },
          { target: { turn: "barred" }, kind: "set", before: [], after: [] },
        ],
      },
    ],
    names,
    ruleset,
  });
  assert.deepEqual(
    lines.map((l) => [l.id, l.undone, l.parts.map((p) => p.kind)]),
    [
      ["hit", true, ["change"]],
      ["quiet", false, ["other"]],
    ],
  );
  assert.deepEqual(lines[1]?.parts, [{ kind: "other", count: 2 }]);
});

test("a strike's outcome and a health state a hit brings an actor into warn in the ruleset's words (#190)", () => {
  const made = compileRuleset(SAMPLE_HARM);
  assert.ok(made.ok);
  const ogre = { name: "Ogre", entity: "brute", fields: { hide: 4 }, resources: { wounds: 9 }, derived: { limit: 4 } };
  const pack = { name: "Pack", entity: "swarm", fields: { size: 6 }, resources: { members: 5 }, derived: { limit: 1 } };
  const actors = new Map<string, typeof ogre | typeof pack>([
    ["ogre", ogre],
    ["pack", pack],
  ]);
  const strike = (targetId: string, outcome: string) => ({
    strikeId: "blow",
    attackerId: "ogre",
    targetId,
    means: null,
    total: 9,
    outcome,
    wounds: 1,
    shock: 0,
  });
  const rounds = fightLog({
    log: [
      line({
        id: "thin",
        strike: strike("pack", "thinned"),
        writes: [{ target: { actorId: "pack", resource: "members" }, kind: "add", before: 6, after: 5 }],
      }),
      line({
        id: "gone",
        writes: [
          { target: { actorId: "ogre", resource: "wounds" }, kind: "add", before: 3, after: 9 },
          { target: { actorId: "ogre", field: "gone" }, kind: "set", before: null, after: true },
        ],
      }),
      // Already down before this one: no new warning.
      line({
        id: "again",
        writes: [{ target: { actorId: "ogre", resource: "wounds" }, kind: "add", before: 8, after: 9 }],
      }),
    ],
    names: actors,
    ruleset,
    compiled: made.compiled,
  });
  const warns = rounds[0]!.turns[0]!.lines.map((l) => l.parts.filter((p) => p.kind === "warn"));
  assert.deepEqual(warns, [
    [{ kind: "warn", name: "Pack", text: "One of the swarm drops" }],
    [
      { kind: "warn", name: "Ogre", text: "Falls: each further wound leaves a scar" },
      { kind: "warn", name: "Ogre", text: "Destroyed outright" },
    ],
    [],
  ]);
  // Without the compiled ruleset no health state is told.
  const gone = line({
    writes: [{ target: { actorId: "ogre", field: "gone" }, kind: "set", before: null, after: true }],
  });
  const bare = fightLog({ log: [gone], names: actors, ruleset });
  assert.deepEqual(
    bare[0]!.turns[0]!.lines[0]!.parts.map((p) => p.kind),
    ["set"],
  );
});
