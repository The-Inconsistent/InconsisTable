import { z } from "zod";

import { CombatVisibility } from "./encounter.ts";
import { TestInputs } from "./test-call.ts";

// A scene's prepared lines (ADR 0012 decision 3, house decision #73): each line is an action the table already has,
// parked until the GM sends it. The document is read and written whole; only shapes and limits are checked at save, so a
// line may name a pack entry, Test, pool, scene or entry that does not exist (the GM's screen shows it as broken).

export const MAX_PREP_LINES = 40; // of each kind
export const MAX_PREP_BYTES = 32 * 1024; // the document, serialized
export const MAX_TEST_OUTCOMES = 6;

// The scene's own place in play. At most one scene of a room is active; making one active leaves the other done.
export const SceneStatus = z.enum(["planned", "active", "done", "skipped"]);
export type SceneStatus = z.infer<typeof SceneStatus>;

const id = z.uuid();
// What every line carries: its id inside the document (so a screen can address it), and the GM's own words.
const line = {
  id: z.string().min(1).max(40),
  label: z.string().max(80).optional(),
  note: z.string().max(500).optional(),
};

// A pack entry by the pack's slug and the entry's key, durable across the pack's versions: the attached version is
// found when the line is sent. `mob` makes each one a mob of that many (house decision #66).
export const RosterLine = z.object({
  ...line,
  pack: z.string().min(1).max(64),
  key: z.string().min(1).max(80),
  count: z.int().min(1).max(50),
  mob: z.int().min(2).max(500).optional(),
  visibility: CombatVisibility.default("hidden"),
  temporary: z.boolean().default(true),
});
export type RosterLine = z.infer<typeof RosterLine>;

// Who takes a prepared Test: the characters holding a seat when it is sent, or the listed actors.
export const TestTakers = z.enum(["party", "listed"]);
export type TestTakers = z.infer<typeof TestTakers>;

export const TestLine = z.object({
  ...line,
  testId: z.string().min(1).max(64),
  inputs: TestInputs.default({}),
  takers: TestTakers.default("party"),
  actorIds: z.array(id).max(50).default([]),
  hideTarget: z.boolean().default(false),
  // What the GM reads aloud or acts on for each result; never sent to a phone.
  outcomes: z
    .array(z.object({ label: z.string().min(1).max(40), text: z.string().max(500) }))
    .max(MAX_TEST_OUTCOMES)
    .default([]),
});
export type TestLine = z.infer<typeof TestLine>;

// A move of a shared pool (a party, gm or campaign resource): an award when positive, a spend when negative.
export const PoolLine = z.object({
  ...line,
  pool: z.string().min(1).max(64),
  amount: z
    .int()
    .min(-1000)
    .max(1000)
    .refine((n) => n !== 0, "An amount is never 0"),
  text: z.string().max(500).default(""),
});
export type PoolLine = z.infer<typeof PoolLine>;

export const ExitLine = z.object({ ...line, label: z.string().trim().min(1).max(80), sceneId: id });
export type ExitLine = z.infer<typeof ExitLine>;

export const RevealLine = z.object({ ...line, entryId: id });
export type RevealLine = z.infer<typeof RevealLine>;

// The five kinds, in the order the screens show them. A kind this schema does not know is refused, never dropped.
export const PREP_KINDS = ["roster", "tests", "pools", "exits", "reveals"] as const;
export type PrepKind = (typeof PREP_KINDS)[number];

const lines = <T extends z.ZodType>(schema: T) => z.array(schema).max(MAX_PREP_LINES).default([]);

export const ScenePrep = z
  .strictObject({
    roster: lines(RosterLine),
    tests: lines(TestLine),
    pools: lines(PoolLine),
    exits: lines(ExitLine),
    reveals: lines(RevealLine),
  })
  .refine((p) => {
    const ids = PREP_KINDS.flatMap((k) => p[k].map((l) => l.id));
    return new Set(ids).size === ids.length;
  }, "Two lines share an id")
  .refine(
    (p) => new TextEncoder().encode(JSON.stringify(p)).length <= MAX_PREP_BYTES,
    "The scene's prepared lines are over 32 KB",
  );
export type ScenePrep = z.infer<typeof ScenePrep>;
export type PrepLine = ScenePrep[PrepKind][number];
