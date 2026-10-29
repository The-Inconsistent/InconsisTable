import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import { SAMPLE_HARVEST } from "./fixtures/sample-harvest.ts";
import { validateRuleset, type RulesetInput } from "./manifest.ts";
import { endMet, rankResults, scoreRows } from "./scoring.ts";

const withScoring = (scoring: unknown, sources?: unknown): RulesetInput =>
  ({ ...SAMPLE_HARVEST, ...(sources ? { sources } : {}), scoring }) as RulesetInput;
const problems = (input: RulesetInput) => {
  const r = validateRuleset(input);
  return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
};
// A licensed (not homebrew) copy of the fixture: cites are then required.
const LICENSED = [{ id: "sample", title: "Sample", license: "private", pageOffset: 0 }];

const row = (actorId: string, score: number, ...tiebreaks: number[]) => ({ actorId, score, tiebreaks });
const high = { mode: "compete", order: "high", tiebreaks: [{ order: "high" }], endWhen: [] } as const;

test("rank: high order, a tiebreak decides, still tied share the place and the next is skipped", () => {
  const r = rankResults({
    scoring: high as never,
    rows: [row("a", 5, 1), row("b", 9, 0), row("c", 5, 3), row("d", 5, 1)],
  });
  assert.deepEqual(
    r.map((x) => [x.actorId, x.place]),
    [
      ["b", 1],
      ["c", 2],
      ["a", 3],
      ["d", 3],
    ],
  );
  assert.ok(r.every((x) => x.outcome === null));
});

test("rank: low order, and a tiebreak with its own order", () => {
  const r = rankResults({
    scoring: { ...high, order: "low", tiebreaks: [{ order: "low" }] } as never,
    rows: [row("a", 5, 7), row("b", 2, 0), row("c", 5, 2)],
  });
  assert.deepEqual(
    r.map((x) => [x.actorId, x.place]),
    [
      ["b", 1],
      ["c", 2],
      ["a", 3],
    ],
  );
});

test("rank: 1, 1, 3", () => {
  const r = rankResults({
    scoring: { ...high, tiebreaks: [] } as never,
    rows: [row("a", 4), row("b", 4), row("c", 1)],
  });
  assert.deepEqual(
    r.map((x) => x.place),
    [1, 1, 3],
  );
});

const coop = {
  mode: "coop",
  order: "high",
  tiebreaks: [],
  endWhen: [{ outcome: "lose" }, { outcome: "win" }],
} as never;

test("coop: the first met trigger gives the outcome, nobody is placed", () => {
  const rows = [row("a", 1), row("b", 2)];
  const won = rankResults({ scoring: coop, rows, met: [1] });
  assert.deepEqual(
    won.map((x) => [x.place, x.outcome]),
    [
      [null, "win"],
      [null, "win"],
    ],
  );
  assert.equal(rankResults({ scoring: coop, rows, met: [1, 0] })[0]?.outcome, "lose");
});

test("coop: ended with no trigger met is a loss", () => {
  assert.equal(rankResults({ scoring: coop, rows: [row("a", 1)] })[0]?.outcome, "lose");
});

test("endMet: round > 4, and res.vp >= 10 true for one player only", () => {
  const input = withScoring({
    ...SAMPLE_HARVEST.scoring,
    endWhen: [
      { when: "round > 4", cite: "Sample p.8" },
      { when: "res.vp >= 10", cite: "Sample p.8" },
    ],
  });
  const c = compileRuleset(input);
  assert.ok(c.ok);
  const ruleset = c.compiled;
  const actors = {
    a: { scope: { res: { vp: 10, coin: 0 } } },
    b: { scope: { res: { vp: 2, coin: 0 } } },
    gone: { scope: null },
  };
  assert.deepEqual(endMet({ ruleset, actors, order: ["a", "b", "gone"], round: 4 }), [1]);
  assert.deepEqual(endMet({ ruleset, actors, order: ["b", "gone"], round: 5 }), [0]);
  assert.deepEqual(endMet({ ruleset, actors, order: ["a", "b"], round: 5 }), [0, 1]);
  const scored = scoreRows({ ruleset, actors, order: ["a", "b", "gone"] });
  assert.deepEqual(
    scored.map((r) => [r.actorId, r.score, r.tiebreaks]),
    [
      ["a", 10, [0]],
      ["b", 2, [0]],
      ["gone", 0, [0]],
    ],
  );
});

test("manifest: the fixture compiles; a bad expression names its path", () => {
  assert.ok(compileRuleset(SAMPLE_HARVEST).ok);
  const bad = compileRuleset(withScoring({ ...SAMPLE_HARVEST.scoring, score: "res.nope" }));
  assert.ok(!bad.ok && bad.problems.some((p) => p.path === "scoring.score"));
  const noRound = compileRuleset(withScoring({ ...SAMPLE_HARVEST.scoring, score: "round" }));
  assert.ok(!noRound.ok, "round is for endWhen only");
});

test("manifest: outcome is refused in compete, a coop game needs outcomes and a win", () => {
  const trigger = { when: "round > 4", cite: "Sample p.8" };
  const base = { score: "res.vp", cite: "Sample p.8" };
  assert.ok(
    problems(withScoring({ ...base, endWhen: [{ ...trigger, outcome: "win" }] })).some((p) =>
      p.includes("only a cooperative game has an outcome"),
    ),
  );
  assert.ok(
    problems(withScoring({ ...base, mode: "coop", endWhen: [trigger] })).some((p) => p.includes("names its outcome")),
  );
  assert.ok(
    problems(withScoring({ ...base, mode: "coop", endWhen: [{ ...trigger, outcome: "lose" }] })).some((p) =>
      p.includes("needs a trigger that wins"),
    ),
  );
  assert.deepEqual(problems(withScoring({ ...base, mode: "coop", endWhen: [{ ...trigger, outcome: "win" }] })), []);
});

test("manifest: cites are required outside homebrew", () => {
  const trigger = { when: "round > 4" };
  const p = problems(withScoring({ score: "res.vp", endWhen: [trigger] }, LICENSED));
  assert.ok(p.some((x) => x.startsWith("scoring.cite")));
  assert.ok(p.some((x) => x.startsWith("scoring.endWhen[0].cite")));
  assert.deepEqual(problems(withScoring({ score: "res.vp", endWhen: [trigger] })), []);
});
