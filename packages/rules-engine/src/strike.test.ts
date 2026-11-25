import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import type { ExprRecord } from "./expr/expr.ast.ts";
import { SAMPLE_DUEL } from "./fixtures/sample-duel.ts";
import { SAMPLE_HARM } from "./fixtures/sample-harm.ts";
import type { RulesetInput } from "./manifest.ts";
import { isRefusal } from "./primitives/primitive.ts";
import { planStrike, type StrikePlan } from "./strike.ts";

const compiled = (input: RulesetInput) => {
  const r = compileRuleset(input);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.compiled.ruleset;
};
const HARM = compiled(SAMPLE_HARM);
const DUEL = compiled(SAMPLE_DUEL);

const hero = (over: { grit?: number; wounds?: number } = {}): ExprRecord => {
  const grit = over.grit ?? 4;
  return {
    grit,
    derived: { might: grit, guard: Math.floor(grit / 2) + 1, toughness: grit + 1, strainCap: grit, limit: grit + 3 },
    res: { wounds: over.wounds ?? 0, strain: 0, resolve: 2 },
    party: { characters: 2 },
  };
};
const brute: ExprRecord = {
  hide: 5,
  derived: { might: 5, guard: 2, toughness: 5, strainCap: 0, limit: 5 },
  res: { wounds: 0, strain: 0 },
  party: { characters: 2 },
};
const swarm = (members: number): ExprRecord => ({
  size: 6,
  derived: { might: 1, guard: 1, toughness: 1, strainCap: 2, limit: 1 },
  res: { wounds: 0, strain: 0, members },
  party: { characters: 2 },
});
const maul = { damage: 4, edge: 1, pierce: 0, close: true };
const sling = { damage: 3, edge: 0, pierce: -1, close: false };

const blow = (over: Partial<Parameters<typeof planStrike>[0]> = {}) =>
  planStrike({
    ruleset: HARM,
    strikeId: "blow",
    attacker: { entity: "hero", scope: hero() },
    target: { entity: "brute", scope: brute },
    means: maul,
    inputs: {},
    total: null,
    ...over,
  });
const plan = (r: ReturnType<typeof planStrike>): StrikePlan => {
  assert.ok(!isRefusal(r), JSON.stringify(r));
  return r;
};

test("the pool and the number to beat come with their lines, the base first", () => {
  const p = plan(blow({ attacker: { entity: "hero", scope: hero({ wounds: 1 }) }, inputs: { aim: true } }));
  assert.deepEqual(p.pool, {
    total: 5,
    lines: [
      { source: "Might", amount: 4, cite: "Sample p.15" },
      { source: "Aim", amount: 1, cite: "Sample p.15" },
    ],
  });
  assert.deepEqual(p.beat, {
    total: 3,
    lines: [
      { source: "Guard", amount: 2, cite: "Sample p.15" },
      { source: "Hurt", amount: 1, cite: "Sample p.15" },
    ],
  });
  assert.deepEqual(p.soak?.total, 5);
  assert.equal(p.outcome, null);
  assert.equal(p.harm, null);
});

test("a far shot adds only for an arm that is not close, and a swarm attacking adds half its members", () => {
  const far = plan(blow({ means: sling, inputs: { far: 2 } }));
  assert.equal(far.beat.total, 4);
  assert.deepEqual(far.soak?.lines.at(-1), { source: "Pierce", amount: -1, cite: "Sample p.16" });
  assert.equal(plan(blow({ inputs: { far: 2 } })).beat.total, 2);
  const mob = plan(blow({ attacker: { entity: "swarm", scope: swarm(5) }, target: { entity: "hero", scope: hero() } }));
  assert.deepEqual(mob.pool.lines.at(-1), { source: "Swarm", amount: 3, cite: "Sample p.16" });
});

test("a further number comes with its lines, and a text value reaches the notes (sample-harm 0.1.5)", () => {
  const close = plan(blow({ means: { ...maul, traits: "Brutal" } }));
  assert.deepEqual(close.shows, [
    {
      id: "damage",
      total: 9,
      lines: [
        { source: "Damage", amount: 4, cite: "Sample p.16" },
        { source: "Edge dice", amount: 1, cite: "Sample p.16" },
        { source: "Might", amount: 4, cite: "Sample p.16" },
      ],
    },
  ]);
  assert.ok(close.notes.some((n) => n.text.startsWith("A brutal arm")));
  const far = plan(blow({ means: { ...sling, traits: "Far, Light" } }));
  assert.deepEqual(far.shows[0], {
    id: "damage",
    total: 3,
    lines: [{ source: "Damage", amount: 3, cite: "Sample p.16" }],
  });
  assert.ok(!far.notes.some((n) => n.text.startsWith("A brutal arm")));
  assert.deepEqual(plan(blow({ means: { damage: 2 } })).shows[0]?.total, 2); // no traits: "", no edge, not close
});

test("a total over the soak is that many wounds, equal is one strain, less is nothing", () => {
  const on = (total: number, target = { entity: "hero", scope: hero() }) => plan(blow({ target, total }));
  assert.deepEqual(on(8).harm, { wounds: 3, shock: 0 });
  assert.equal(on(8).outcome?.id, "wounded");
  assert.deepEqual(on(5).harm, { wounds: 0, shock: 1 });
  assert.equal(on(4).outcome, null);
  assert.equal(on(4).harm, null);
  // A brute takes no strain: the line holds, and it applies nothing.
  const tie = on(5, { entity: "brute", scope: brute });
  assert.equal(tie.outcome?.id, "strained");
  assert.equal(tie.harm, null);
  assert.deepEqual(
    tie.notes.map((n) => n.text),
    ["A six on the edge die: read the Telling Blow table", "A brute shrugs off strain"],
  );
});

test("a swarm loses one member to a total over its soak, whatever the total", () => {
  const p = plan(blow({ target: { entity: "swarm", scope: swarm(6) }, total: 9 }));
  assert.equal(p.outcome?.id, "thinned");
  assert.deepEqual(p.harm, { wounds: 1, shock: 0 });
  assert.equal(plan(blow({ target: { entity: "swarm", scope: swarm(6) }, total: 1 })).outcome, null);
});

test("a duel's lunge is one roll against the parry, a hit doing the blade's flat cut and no soak", () => {
  const duelist = (skill: number, parry: number): ExprRecord => ({
    skill,
    parry,
    blades: [],
    derived: { limit: 5 },
    res: { cuts: 0 },
    party: { characters: 2 },
  });
  const lunge = (total: number) =>
    plan(
      planStrike({
        ruleset: DUEL,
        strikeId: "lunge",
        attacker: { entity: "duelist", scope: duelist(3, 10) },
        target: { entity: "duelist", scope: duelist(2, 14) },
        means: { cut: 3 },
        inputs: {},
        total,
      }),
    );
  assert.equal(lunge(14).soak, null);
  assert.deepEqual(lunge(14).harm, { wounds: 3, shock: 0 });
  assert.equal(lunge(13).outcome?.id, "miss");
  assert.equal(lunge(13).harm, null);
  assert.equal(lunge(14).pool.total, 3);
});

test("refusals: an unknown strike, a type it is not for, a missing means, a bad input or total", () => {
  const code = (r: ReturnType<typeof planStrike>) => (isRefusal(r) ? r.code : "ok");
  assert.equal(code(blow({ strikeId: "nope" })), "noSuchStrike");
  assert.equal(code(blow({ target: { entity: "arm", scope: {} } })), "strikeNotFor");
  assert.equal(code(blow({ means: null })), "noMeans");
  assert.equal(code(blow({ inputs: { far: 4 } })), "badInput");
  assert.equal(code(blow({ inputs: { aim: 1 } })), "badInput");
  assert.equal(code(blow({ inputs: { nope: 1 } })), "badInput");
  assert.equal(code(blow({ total: 1.5 })), "badInput");
  assert.equal(code(blow({ total: 1001 })), "badInput");
  const { derived: _derived, ...bare } = brute;
  assert.equal(code(blow({ target: { entity: "brute", scope: bare } })), "wrongState");
});

test("a strike's declaration is refused at its path", () => {
  const bad = structuredClone(SAMPLE_HARM) as RulesetInput & { strikes: NonNullable<RulesetInput["strikes"]> };
  const s = bad.strikes[0]!;
  s.inputs = [...(s.inputs ?? []), { id: "total", label: "T", type: "bool", min: 1 }];
  s.means = [
    { from: "ledger", lines: "weapons" },
    { from: "list", field: "grit", entry: "nope" },
  ];
  s.outcomes = [...s.outcomes, { id: "x", label: "X", when: "ctx.nope", shock: "1" }];
  s.then = { table: "blow", inputs: { press: "nope", nope: "aim" } };
  s.targets = ["arm"];
  bad.strikes = [s, { ...s, id: "blow", cite: undefined }];
  const r = compileRuleset(bad);
  assert.ok(!r.ok);
  const paths = r.problems.map((p) => `${p.path}: ${p.message}`);
  for (const want of [
    'strikes[1].id: duplicate id "blow"',
    "strikes[0].means[0]: the ruleset has no build",
    'strikes[0].means[1].field: "grit" is not a list field of an attacker',
    'strikes[0].means[1].entry: unknown entity "nope"',
    'strikes[0].inputs[2].id: "total" is reserved',
    "strikes[0].inputs[2]: a switch has no bounds",
    'strikes[0].targets[0]: "arm" is not an actor entity',
    'strikes[0].then.inputs.nope: "nope" is not an input of the table',
    'strikes[0].then.inputs.press: "nope" is not an input of the strike',
    "strikes[1].cite: a rule entry needs a cite",
  ])
    assert.ok(paths.includes(want), `${want}\nin\n${paths.join("\n")}`);
});

test("a strike's means may be a held item of a kind an attacker holds (house decision #95)", () => {
  const kind = { id: "arms", label: "Arms", entry: "arm", entities: ["hero"], card: "weapons", cite: "Sample p.17" };
  const withItems = (means: NonNullable<RulesetInput["strikes"]>[number]["means"], entities?: string[]) => {
    const r = structuredClone(SAMPLE_HARM) as RulesetInput & { strikes: NonNullable<RulesetInput["strikes"]> };
    r.items = { kinds: [kind as never] };
    r.strikes[0] = { ...r.strikes[0]!, means, ...(entities ? { entities } : {}) };
    return compileRuleset(r);
  };
  assert.ok(withItems([{ from: "items", kind: "arms" }]).ok);
  const problems = (r: ReturnType<typeof compileRuleset>) =>
    r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
  assert.deepEqual(problems(withItems([{ from: "items", kind: "nope" }])), [
    'strikes[0].means[0].kind: unknown item kind "nope"',
  ]);
  assert.ok(
    problems(withItems([{ from: "items", kind: "arms" }], ["brute"])).includes(
      'strikes[0].means[0].kind: no attacker holds "arms"',
    ),
  );
});

test("a further number's id is its own, at most six, and a text value is never a number", () => {
  const bad = structuredClone(SAMPLE_HARM) as RulesetInput & { strikes: NonNullable<RulesetInput["strikes"]> };
  const s = bad.strikes[0]!;
  const show = s.shows![0]!;
  const paths = () => {
    const r = compileRuleset(bad);
    return r.ok ? [] : r.problems.map((p) => p.path);
  };
  s.shows = [show, { ...show, label: "Again" }];
  assert.ok(paths().includes("strikes[0].shows[1].id"));
  s.shows = Array.from({ length: 7 }, (_, i) => ({ ...show, id: `n${i}` }));
  assert.ok(paths().includes("strikes[0].shows"));
  s.shows = [show];
  s.pool = { ...s.pool, adds: [{ label: "Traits", by: "ctx.means.traits" }] };
  assert.ok(paths().includes("strikes[0].pool.adds[0].by"));
});

test("a strike's expressions are checked over every attacker and target", () => {
  const bad = structuredClone(SAMPLE_HARM) as RulesetInput & { strikes: NonNullable<RulesetInput["strikes"]> };
  bad.strikes[0]!.pool.expr = "grit"; // only a hero has grit
  bad.strikes[0]!.outcomes[0]!.when = 'ctx.outcome == "x"'; // only a note reads the outcome
  const r = compileRuleset(bad);
  assert.ok(!r.ok);
  const paths = r.problems.map((p) => p.path);
  assert.ok(paths.includes("strikes[0].pool.expr"));
  assert.ok(paths.includes("strikes[0].outcomes[0].when"));
});

test("a choice reads as the option picked, the first when none is, and nothing else (house decision #112)", () => {
  const sweep = (inputs: Record<string, unknown>) =>
    planStrike({
      ruleset: HARM,
      strikeId: "sweep",
      attacker: { entity: "hero", scope: hero() },
      target: { entity: "swarm", scope: swarm(6) },
      means: null,
      inputs,
      total: 9,
    });
  const light = plan(sweep({}));
  assert.equal(light.pool.total, 4);
  assert.deepEqual(light.harm, { wounds: 1, shock: 0 });
  const allIn = plan(sweep({ force: 2 }));
  assert.equal(allIn.pool.total, 6);
  assert.deepEqual(allIn.shows, [
    { id: "strain", total: 2, lines: [{ source: "Strain to pay", amount: 2, cite: "Sample p.18" }] },
  ]);
  assert.deepEqual(allIn.harm, { wounds: 3, shock: 0 });
  for (const force of [3, 1.5, true, "1"]) {
    const r = sweep({ force });
    assert.ok(isRefusal(r) && r.code === "badInput", `force ${String(force)}`);
  }
});

test("a choice has options and no bounds, only a choice has options, and its values differ (house decision #112)", () => {
  const bad = structuredClone(SAMPLE_HARM) as RulesetInput & { strikes: NonNullable<RulesetInput["strikes"]> };
  const s = bad.strikes[1]!;
  const options = [
    { label: "A", value: 1 },
    { label: "B", value: 1 },
  ];
  s.inputs = [
    { id: "a", label: "A", type: "choice", min: 0 },
    { id: "b", label: "B", type: "int", options },
    { id: "c", label: "C", type: "choice", options },
  ];
  const r = compileRuleset(bad);
  assert.ok(!r.ok);
  const paths = r.problems.map((p) => `${p.path}: ${p.message}`);
  for (const want of [
    "strikes[1].inputs[0]: a choice has no bounds",
    "strikes[1].inputs[0]: a choice needs options",
    "strikes[1].inputs[1].options: only a choice has options",
    "strikes[1].inputs[2].options[1].value: duplicate value 1",
  ])
    assert.ok(paths.includes(want), `${want}\nin\n${paths.join("\n")}`);
  const sweep = SAMPLE_HARM.strikes![1]!;
  assert.ok(!compileRuleset({ ...SAMPLE_HARM, strikes: [{ ...sweep, byOwner: false as never }] }).ok);
  assert.ok(!compileRuleset({ ...SAMPLE_HARM, strikes: [{ ...sweep, limit: { per: "turn" as never, max: 1 } }] }).ok);
});
