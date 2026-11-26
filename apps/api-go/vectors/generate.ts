// Writes what the TypeScript engine answers, for the Go engine's tests to match (docs/adr/0008-go-api.md).
// The output is generated on every run and never committed, so Go always faces the TypeScript of this commit. Only the
// inputs written here are compared: a new dice suffix or primitive needs vectors added here too.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { FIXTURE_RULESET } from "../../smoke/test/fixture.ts";
import { compileRuleset, type CompiledRuleset } from "../../../packages/rules-engine/src/compile.ts";
import {
  applyBaseEffects,
  campaignValues,
  actorScope,
  deriveValues,
  healthStatesOf,
  instantDeathAt,
  resetValues,
  startValue,
  resourceBounds,
} from "../../../packages/rules-engine/src/derived.ts";
import type { ExprScope, ExprType } from "../../../packages/rules-engine/src/expr/expr.ast.ts";
import { typeName } from "../../../packages/rules-engine/src/expr/expr.check.ts";
import { compileExpr, type CompiledExpr } from "../../../packages/rules-engine/src/expr/expr.ts";
import { SAMPLE_D20 } from "../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_DUEL } from "../../../packages/rules-engine/src/fixtures/sample-duel.ts";
import {
  SAMPLE_HARM,
  SAMPLE_HARM_BEFORE_OWNER,
  SAMPLE_HARM_GROWTHS,
} from "../../../packages/rules-engine/src/fixtures/sample-harm.ts";
import { SAMPLE_HARVEST } from "../../../packages/rules-engine/src/fixtures/sample-harvest.ts";
import { SAMPLE_POOL } from "../../../packages/rules-engine/src/fixtures/sample-pool.ts";
import { SAMPLE_SCOPED } from "../../../packages/rules-engine/src/fixtures/sample-scoped.ts";
import { SAMPLE_SKIRMISH } from "../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import { SAMPLE_TIERED } from "../../../packages/rules-engine/src/fixtures/sample-tiered.ts";
import { SAMPLE_NO_ORDER } from "../../../packages/rules-engine/src/fixtures/sample-no-order.ts";
import { FREEFORM } from "../../web/lib/freeform/freeform.ts";
import type { CampaignField, CodexField, FieldDef, Ruleset } from "../../../packages/rules-engine/src/manifest.ts";
import { runCreation, type EntryLookup } from "../../../packages/rules-engine/src/creation.ts";
import { checkCampaignValue, checkFieldValue, fitRows } from "../../../packages/rules-engine/src/field-value.ts";
import { MAX_ENTRY_RECORD_BYTES, validatePack, type PackEntry } from "../../../packages/rules-engine/src/pack.ts";
import { SAMPLE_LEDGER_PACK } from "../../../packages/rules-engine/src/fixtures/sample-ledger-pack.ts";
import { SAMPLE_LEDGER_RULESET } from "../../../packages/rules-engine/src/fixtures/sample-ledger-ruleset.ts";
import {
  endMet,
  rankResults,
  scoreRows,
  type ScoreRow,
  type ScoredActor,
} from "../../../packages/rules-engine/src/scoring.ts";
import { remindersOf, type ReminderActor } from "../../../packages/rules-engine/src/reminders.ts";
import { planLookup } from "../../../packages/rules-engine/src/lookups.ts";
import { checkRun, type GeneratorRun } from "../../../packages/rules-engine/src/generators.ts";
import { armedTicks } from "../../../packages/rules-engine/src/primitives/conditions-expire.ts";
import { toViewerView, type ActorView } from "../../../packages/rules-engine/src/view.ts";
import { parseDice, rollDice, seededRng } from "../../../packages/rules-engine/src/dice/dice.ts";
import type { FieldValue } from "../../../packages/rules-engine/src/derived.ts";
import {
  AdvantageMode,
  CodexEntryKind,
  ConditionDuration,
  DeathSaveResult,
  ResetEvent,
  ViewerRole,
} from "../../../packages/rules-engine/src/enums.ts";
import { CodexKind } from "../../../packages/core-schema/src/state.ts";
import { FnName } from "../../../packages/rules-engine/src/expr/expr.ast.ts";
import { evaluate } from "../../../packages/rules-engine/src/expr/expr.eval.ts";
import { parseExpr } from "../../../packages/rules-engine/src/expr/expr.parser.ts";
import { SAMPLE_PACK, SAMPLE_PACK_EFFECTS } from "../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { keptValue, plainDice } from "../../../packages/rules-engine/src/manifest.ts";
import { canonicalJson, contentHash, diffHashes, sha256Hex } from "../../../packages/rules-engine/src/pack-hash.ts";
import type {
  ActorState,
  ConditionState,
  Delta,
  RuleState,
  ResourceState,
  TargetPattern,
  TurnState,
} from "../../../packages/rules-engine/src/primitives/primitive.ts";
import { charge, checkDeltas } from "../../../packages/rules-engine/src/primitives/primitive.ts";
import { opInputKeys, PRIMITIVES, runOp } from "../../../packages/rules-engine/src/primitives/registry.ts";
import { planSpend } from "../../../packages/rules-engine/src/spend.ts";
import { planStrike } from "../../../packages/rules-engine/src/strike.ts";
import { planAcquire, withFittedCard, type AcquireItem } from "../../../packages/rules-engine/src/acquire.ts";
import { budgetOf, planSpawn, type SpawnRoom } from "../../../packages/rules-engine/src/spawn.ts";
import { SAMPLE_SKIRMISH_PACK } from "../../../packages/rules-engine/src/fixtures/sample-skirmish-pack.ts";
import { firstOf, nextFirst, sequence } from "../../../packages/rules-engine/src/primitives/initiative-seated.ts";
import { poolSize } from "../../../packages/rules-engine/src/primitives/dice-pool-successes.ts";
import { LAYOUT_TARGETS, WIDGETS } from "../../../packages/rules-engine/src/widgets.ts";
import { moduleVectors } from "./module.ts";
import { worldVectors } from "./world.ts";

const OUT = join(import.meta.dirname, "../internal/engine/testdata/vectors.json");

const SCOPE = {
  attr: { str: 15, dex: 8, con: 12 },
  skill: { attr: "str", rank: 2 },
  res: { hp: 7, gone: null },
  tags: ["brave", "loud"],
  rolls: [3, 9, 4],
  mixed: [1, "a", true],
  empty: [],
  name: "Ash",
  ready: true,
  off: false,
  zero: 0,
  big: 9007199254740991,
  frac: 1.5,
  nested: { a: { b: [1, 2, { c: 3 }] } },
  form: { f1: 11, f2: 22, f10: 100, f01x: 5 },
  forms: { a1: "one", a2: null, a3: "three" },
};

let seed = 20261107;
const rnd = (n: number) => (((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32) * n) | 0;
const pick = <T>(items: readonly T[]): T => items[rnd(items.length)] as T;

const LEAVES = [
  "0",
  "1",
  "2",
  "3",
  "7",
  "10",
  "-1",
  "94906267",
  "3037000500",
  "9007199254740991",
  "9007199254740992",
  "true",
  "false",
  '"str"',
  '"a"',
  '""',
  "attr",
  "attr.str",
  "attr.dex",
  "attr.nope",
  "skill.attr",
  "skill.rank",
  "res.hp",
  "res.gone",
  "res.nope",
  "tags",
  "rolls",
  "mixed",
  "empty",
  "name",
  "ready",
  "off",
  "zero",
  "big",
  "frac",
  "nested",
  "nested.a.b",
  "nested.a.b[2].c",
  "missing",
  "constructor",
  "toString",
  "__proto__",
  "attr.constructor",
  "rolls[0]",
  "rolls[2]",
  "rolls[3]",
  "rolls[-1]",
  "rolls[frac]",
  'attr["str"]',
  'attr["nope"]',
  'rolls["length"]',
  "tags[0]",
  "attr[0]",
];
const FNS = FnName.options;
const BIN = ["+", "-", "*", "/", "%", "<", "<=", ">", ">=", "==", "!=", "&&", "||"];
const ARITH = ["+", "-", "*", "/", "%"];
const NUMERIC = ["attr.str", "attr.dex", "res.hp", "zero", "rolls[1]", "7", "-3", "2", "big", "frac"];
const JUNK = [
  ...["(", ")", "[", "]", ".", ",", "?", ":", '"', "\\", "1.5", "1a", "_x", "é", "😀"],
  ...[" ", " ", "﻿", "#", "=", "&", "|", "nope(", "min(", "  ", "\t", "\n"],
];

function genExpr(depth: number): string {
  if (depth <= 0 || rnd(4) === 0) return pick(LEAVES);
  switch (rnd(6)) {
    case 0:
    case 1:
      return `${genExpr(depth - 1)} ${pick(BIN)} ${genExpr(depth - 1)}`;
    case 2:
      return `(${genExpr(depth - 1)})`;
    case 3:
      return `${pick(["-", "!"])}${genExpr(depth - 1)}`;
    case 4:
      return `${genExpr(depth - 1)} ? ${genExpr(depth - 1)} : ${genExpr(depth - 1)}`;
    default:
      return `${pick(FNS)}(${Array.from({ length: rnd(4) }, () => genExpr(depth - 1)).join(", ")})`;
  }
}

function genNumeric(): string {
  let e = pick(NUMERIC);
  for (let i = rnd(3) + 1; i > 0; i--) {
    e =
      rnd(5) === 0
        ? `${pick(["min", "max", "floor", "ceil"])}(${e}, ${pick(NUMERIC)})`
        : `${e} ${pick(ARITH)} ${pick(NUMERIC)}`;
  }
  return e;
}

function mutateSource(s: string): string {
  const i = rnd(s.length + 1);
  return rnd(2) === 0 ? s.slice(0, i) + pick(JUNK) + s.slice(i) : s.slice(0, i) + s.slice(i + 1 + rnd(3));
}

// prettier-ignore
const FIXED_EXPR = [
  "", " ", "1 + 2 * 3", "(1 + 2) * 3", "10 - 4 - 3", "-2 * 3", "2 * -attr.dex", "7 / 2", "-7 / 2", "7 / -2", "-7 % 3", "7 % -3",
  "1/0", "1%0", "attr == attr", "tags == tags", "tags == rolls", "nested.a == nested.a", "nested.a.b == nested.a.b",
  'name == "Ash"', '1 == "1"', "true == 1", "0 == -0", "-zero == zero", "big + 1", "big * big", "-big - 2",
  "3037000500*3037000500", "9007199254740990 % 9007199254740991", "9007199254740990 / 9007199254740991", "-9007199254740990 % 9007199254740991",
  "-9007199254740990 / 9007199254740991", "9007199254740991 / -2", "-9007199254740991 % 2", "ceil(9007199254740990, 9007199254740991)", "-4 % 2", "0 / -3", "94906267*94906267", "94906265*94906265", "floor(7,2)", "ceil(7,2)", "ceil(-7,2)", "floor()", "ceil()",
  "floor(1,0)", "floor(1,2,3)", "floor(1,2,nope)", "mod(15)", "mod(8)", "mod()", "abs(-5)", "abs()", "clamp(5,1,3)", "clamp(5,3,1)",
  "clamp()", "min()", "max()", "min(rolls)", "max(rolls)", "min(empty)", "min(7)", "min(1,2)", "min(tags)", "sum(rolls)", "sum(tags)",
  "sum()", "sum(empty)", "count(tags)", "count(name)", "count()", "has(attr.str)", "has(attr.nope)", "has(res.gone)", "has(missing)",
  "has()", "has(1)", "has(missing.a.b)", "has(rolls[99])", "has(rolls[1/0])", "ready ? 1 : 2", "ready ? 1 : off ? 2 : 3",
  'contains(tags, "loud")', 'contains(tags, "Loud")', "contains(tags, name)", "contains(rolls, 9)", "contains(rolls, 5)", "contains(empty, 1)",
  'contains(name, "A")', "contains(tags)", 'contains(missing, "a")', "contains(tags, 1/0)", 'contains(tags, "loud") && !contains(tags, "shy")',
  "overlap(tags, tags)", "overlap(tags, empty)", "overlap(empty, tags)", "overlap(rolls, rolls)", "overlap(tags)", "overlap(name, tags)", "overlap(tags, name)",
  "off ? 1 : off ? 2 : 3", "zero ? 1 : 2", "true || nope", "false && nope", "false || nope", "1 && true", "frac + 1", "frac",
  "frac == frac", "nope(1)", "toString(1)", "min", "attr.", "attr.1", '"a\\b"', '"unterminated', "1.5", "1a", "9007199254740992",
  "99999999999999999999999999999999999999999999", "é", "😀", "a😀", '"😀"', "😀 + 1", '"é" + 1', '1 + "😀" +', " 1", "﻿1",
  " 1", "1 + 1", "@", " @", "é@", "😀@",
  "(".repeat(600), "-".repeat(600) + "1", "!".repeat(600) + "true", "1" + "+1".repeat(499), "1" + "+1".repeat(250), "1" + "+1".repeat(249), "-1" + "+1".repeat(249),
  "at(form, 1)", "at(form, 2)", "at(form, 10)", "at(form, 3)", "at(form, 0)", "at(form, -1)", "at(form, zero + 1)", "at(form, frac)", "at(form, name)",
  "at(form)", "at()", "at(form, 1, 2)", "at(1, 2)", "at(name, 1)", "at(forms, 1)", "at(forms, 2)", "at(forms, 3)", "at(nope, 1)", "at(nested.a, 1)", "at(attr, 1)",
  "at(form, 1) + at(form, 2)", "at(form, rolls[0])", "at(rolls, 0)", "at(form, 1 / 0)", "at(missing, 1)",
  "x".repeat(2000), "x".repeat(2001), "é".repeat(2001), "😀".repeat(1001), "min(" + "1,".repeat(499) + "1)",
];

const message = (err: unknown): string => {
  if (!(err instanceof Error) || err.name !== "ExprError") throw err;
  return err.message;
};

const exprSources = [...FIXED_EXPR];

function exprVectors() {
  const sources = exprSources;
  for (let i = 0; i < 6000; i++) sources.push(genExpr(1 + rnd(4)));
  for (let i = 0; i < 6000; i++) sources.push(genNumeric());
  for (let i = 0; i < 4000; i++) sources.push(mutateSource(genExpr(1 + rnd(3))));
  return sources.map((src) => {
    let ast;
    try {
      ast = parseExpr(src);
    } catch (err) {
      return { src, parseErr: message(err) };
    }
    try {
      return { src, ast, value: evaluate({ node: ast, scope: SCOPE }) };
    } catch (err) {
      return { src, ast, evalErr: message(err) };
    }
  });
}

// No lone surrogates here: Go's JSON decoder replaces them, so the api must refuse them at its boundary (ADR 0008).
// prettier-ignore
const CANONICAL: unknown[] = [
  null, true, false, 0, 1, -1, 1.5, -1.5, 0.1, 1e21, 1e-7, 1e-6, 123456789012345680000, 1.7976931348623157e308, 5e-324,
  9007199254740991, 2 ** 53, 1 / 3, 100, 1e20,
  "", "a", "é", "😀", '"', "\\", "/", "<>&", "\b\f\n\r\t", "\u0000\u0001\u001f", "\u007f", "  ", "﻿",
  [], {}, [1, [2, [3]]], [null], { a: null }, { b: 1, a: 2 },
  { é: 1, z: 2, "😀": 3, "￿": 4, "": 5, a: 6, "": 7 }, { "10": 1, "9": 2, a: 3 }, { '"': 1, "\n": 2 }, { z: { y: { x: [{ b: 1, a: 2 }] } } },
  { __proto__x: 1, constructor: 2, toString: 3 }, [{ "😀": 1, "￿": 2 }],
];

// prettier-ignore
const DICE = [
  "1d20", "2d6", "3d8", "1d6", "1d4", "d20", "D20", " 2d6 ", "2 d6", "2d 6", "2d6 + 3 - d4", "2d6+1", "1d20+1", "2d6kh1", "2d6kl1", "4d6kh3",
  "4d6 kh 3", "2d6kh3", "2d6kh0", "2d6kh", "2d6kh1kl1", "2d6!", "2d6!!", "1d1!", "dF!", "d66!", "4dF", "dF", "2d66", "d66", "d660", "d6", "1dF",
  "0d6", "101d6", "100d6", "d0", "d1", "d1000", "d1001", "2d6>=5", "2d6>=", "2d6>=5>=6", "dF>=1", "4d6kh3!>=5", "-1", "1", "foo", "", " ", "+", "2d6+",
  "2d6 2d6", "10001", "10000+d6", "10001+d6", "99999999999999999999999d6", "d99999999999999999999999", "9".repeat(400) + "d6", "1d6" + "+1".repeat(19),
  "1d6" + "+1".repeat(20), "é", "😀", "2d6é", "2d6😀", " 2d6 ", "﻿2d6", "2d6 +1", "d", "dd", "2d", "2dd6", "d6kh1", "2d6>=99999999999999999999",
];

function diceVectors() {
  return {
    parse: DICE.map((notation) => ({ notation, result: parseDice(notation) })),
    plain: DICE.map((notation) => ({ notation, shape: plainDice(notation) })),
    roll: [
      ...DICE.filter((notation) => parseDice(notation).ok).flatMap((notation) =>
        [1, 2, 3, 4294967295].map((seed) => ({ notation, seed })),
      ),
      // A d2 explodes every other roll, so this many seeds reach the depth cap.
      ...Array.from({ length: 5000 }, (_, seed) => ({ notation: "d2!", seed })),
    ].map(({ notation, seed: rngSeed }) => ({
      notation,
      seed: rngSeed,
      roll: rollDice({ notation, rng: seededRng(rngSeed) }),
    })),
  };
}

// prettier-ignore
const ROLLS = [
  { kind: "faces", faces: [1] }, { kind: "faces", faces: [20] }, { kind: "faces", faces: [10] }, { kind: "faces", faces: [21] }, { kind: "faces", faces: [0] },
  { kind: "faces", faces: [3, 4] }, { kind: "faces", faces: [6, 6] }, { kind: "faces", faces: [1, 20] }, { kind: "faces", faces: [1, 2, 3] },
  { kind: "total", total: 15 }, { kind: "total", total: 15, natural: 20 }, { kind: "total", total: 15, natural: 1 }, { kind: "total", total: 15, natural: 0 },
  { kind: "total", total: 15, natural: 21 }, { kind: "total", total: 12, natural: 12 }, { kind: "total", total: -3 },
];

const sideList = (n: number) =>
  ["red", "blue", "green", "gold"].slice(0, n).map((id) => ({ id, label: id.toUpperCase() }));

// Plain fixtures of our own writing: valid params, some leaving defaults out, so Go has to apply them too.
const OP_PARAMS: Record<string, unknown[]> = {
  "dice.sumVsTarget": [
    { kind: "sumVsTarget", target: "10", dice: "1d20" },
    { kind: "sumVsTarget", target: "10", dice: "1d20", ties: "beat", advantage: true, critOn: [1, 20] },
    { kind: "sumVsTarget", target: "10", dice: "2d6", ties: "meetOrBeat", critOn: [12] },
    { kind: "sumVsTarget", target: "10", dice: "2d6+1" },
    { kind: "sumVsTarget", target: "10", dice: "1dF", advantage: true },
    { kind: "sumVsTarget", target: "10", dice: "1d20", degrees: { step: 5, naturalShift: true } },
    { kind: "sumVsTarget", target: "10", dice: "1d20", ties: "beat", advantage: true, degrees: { step: 1 } },
    { kind: "sumVsTarget", target: "10", dice: "2d6", degrees: { step: 3, naturalShift: false } },
  ],
  "dice.poolSuccesses": [
    { kind: "poolSuccesses", target: "3", pool: "5", die: 6, bands: [{ id: "hit", from: 4, to: 6, worth: 1 }] },
    {
      kind: "poolSuccesses",
      target: "3",
      pool: "5",
      die: 6,
      ties: "beat",
      shift: "top",
      bands: [
        { id: "hit", from: 4, to: 5, worth: 1 },
        { id: "top", from: 6, to: 6, worth: 2 },
      ],
      special: { label: "Fate", count: 1, flags: { critical: { from: 6, to: 6 }, complication: { from: 1, to: 1 } } },
    },
    {
      kind: "poolSuccesses",
      target: "3",
      pool: "5",
      die: 8,
      shift: "hit",
      bands: [{ id: "hit", from: 5, to: 8, worth: 3 }],
      special: { label: "Fate", count: 2 },
    },
  ],
  "initiative.ranked": [
    { strategy: "ranked", score: "1" },
    { strategy: "ranked", score: "1", tiebreak: ["1", "2"], rerollEachRound: true },
  ],
  "initiative.seated": [
    { strategy: "seated", firstPlayer: "fixed" },
    { strategy: "seated", firstPlayer: "rotate" },
    { strategy: "seated", firstPlayer: "manual" },
  ],
  "health.tracks": [
    {},
    { tracks: [{ resource: "hp" }] },
    { tracks: [{ resource: "hp", temp: "tempHp" }], stateField: "life", successField: "up", failureField: "down" },
    {
      tracks: [
        { resource: "mana" },
        {
          resource: "hp",
          temp: "tempHp",
          deathSaves: {
            successes: 3,
            failures: 3,
            criticalFailureCounts: 2,
            criticalSuccessHeals: 1,
            failuresOnDamage: 1,
            failuresOnCriticalDamage: 2,
          },
        },
      ],
    },
    { tracks: [{ resource: "hp", deathSaves: { successes: 1, failures: 2 } }] },
  ],
  "resource.capped": [{}],
  "conditions.expire": [{}],
  rest: [{}],
  "initiative.sides": [
    { strategy: "sides", sides: sideList(2) },
    {
      strategy: "sides",
      sides: sideList(2),
      firstSide: "rotate",
      roundEnd: "manual",
      setup: {},
      outOfTurn: { cost: { red: { pool: "gold", amount: 1 }, blue: { pool: "tin", amount: 2 } } },
      hold: {},
      barred: { throughRound: 2, liftCost: { red: { pool: "gold", amount: 1 }, blue: { pool: "tin", amount: 2 } } },
    },
    {
      strategy: "sides",
      sides: sideList(3),
      outOfTurn: { cost: { green: { pool: "gold", amount: 3 }, red: { pool: "ghost", amount: 1 } } },
      barred: { throughRound: 3, liftCost: { blue: { pool: "tin", amount: 1 } } },
    },
    {
      strategy: "sides",
      sides: [...sideList(3), { id: "gold", label: "Gold" }],
      firstSide: "rotate",
      setup: {},
      hold: {},
      barred: {},
    },
  ],
};

const ACTOR_IDS = ["a1", "a2", "b", "é"];
const RESOURCES = ["hp", "tempHp", "mana"];

const maybe = <T>(value: T, odds = 2): T | undefined => (rnd(odds) === 0 ? value : undefined);

function genResource(): ResourceState {
  const reset = Object.fromEntries(ResetEvent.options.flatMap((e) => (rnd(3) === 0 ? [[e, rnd(25) - 2]] : [])));
  return {
    value: rnd(36) - 6,
    min: pick([0, 0, -5, 5]),
    max: pick([null, 10, 20, 1]),
    ...(rnd(2) === 0 ? { reset } : {}),
    ...(rnd(3) === 0 ? { instantDeathAt: pick([null, 0, 3, 10]) } : {}),
  };
}

function genActor(id: string): ActorState {
  const status = pick<FieldValue>(["ok", "dying", "dying", "stable", "dead", "nonsense", 3, null]);
  const fields: Record<string, FieldValue> = {};
  const candidates: [string, FieldValue | undefined][] = [
    ["healthState", maybe(status)],
    ["life", maybe(status, 3)],
    ["deathSaveSuccesses", maybe(rnd(4))],
    ["deathSaveFailures", maybe(pick<FieldValue>([0, 1, 2, 3, "two"]))],
    ["up", maybe(rnd(3), 3)],
    ["down", maybe(rnd(3), 3)],
  ];
  for (const [key, value] of candidates) if (value !== undefined) fields[key] = value;
  // Inserted in a random order: the rest op's deltas follow it.
  const names = [...RESOURCES].sort(() => rnd(3) - 1).filter(() => rnd(5) !== 0);
  const conditions: ConditionState[] = Array.from({ length: rnd(4) }, (_, i) => ({
    id: `${id}c${i}`,
    conditionId: "c",
    expiresOn: pick(ConditionDuration.options),
    expiresAfter: pick([null, 0, 1, 2, 5]),
  }));
  return {
    id,
    fields,
    resources: Object.fromEntries(names.map((name) => [name, genResource()])),
    ...(rnd(3) === 0 ? {} : { conditions }),
  };
}

function genState(): RuleState {
  const ids = ACTOR_IDS.filter(() => rnd(4) !== 0).sort(() => rnd(3) - 1);
  const actors = Object.fromEntries(ids.map((id) => [id, genActor(id)]));
  if (rnd(5) === 0) return { actors, turn: null };
  const order = [...ids, ...(rnd(4) === 0 ? ["gone"] : [])].sort(() => rnd(3) - 1);
  const anyId = () => pick<string | null>([...order, ...order, "stale", null]);
  return {
    actors,
    turn: {
      round: rnd(5),
      currentId: anyId(),
      order: rnd(8) === 0 ? [] : order,
      ...(rnd(2) === 0 ? { firstId: anyId() } : {}),
    },
  };
}

// Actors written against id order with no turn order, so the sort among condition holders shows.
const UNSORTED: RuleState = {
  actors: Object.fromEntries(
    ["z", "m", "a"].map((id) => [
      id,
      {
        id,
        fields: {},
        resources: {},
        conditions: (["roundEnd", "encounterEnd"] as const).map((expiresOn, i) => ({
          id: `${id}${i}`,
          conditionId: "c",
          expiresOn,
          expiresAfter: 2,
        })),
      },
    ]),
  ),
  turn: null,
};

const DYING: RuleState = {
  actors: {
    pc: {
      id: "pc",
      fields: { healthState: "dying", deathSaveFailures: 0 },
      resources: { hp: { value: 0, min: 0, max: 10 } },
    },
  },
  turn: null,
};

// Shared pools: one with no max, one at its minimum, one capped, one with a max below its min. Their own generator, so
// the random stream the other states and inputs draw from does not move.
let poolSeed = 7;
const prnd = (n: number) => (((poolSeed = (Math.imul(poolSeed, 1103515245) + 12345) >>> 0) / 2 ** 32) * n) | 0;
const ppick = <T>(items: readonly T[]): T => items[prnd(items.length)] as T;
const POOL_IDS = ["luck", "menace", "open", "floor"];
function genPools(): Record<string, ResourceState> {
  const reset = Object.fromEntries(ResetEvent.options.flatMap((e) => (prnd(3) === 0 ? [[e, prnd(12) - 2]] : [])));
  return Object.fromEntries(
    POOL_IDS.filter(() => prnd(4) !== 0).map((id) => [
      id,
      {
        value: ppick([0, 0, 1, 3, 5, 9, 12, -2]),
        min: ppick([0, 0, 0, -3]),
        max: ppick([null, null, 5, 9, -1]),
        ...(prnd(2) === 0 ? { reset } : {}),
      },
    ]),
  );
}
const POOLS: RuleState = {
  actors: { a1: { id: "a1", fields: {}, resources: { hp: { value: 3, min: 0, max: 10, reset: { longRest: 10 } } } } },
  turn: null,
  pools: {
    luck: { value: 3, min: 0, max: 5, reset: { longRest: 5, sessionStart: 2 } },
    menace: { value: 0, min: 0, max: null, reset: { sessionStart: 1 } },
    open: { value: 7, min: 0, max: null },
    spent: { value: 0, min: 0, max: 5, reset: { longRest: 0 } },
  },
};
const STATES: RuleState[] = [
  { actors: {}, turn: null },
  UNSORTED,
  DYING,
  ...Array.from({ length: 60 }, genState).map((s) => (prnd(2) === 0 ? { ...s, pools: genPools() } : s)),
  POOLS,
];

// `initiative.sides`: states of their own, from a stream of their own, appended after the ones every other primitive
// draws from, so those corpora do not move. Members sit on three side ids; the params declare two to four of them.
const BASE_STATES = STATES.length;
let sideSeed = 11;
const srnd = (n: number) => (((sideSeed = (Math.imul(sideSeed, 1103515245) + 12345) >>> 0) / 2 ** 32) * n) | 0;
const spick = <T>(items: readonly T[]): T => items[srnd(items.length)] as T;
const SIDE_IDS = ["red", "blue", "green"];
function genSidesState(): RuleState {
  const members = ["m0", "m1", "m2", "m3", "m4", "m5"].slice(0, 2 + srnd(5));
  const order = [...members, ...(srnd(8) === 0 ? ["ghost"] : [])].sort(() => srnd(3) - 1);
  const sideOf = Object.fromEntries(members.filter(() => srnd(30) !== 0).map((id) => [id, spick(SIDE_IDS)]));
  const some = () => order.filter(() => srnd(4) === 0);
  const maybeList = (): string[] | undefined => (srnd(2) === 0 ? some() : undefined);
  const side = () => spick<string | null>([...SIDE_IDS, null, null, "stale"]);
  const turn: TurnState = {
    round: spick([0, 1, 1, 2, 2, 3, 4]),
    currentId: spick<string | null>([...order, null, null, null, "stale"]),
    order: srnd(10) === 0 ? [] : order,
    ...(srnd(10) === 0 ? {} : { sideOf }),
    ...(srnd(3) === 0 ? {} : { begun: srnd(3) !== 0 }),
    ...(srnd(2) === 0 ? { lastSide: side() } : {}),
    ...(srnd(3) === 0 ? { outOfTurnSide: side() } : {}),
  };
  for (const key of ["done", "held", "barred", "unable"] as const) {
    const list = maybeList();
    if (list !== undefined) turn[key] = list;
  }
  const pool = () => ({ value: spick([0, 1, 1, 2, 3, 5]), min: 0, max: spick([null, 9]) });
  const pools = { ...(srnd(8) === 0 ? {} : { gold: pool() }), ...(srnd(8) === 0 ? {} : { tin: pool() }) };
  return { actors: {}, turn, ...(srnd(10) === 0 ? {} : { pools }) };
}
STATES.push(...Array.from({ length: 150 }, genSidesState));
const SIDES_END = STATES.length;

// `health.harm` (house decision #66): actors of the invented sample-harm ruleset, built as the api builds them (scope,
// bounds, limits), from a stream of their own so the corpora above do not move. Heroes at every wound and strain
// around their limits, spent or not, down or not; brutes; swarms at several sizes; actors no profile holds.
const HARM_COMPILED = (() => {
  const r = compileRuleset(SAMPLE_HARM);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.compiled;
})();
const HARM_BLOCK = HARM_COMPILED.ruleset.health.harm;
const HARM_PARAMS: unknown[] = [
  HARM_BLOCK,
  // No shock and no mobs: every shock is refused, a swarm is wounded like anyone.
  { ...HARM_BLOCK, shock: undefined, mob: undefined },
  // Spent by its condition alone, down without a cap on healing or a condition, nothing destroyed.
  {
    ...HARM_BLOCK,
    profiles: [
      {
        entities: ["hero", "swarm"],
        spent: { conditions: ["winded", "down"] },
        felled: { when: "res.wounds >= derived.limit" },
      },
      { entities: ["brute"], felled: { when: "res.wounds > 2", injuries: "hide", condition: "winded" }, convert: true },
    ],
  },
  // House decision #174: destroyed only while its `when` holds, else hurt as anyone.
  {
    ...HARM_BLOCK,
    profiles: HARM_BLOCK?.profiles?.map((p) =>
      p.destroyed === undefined ? p : { ...p, destroyed: { ...p.destroyed, when: "res.wounds >= 1" } },
    ),
  },
];
let harmSeed = 66;
const hrnd = (n: number) => (((harmSeed = (Math.imul(harmSeed, 1103515245) + 12345) >>> 0) / 2 ** 32) * n) | 0;
const hpick = <T>(items: readonly T[]): T => items[hrnd(items.length)] as T;

function harmActor({
  entity,
  fields,
  values,
  conditions,
}: {
  entity: string;
  fields: Record<string, FieldValue>;
  values: Record<string, number>;
  conditions: string[];
}): ActorState {
  const derived = deriveValues({ compiled: HARM_COMPILED, entity, values: { fields, resources: values, conditions } });
  const scope = actorScope({ fields, derived, resources: values });
  const resources: Record<string, ResourceState> = {};
  for (const [resource, value] of Object.entries(values)) {
    const b = resourceBounds({ compiled: HARM_COMPILED, resource, scope });
    resources[resource] = { value, min: b.min, max: b.capped ? b.max : null, limit: b.max };
  }
  return {
    id: "h",
    entity,
    fields,
    resources,
    scope,
    conditions: conditions.map((c, i) => ({ id: `h${i}`, conditionId: c, expiresOn: "manual", expiresAfter: null })),
  };
}

function genHarmState(): RuleState {
  const conditions = ["down", "winded"].filter(() => hrnd(3) === 0);
  const kind = hpick(["hero", "hero", "hero", "brute", "swarm", "swarm", "ghost", "none"]);
  let a: ActorState;
  if (kind === "swarm") {
    const size = hpick([1, 2, 3, 5, 8, 12, 40]);
    const members = hpick([0, 1, size, size, Math.ceil(size / 2), size - 1].filter((n) => n >= 0));
    a = harmActor({ entity: "swarm", fields: { size }, values: { wounds: 0, strain: 0, members }, conditions });
  } else if (kind === "brute") {
    const hide = 1 + hrnd(6);
    const wounds = hrnd(2 * hide + 4);
    a = harmActor({ entity: "brute", fields: { hide }, values: { wounds, strain: 0 }, conditions });
  } else {
    const grit = 1 + hrnd(5);
    const limit = grit + 3;
    const wounds = hpick([0, 0, 1, limit - 1, limit, limit + 1, limit + 2, 2 * limit, hrnd(3 * limit)]);
    const strain = hpick([0, grit - 1, grit, grit + 1, grit + 3, hrnd(2 * grit + 2)].filter((n) => n >= 0));
    const scars = hpick<FieldValue | undefined>([undefined, 0, 1, 3]);
    const fields: Record<string, FieldValue> = { grit, ...(scars === undefined ? {} : { scars }) };
    a = harmActor({ entity: "hero", fields, values: { wounds, strain }, conditions });
    if (kind === "ghost") a = { ...a, entity: "ghost" };
    if (kind === "none") a = { ...a, entity: undefined };
  }
  if (hrnd(25) === 0) a = { ...a, scope: undefined };
  if (hrnd(30) === 0) a = { ...a, resources: {} };
  return { actors: { h: a }, turn: null };
}
const HARM_STATES_AT = STATES.length;
STATES.push(...Array.from({ length: 400 }, genHarmState));

/** A hit for one harm state: its thresholds often, any sign and size otherwise. */
function genHit(state: RuleState): { wounds?: number; shock?: number } {
  const a = state.actors.h;
  const derived = new Map(Object.entries(a?.scope?.derived ?? {}));
  const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
  const limit = num(derived.get("limit"), 3);
  const cap = num(derived.get("strainCap"), 2);
  const wounds = a?.resources.wounds?.value ?? 0;
  const strain = a?.resources.strain?.value ?? 0;
  const w = hpick([
    0,
    0,
    hrnd(25) - 12,
    limit - wounds,
    limit - wounds + 1,
    2 * limit,
    2 * limit + 1,
    -limit,
    100,
    -100,
    1,
    -1,
  ]);
  const s = hpick([0, 0, hrnd(13) - 6, cap, cap + 1, cap - strain, cap - strain + 1, -strain, 3, -2]);
  return { ...(w === 0 && hrnd(2) === 0 ? {} : { wounds: w }), ...(s === 0 && hrnd(2) === 0 ? {} : { shock: s }) };
}

function genInput(primitive: string, op: string, state: RuleState): unknown {
  const ids = [...Object.keys(state.actors), ...(state.turn?.order ?? [])];
  const id = () => (ids.length > 0 && rnd(6) !== 0 ? pick(ids) : "nobody");
  const hp = () => pick(["hp", "tempHp", "mana", "other"]);
  switch (`${primitive}.${op}`) {
    case "dice.sumVsTarget.resolve":
      return {
        target: rnd(25),
        ...(rnd(2) === 0 ? { modifier: rnd(11) - 5 } : {}),
        ...(rnd(2) === 0 ? { advantage: pick(AdvantageMode.options) } : {}),
        roll:
          rnd(2) === 0
            ? { kind: "faces", faces: Array.from({ length: 1 + rnd(3) }, () => rnd(23)) }
            : { kind: "total", total: rnd(30), ...(rnd(2) === 0 ? { natural: rnd(24) } : {}) },
      };
    case "dice.poolSuccesses.resolve":
      return {
        target: rnd(10),
        pool: rnd(10),
        roll: {
          kind: "pool",
          ...(rnd(4) === 0
            ? {}
            : {
                counts: {
                  hit: rnd(4),
                  ...(rnd(2) === 0 ? { top: rnd(3) } : {}),
                  ...(rnd(9) === 0 ? { nope: 1 } : {}),
                },
              }),
          ...(rnd(4) === 0 ? {} : { special: Array.from({ length: rnd(3) }, () => rnd(10)) }),
        },
      };
    case "initiative.ranked.start":
      return {
        combatants: Array.from({ length: 1 + rnd(4) }, (_, i) => ({
          id: rnd(9) === 0 ? "dup" : pick(["x", "é", "😀", "￿", "b"]) + (rnd(2) === 0 ? "" : i),
          score: rnd(4),
          ...(rnd(4) === 0 ? {} : { tiebreaks: Array.from({ length: rnd(3) }, () => rnd(3)) }),
        })),
        ...(rnd(2) === 0 ? { round: rnd(4) } : {}),
      };
    case "initiative.seated.start":
      return { ids: Array.from({ length: 1 + rnd(4) }, (_, i) => (rnd(9) === 0 ? "dup" : `s${i}`)) };
    case "initiative.ranked.remove":
    case "initiative.seated.remove":
    case "initiative.seated.first":
    case "initiative.sides.seize":
    case "initiative.sides.interrupt":
    case "initiative.sides.lift":
      return { id: id() };
    case "initiative.sides.pick":
      return { id: id(), ...(rnd(3) === 0 ? { force: rnd(2) === 0 } : {}) };
    case "initiative.sides.mark":
      return { id: id(), done: rnd(2) === 0 };
    case "initiative.sides.bar":
      // A whole side (house decision #81) a third of the time, and now and then both or neither.
      return rnd(3) === 0
        ? { side: pick(["red", "blue", "green", "nope"]), barred: rnd(2) === 0, ...(rnd(6) === 0 ? { id: id() } : {}) }
        : { ...(rnd(12) === 0 ? {} : { id: id() }), barred: rnd(2) === 0 };
    case "health.tracks.damage":
      return {
        actorId: id(),
        amount: rnd(30),
        ...(rnd(3) === 0 ? { track: hp() } : {}),
        ...(rnd(2) === 0 ? { critical: rnd(2) === 0 } : {}),
      };
    case "health.tracks.heal":
      return { actorId: id(), amount: rnd(30), ...(rnd(3) === 0 ? { track: hp() } : {}) };
    case "health.tracks.deathSave":
      return { actorId: id(), result: pick(DeathSaveResult.options) };
    case "resource.capped.adjust":
      return { actorId: id(), resource: hp(), delta: rnd(61) - 30 };
    case "conditions.expire.turnEnd":
      return { actorId: id() };
    case "resource.capped.adjustPool":
      return { resource: pick([...POOL_IDS, "spent", "other"]), delta: rnd(61) - 30 };
    case "rest.apply":
      return {
        event: pick(ResetEvent.options),
        ...(rnd(2) === 0 ? { actorIds: Array.from({ length: rnd(4) }, id) } : {}),
      };
    default:
      return {};
  }
}

const BAD_VALUES = [null, "", "x", 1.5, -1, 1e7, 2 ** 60, [], {}, true, [1], ["x"], "constructor"];

/** Breaks one value somewhere inside the input: what a bad client could send. */
function breakInput(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0 || rnd(3) === 0) return pick(BAD_VALUES);
    const at = rnd(value.length);
    return value.map((item, i) => (i === at ? breakInput(item) : (item as unknown)));
  }
  if (typeof value !== "object" || value === null) return pick(BAD_VALUES);
  const entries = Object.entries(value);
  if (entries.length === 0 || rnd(5) === 0) return { ...value, extra: pick(BAD_VALUES) };
  const key = pick(entries)[0];
  if (rnd(4) === 0) return Object.fromEntries(entries.filter(([k]) => k !== key));
  return { ...value, [key]: breakInput((value as Record<string, unknown>)[key]) };
}

function opVectors() {
  const params: unknown[] = [];
  const cases: unknown[] = [];
  const paramsAt = new Map<unknown, number>();
  const run = ({
    primitive,
    op,
    p,
    state,
    input,
  }: {
    primitive: string;
    op: string;
    p: unknown;
    state: number;
    input: unknown;
  }) => {
    const prim = Object.hasOwn(PRIMITIVES, primitive) ? PRIMITIVES[primitive] : undefined;
    const def = prim !== undefined && Object.hasOwn(prim.ops, op) ? prim.ops[op] : undefined;
    const zodRefused = prim !== undefined && def !== undefined && !def.input.safeParse(input).success;
    const r = runOp({ primitive, op, params: p, state: STATES[state] as RuleState, input });
    cases.push({
      primitive,
      op,
      params: paramsAt.get(p) ?? -1,
      state,
      input,
      ok: r.ok,
      ...(r.ok
        ? { deltas: r.deltas, touches: r.touches, perm: r.perm }
        : { ...r.refusal, codeOnly: zodRefused || r.refusal.message.startsWith("no scoring band") }),
    });
  };
  for (const [primitive, list] of Object.entries(OP_PARAMS)) {
    const prim = PRIMITIVES[primitive];
    if (prim === undefined) throw new Error(`no primitive ${primitive}`);
    for (const p of list) {
      if (!prim.params.safeParse(p).success) throw new Error(`a fixture is not valid: ${JSON.stringify(p)}`);
      paramsAt.set(p, params.length);
      params.push(p);
    }
    for (const op of Object.keys(prim.ops)) {
      // The pool op draws from a stream of its own: the manifest vectors that follow keep the corpus they had.
      const saved = seed;
      for (let i = 0; i < (primitive === "health.tracks" ? 6000 : 1500); i++) {
        const state = primitive === "initiative.sides" ? BASE_STATES + rnd(SIDES_END - BASE_STATES) : rnd(BASE_STATES);
        const valid = genInput(primitive, op, STATES[state] as RuleState);
        run({ primitive, op, p: pick(list), state, input: rnd(4) === 0 ? breakInput(valid) : valid });
      }
      if (op === "adjustPool" || primitive === "initiative.sides") seed = saved;
    }
  }
  // Rules random inputs rarely reach: shifts stop at the dice of the band, and a critical hit on a dying actor.
  const counts = { hit: 3, top: 1 };
  const shifted = { target: 0, pool: 5, roll: { kind: "pool", counts, special: [2] } };
  run({
    primitive: "dice.poolSuccesses",
    op: "resolve",
    p: OP_PARAMS["dice.poolSuccesses"]?.[1],
    state: 0,
    input: shifted,
  });
  for (const critical of [true, false]) {
    const input = { actorId: "pc", amount: 1, critical };
    run({ primitive: "health.tracks", op: "damage", p: OP_PARAMS["health.tracks"]?.[3], state: 2, input });
  }
  // `health.harm`: 3,000 hits and 400 musters over the harm states, on the stream they were drawn from.
  for (const p of HARM_PARAMS) {
    if (!PRIMITIVES["health.harm"]?.params.safeParse(p).success) throw new Error(`not valid: ${JSON.stringify(p)}`);
    paramsAt.set(p, params.length);
    params.push(p);
  }
  const harmState = () => HARM_STATES_AT + hrnd(STATES.length - HARM_STATES_AT);
  const BROKEN = [
    { actorId: "h", wounds: 1.5 },
    { actorId: "h", wounds: 101 },
    { actorId: "h", shock: -101 },
    { actorId: "h" },
    { actorId: "h", wounds: 0, shock: 0 },
    { actorId: "", wounds: 1 },
    { wounds: 1 },
    { actorId: "h", shock: "1" },
    null,
  ];
  for (let i = 0; i < 3000; i++) {
    const state = harmState();
    const valid = { actorId: hrnd(40) === 0 ? "nobody" : "h", ...genHit(STATES[state] as RuleState) };
    const input = hrnd(15) === 0 ? hpick(BROKEN) : valid;
    run({ primitive: "health.harm", op: "hit", p: hpick(HARM_PARAMS), state, input });
  }
  for (let i = 0; i < 400; i++) {
    const members = hpick([1, 2, 5, 12, 40, 500, 0, 501, 2.5]);
    const input = { actorId: hrnd(20) === 0 ? "nobody" : "h", members };
    run({ primitive: "health.harm", op: "muster", p: hpick(HARM_PARAMS), state: harmState(), input });
  }
  // `convert` (house decision #84): amounts either side of the wounds held, and out of range.
  for (let i = 0; i < 600; i++) {
    const amount = hpick([1, 1, 2, 3, 5, 12, 100, 0, 101, 2.5]);
    const input = { actorId: hrnd(20) === 0 ? "nobody" : "h", amount };
    run({ primitive: "health.harm", op: "convert", p: hpick(HARM_PARAMS), state: harmState(), input });
  }
  // Sides: the paths a random state seldom lines up for (a paid seize, an automatic wrap, a lifted bar).
  const sideTurn = (over: Partial<TurnState>, gold = 3, tin = 3): number =>
    STATES.push({
      actors: {},
      turn: {
        round: 1,
        currentId: null,
        order: ["a1", "a2", "b1", "b2"],
        sideOf: { a1: "red", a2: "red", b1: "blue", b2: "blue" },
        ...over,
      },
      pools: { gold: { value: gold, min: 0, max: null }, tin: { value: tin, min: 0, max: null } },
    }) - 1;
  const sidesParams = OP_PARAMS["initiative.sides"] ?? [];
  const sideRun = (index: number, op: string, state: number, input: unknown = {}) =>
    run({ primitive: "initiative.sides", op, p: sidesParams[index], state, input });
  const wrapping = { done: ["a1", "a2", "b1"], currentId: "b2", lastSide: "red" };
  for (const index of [0, 1, 2, 3]) {
    for (const over of [{}, { round: 2 }, { lastSide: "red" }, { lastSide: "blue", round: 3 }, { currentId: "a1" }]) {
      const state = sideTurn(over);
      for (const id of ["a1", "b1"]) {
        sideRun(index, "seize", state, { id });
        sideRun(index, "pick", state, { id });
      }
    }
    for (const op of ["next", "hold", "newRound"]) {
      sideRun(index, op, sideTurn(wrapping));
      sideRun(index, op, sideTurn({ ...wrapping, round: 2, barred: ["a1"] }));
      sideRun(index, op, sideTurn({ currentId: "a1", held: ["b1"], outOfTurnSide: "red" }));
    }
    sideRun(index, "begin", sideTurn({ begun: false, done: ["a1"], held: ["b1"], barred: ["a2"] }));
    sideRun(index, "lift", sideTurn({ barred: ["a1", "b1"] }), { id: "a1" });
    sideRun(index, "lift", sideTurn({ barred: ["a1", "b1"] }, 0, 0), { id: "b1" });
    sideRun(index, "seize", sideTurn({ lastSide: "red", outOfTurnSide: "red" }), { id: "a2" });
    sideRun(index, "seize", sideTurn({ lastSide: "red", outOfTurnSide: "blue" }), { id: "a2" });
    sideRun(index, "seize", sideTurn({ lastSide: "red" }, 0, 0), { id: "a2" });
    sideRun(index, "seize", sideTurn({ lastSide: "red" }, 3, 3), { id: "a2" });
    sideRun(index, "seize", sideTurn({ currentId: "b1", lastSide: "red" }), { id: "a2" });
    sideRun(index, "seize", sideTurn({ currentId: "a1", lastSide: "red", unable: ["b1"] }), { id: "b2" });
    sideRun(index, "interrupt", sideTurn({ held: ["a1"], done: ["a1"] }), { id: "a1" });
    sideRun(index, "mark", sideTurn({ held: ["a1"], done: ["a1"] }), { id: "a1", done: false });
    sideRun(index, "bar", sideTurn({ round: 3 }), { id: "a1", barred: true });
    sideRun(index, "bar", sideTurn({ round: 2 }), { id: "a1", barred: true });
  }
  const empty = OP_PARAMS.rest?.[0];
  for (const [primitive, op] of [
    ["nope", "apply"],
    ["constructor", "apply"],
    ["rest", "nope"],
    ["rest", "constructor"],
  ] as const) {
    run({ primitive, op, p: empty, state: 0, input: {} });
  }
  // Every combination of the sum rules, since it is the mechanic most tables use first.
  for (const p of OP_PARAMS["dice.sumVsTarget"] ?? [])
    for (const advantage of AdvantageMode.options)
      for (const target of [10, 15, 12])
        for (const modifier of [0, 5, -3])
          for (const roll of ROLLS) {
            const input = { target, modifier, advantage, roll };
            run({ primitive: "dice.sumVsTarget", op: "resolve", p, state: 0, input });
          }
  // Degrees of success (house decision #42): every boundary of the step, with the natural die at its top, bottom and middle.
  for (const p of (OP_PARAMS["dice.sumVsTarget"] ?? []).filter(
    (x) => (x as { degrees?: unknown }).degrees !== undefined,
  ))
    for (const target of [10, 15])
      for (let total = target - 7; total <= target + 7; total++)
        for (const natural of [undefined, 1, 2, 10, 19, 20, 6, 12])
          run({
            primitive: "dice.sumVsTarget",
            op: "resolve",
            p,
            state: 0,
            input: { target, roll: { kind: "total", total, ...(natural === undefined ? {} : { natural }) } },
          });
  return {
    // Arrays, because the order of actors and resources decides the order of deltas and decoded JSON would lose it.
    states: STATES.map((s) => ({
      turn: s.turn,
      pools: Object.entries(s.pools ?? {}).map(([name, state]) => ({ name, state })),
      actors: Object.values(s.actors).map((a) => ({
        ...a,
        resources: Object.entries(a.resources).map(([name, state]) => ({ name, state })),
      })),
    })),
    params,
    cases,
  };
}

// Spends (house decision #84): what planSpend answers for the fixtures' spends on actors and fights around their edges.
function spendVectors() {
  const compiled = (input: unknown) => {
    const r = compileRuleset(input);
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    return r.compiled.ruleset;
  };
  // House decision #116: the skirmish's rally only on the actor's own turn or while it holds, never while a foe acts.
  const FIGHT_KEYS = {
    ...SAMPLE_SKIRMISH,
    spends: SAMPLE_SKIRMISH.spends?.map((s) =>
      s.id === "rally" ? { ...s, if: "!ctx.fight.foeActing && (ctx.fight.acting || ctx.fight.held)" } : s,
    ),
  };
  const rulesets = [compiled(SAMPLE_HARM), compiled(SAMPLE_SKIRMISH), compiled(FIGHT_KEYS)];
  let seed = 84;
  const r = (n: number) => (((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32) * n) | 0;
  const one = <T>(items: readonly T[]): T => items[r(items.length)] as T;
  const cases: unknown[] = [];
  const add = (
    ruleset: number,
    spendId: string,
    actor: ActorState,
    state: RuleState,
    inputs: Record<string, unknown>,
  ) => {
    const plan = planSpend({ ruleset: rulesets[ruleset] as Ruleset, spendId, actor, state, inputs });
    const flat = {
      turn: state.turn,
      pools: Object.entries(state.pools ?? {}).map(([name, s]) => ({ name, state: s })),
    };
    const wire = { ...actor, resources: Object.entries(actor.resources).map(([name, s]) => ({ name, state: s })) };
    cases.push({ ruleset, spendId, actor: wire, state: flat, inputs, ...(isRefusalLike(plan) ? plan : { plan }) });
  };
  const harmStates = STATES.slice(HARM_STATES_AT, HARM_STATES_AT + 400);
  for (let i = 0; i < 1500; i++) {
    const base = one(harmStates).actors.h;
    if (base === undefined) continue;
    const resolve = one([0, 1, 2, 3]);
    const scope =
      base.scope === undefined ? undefined : { ...base.scope, res: { ...(base.scope.res as object), resolve } };
    const actor: ActorState = {
      ...base,
      ...(scope === undefined ? {} : { scope }),
      resources: r(10) === 0 ? base.resources : { ...base.resources, resolve: { value: resolve, min: 0, max: 3 } },
    };
    const inputs = one<Record<string, unknown>>([
      {},
      { marks: 1 },
      { marks: 4 },
      { marks: 0 },
      { marks: 11 },
      { marks: 1.5 },
      { marks: "2" },
      { marks: 2, x: 1 },
    ]);
    add(0, one(["retry", "steady", "endure", "endure", "nope"]), actor, { actors: { h: actor }, turn: null }, inputs);
  }
  const fighter: ActorState = {
    id: "c1",
    entity: "character",
    fields: {},
    resources: {},
    scope: { party: { characters: 2 } },
  };
  for (let i = 0; i < 600; i++) {
    const turn = one<RuleState["turn"]>([
      null,
      { round: 1, currentId: null, order: ["c1", "r1"] },
      { round: 2, currentId: "r1", order: ["c1", "r1"], barred: ["c1"] },
      { round: 1, currentId: null, order: ["r1"], barred: ["r1"] },
      // House decision #91: uses limited per round, this round's and an earlier one's.
      { round: 2, currentId: null, order: ["c1", "r1"], used: ["1:c1:channel", "2:r1:channel"] },
      { round: 2, currentId: null, order: ["c1", "r1"], used: ["2:c1:channel"] },
      { round: 3, currentId: null, order: ["c1", "r1"], used: ["2:c1:channel", "3:c1:rally"] },
    ]);
    const pools: Record<string, ResourceState> =
      r(8) === 0 ? {} : { momentum: { value: one([0, 1, 2, 3, 6]), min: 0, max: 6 } };
    const nerve = one([0, 1, 3, 4]);
    const armed = { ...fighter, resources: { nerve: { value: nerve, min: 0, max: 4 } } };
    const actor = one([fighter, armed, armed, { ...fighter, entity: "creature" }, { ...fighter, scope: undefined }]);
    const inputs = one<Record<string, unknown>>([
      {},
      { dice: 1 },
      { dice: 2 },
      { dice: 3 },
      { dice: 4 },
      { dice: 0 },
      { push: 0 },
      { push: 2 },
      { push: 3 },
    ]);
    const spendId = one(["rally", "rally", "jump", "shake", "channel", "channel"]);
    add(1, spendId, actor, { actors: { c1: actor }, turn, pools }, inputs);
  }
  // House decision #116: who acts, who holds, and a foe acting, on both sides and with someone unknown acting.
  const sides = { c1: "wardens", c2: "wardens", r1: "raiders" };
  const order = ["c1", "c2", "r1"];
  for (const turn of [
    null,
    { round: 1, currentId: "c1", order, sideOf: sides },
    { round: 1, currentId: "c2", order, sideOf: sides },
    { round: 1, currentId: "r1", order, sideOf: sides },
    { round: 1, currentId: "r1", order, sideOf: sides, held: ["c1"] },
    { round: 1, currentId: "c2", order, sideOf: sides, held: ["c1"] },
    { round: 1, currentId: "zz", order, sideOf: sides, held: ["c1"] },
    { round: 1, currentId: null, order, held: ["c1"] },
    { round: 1, currentId: "r1", order: ["r1"], sideOf: sides, held: ["c1"] },
  ] satisfies RuleState["turn"][]) {
    const pools = { momentum: { value: 6, min: 0, max: 6 } };
    add(2, "rally", fighter, { actors: { c1: fighter }, turn, pools }, { dice: 1 });
  }
  return { rulesets: [SAMPLE_HARM, SAMPLE_SKIRMISH, FIGHT_KEYS], cases };
}

const isRefusalLike = (v: object): v is { code: string; message: string } => "code" in v && "message" in v;

// Strikes (house decision #99): planStrike over the harm fixture's blow and the duel fixture's lunge, with random
// attackers, targets, means, inputs and totals, some of them missing a value or out of bounds.
function strikeVectors() {
  const compiled = (input: unknown) => {
    const r = compileRuleset(input);
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    return r.compiled.ruleset;
  };
  const rulesets = [compiled(SAMPLE_HARM), compiled(SAMPLE_DUEL)];
  let seed = 99;
  const r = (n: number) => (((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32) * n) | 0;
  const one = <T>(items: readonly T[]): T => items[r(items.length)] as T;
  const cases: unknown[] = [];
  const party = { characters: 3 };
  const harmSide = () => {
    const entity = one(["hero", "hero", "brute", "swarm", "swarm", "arm"]);
    const wounds = r(6);
    const members = r(9);
    const derived = { might: r(6), guard: r(5), toughness: r(7), strainCap: one([0, 2, 4]), limit: r(8) };
    const scope: Record<string, unknown> =
      entity === "swarm"
        ? { size: 8, derived, res: { wounds, strain: r(3), members }, party }
        : { grit: r(8), derived, res: { wounds, strain: r(3) }, party };
    if (r(12) === 0) delete scope.derived;
    if (r(10) === 0) scope.arms = one([[], ["maul"]]);
    return { entity, scope };
  };
  const duelSide = () => ({
    entity: one(["duelist", "duelist", "blade"]),
    scope:
      r(12) === 0 ? { party } : { skill: r(8), parry: 5 + r(15), derived: { limit: 5 }, res: { cuts: r(6) }, party },
  });
  for (let i = 0; i < 2500; i++) {
    const duel = r(4) === 0;
    const side = duel ? duelSide : harmSide;
    const means = duel
      ? one([
          { cut: 2 },
          { cut: 3, marks: ["Swift", 2, -0] },
          { cut: "3" },
          { cut: 2, marks: "Fine,, Keen " },
          {},
          null,
        ])
      : one([
          { damage: 4, edge: 1, pierce: 0, close: true },
          { damage: 4, edge: 1, pierce: 0, close: true, traits: "Brutal" },
          { damage: 3, edge: 0, pierce: -1, close: false, traits: "Far, Light" },
          { damage: 3, edge: 1, pierce: -2, close: "yes", traits: 3 },
          { damage: 2, edge: 0, pierce: 0, close: true, traits: ["Brutal", " Heavy ", "", 2, 1.5, true, null] },
          { damage: 2, edge: 0, pierce: 0, close: true, traits: Array.from({ length: 25 }, (_, i) => `T${i}`) },
          { pierce: 1.5 },
          {},
          null,
        ]);
    const strikeId = duel ? one(["lunge", "lunge", "nope"]) : one(["blow", "blow", "blow", "blow", "sweep", "nope"]);
    const inputs = duel
      ? one<Record<string, unknown>>([{}, {}, { aim: true }])
      : strikeId === "sweep"
        ? // The sweep's choice (house decision #113): none, an option, one that is not, a switch's value, the blow's.
          one<Record<string, unknown>>([{}, { force: 1 }, { force: 2 }, { force: 3 }, { force: true }, { aim: true }])
        : one<Record<string, unknown>>([
            {},
            { aim: true },
            { aim: true, far: 2 },
            { far: 3 },
            { far: 4 },
            { aim: 1 },
            { far: 1.5 },
            { nope: true },
          ]);
    const total = one<number | null>([null, r(16), r(16), r(16) - 3, 2.5, 1001]);
    const attacker = side();
    const target = side();
    const plan = planStrike({
      ruleset: rulesets[duel ? 1 : 0]!,
      strikeId,
      attacker: attacker as never,
      target: target as never,
      means,
      inputs,
      total,
    });
    cases.push({ ruleset: duel ? 1 : 0, strikeId, attacker, target, means, inputs, total, result: plan });
  }
  return { rulesets: [SAMPLE_HARM, SAMPLE_DUEL], cases };
}

// Acquiring by a Test (house decision #102): what planAcquire answers for ACQUIRE_MANIFEST and the ledger sample on
// actors, entries and picks around their edges.
function acquireVectors() {
  const compiled = (input: unknown) => {
    const r = compileRuleset(input);
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    return r.compiled.ruleset;
  };
  const rulesets = [compiled(ACQUIRE_MANIFEST), compiled(SAMPLE_LEDGER_RULESET)];
  let seed = 102;
  const r = (n: number) => (((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32) * n) | 0;
  const one = <T>(items: readonly T[]): T => items[r(items.length)] as T;
  const items: AcquireItem[][] = [
    [
      { type: "gear", key: "a", name: "Axe", tags: ["tool", "x"], body: { rating: 2 } },
      { type: "gear", key: "b", name: "Bow", tags: ["tool", "x", "y", "y"], body: { rating: 4, loads: "c" } },
      { type: "gear", key: "c", name: "Bolts", tags: ["shot", "x"], body: { rating: 1 } },
      { type: "gear", key: "d", name: "Dial", tags: ["addon", "y"], body: { rating: 3, slot: "s" } },
      { type: "gear", key: "e", name: "Bag", tags: ["z"], body: { rating: 0, loads: "" } },
      { type: "gear", key: "f", name: "Flute", tags: ["x"], body: {} },
      { type: "nope", key: "g", name: "Gone", tags: ["x"], body: {} },
    ],
    SAMPLE_LEDGER_PACK.entries
      .filter((e) => e.type === "wargear" || e.type === "supply")
      .map((e) => ({ type: e.type, key: e.key, name: e.name, tags: e.tags ?? [], body: e.body ?? {} })),
  ];
  const actors: ActorState[][] = [
    [
      { id: "p", entity: "pc", fields: {}, resources: {}, scope: { attr: { str: 2 }, words: ["x", "y"] } },
      { id: "p", entity: "pc", fields: {}, resources: {}, scope: { attr: { str: 0 }, words: [] } },
      { id: "p", entity: "pc", fields: {}, resources: {}, scope: { attr: { str: 1 }, words: ["y"] } },
      { id: "p", entity: "pc", fields: {}, resources: {} },
      { id: "p", entity: "other", fields: {}, resources: {}, scope: {} },
      { id: "p", entity: "pc", fields: {}, resources: {}, scope: { attr: { str: 1 } } },
    ],
    [
      { id: "h", entity: "hero", fields: {}, resources: {}, scope: { keywords: ["WARDEN", "BOW"] } },
      { id: "h", entity: "hero", fields: {}, resources: {}, scope: { keywords: ["TOOL"] } },
      { id: "h", entity: "hero", fields: {}, resources: {}, scope: { keywords: [] } },
    ],
  ];
  const picks: Record<string, unknown>[] = [
    {},
    { push: 0 },
    { push: 0 },
    { push: 0 },
    { push: 1 },
    { push: 1 },
    { push: 2 },
    { push: 3 },
    { push: -1 },
    { push: -2 },
    { push: 1.5 },
    { push: 1, x: 1 },
  ];
  const cases: unknown[] = [];
  for (let i = 0; i < 600; i++) {
    const ruleset = r(2);
    const actor = one(actors[ruleset] ?? []);
    const item = one(items[ruleset] ?? []);
    const picked = one(picks);
    const plan = planAcquire({ ruleset: rulesets[ruleset] as Ruleset, actor, item, picks: picked });
    cases.push({
      ruleset,
      actor: { ...actor, resources: [] },
      item,
      picks: picked,
      ...(isRefusalLike(plan) ? plan : { plan }),
    });
  }
  return { rulesets: [ACQUIRE_MANIFEST, SAMPLE_LEDGER_RULESET], cases };
}

// Fittings (house decision #102): withFittedCard over cards and strike means with numbers, words and gaps, and items
// whose effects add, override, change no card value, or cannot be read as a number.
function fittingVectors() {
  let seed = 224;
  const r = (n: number) => (((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32) * n) | 0;
  const one = <T>(items: readonly T[]): T => items[r(items.length)] as T;
  const cards: Record<string, unknown>[] = [
    { name: "Maul", damage: 4, ed: 1, ap: 0, traits: ["Brutal"] },
    { name: "Bow", damage: 3, ed: "1d3", ap: -1, range: [12, 24] },
    { ar: 2, name: "Coat" },
    { damage: 2.5, salvo: 2, close: true },
    {},
    // Traits (house decision #198): rated, unrated, comma text, a rating past three digits, a word in another case.
    { name: "Gun", damage: 5, traits: ["Rapid Fire (2)", "Heavy", "Spread (12)", "Odd (1234)", 7] },
    { name: "Sling", traits: "Far, Light ,, keen (1)" },
    { name: "Suit", ar: 4, traits: ["Bulky (1)"] },
  ];
  const effects = [
    { path: "host.damage", mode: "add", value: "1" },
    { path: "host.damage", mode: "override", value: "6" },
    { path: "host.ed", mode: "add", value: "2" },
    { path: "host.ap", mode: "add", value: "-1" },
    { path: "host.ap", mode: "override", value: "-0" },
    { path: "host.salvo", mode: "add", value: "1 + 1" },
    { path: "host.ar", mode: "add", value: "1" },
    { path: "host.range", mode: "add", value: "1" },
    { path: "derived.limit", mode: "add", value: "1" },
    { path: "host.damage", mode: "add", value: "true" },
    { path: "host.damage", mode: "add", value: "1 +" },
    { path: "host.damage", mode: "add", value: "nope.x" },
    { path: "host.trait.Keen", mode: "upgrade", value: "0" },
    { path: "host.trait.keen", mode: "upgrade", value: "2" },
    { path: "host.trait.Rapid Fire", mode: "add", value: "-1" },
    { path: "host.trait.Rapid Fire", mode: "add", value: "1" },
    { path: "host.trait.Heavy", mode: "override", value: "0" },
    { path: "host.trait.Bulky", mode: "override", value: "3" },
    { path: "host.trait.Brutal", mode: "upgrade", value: "1" },
    { path: "host.trait.Brutal", mode: "add", value: "-2" },
    { path: "host.trait.Spread", mode: "add", value: "990" },
    { path: "host.trait.Odd", mode: "upgrade", value: "5" },
    { path: "host.trait.Light", mode: "multiply", value: "2" },
    { path: "host.trait.Light", mode: "upgrade", value: "1.5" },
    { path: "host.trait.(x)", mode: "upgrade", value: "1" },
    { path: "host.trait.Far", mode: "override", value: "true" },
  ];
  const cases: unknown[] = [];
  for (let i = 0; i < 300; i++) {
    const card = one(cards);
    const fitted = Array.from({ length: r(4) }, () => ({
      name: one(["Sight", "Keen", "Sight", "Plate"]),
      effects: Array.from({ length: r(3) }, () => one(effects)),
    }));
    cases.push({ card, fitted, result: withFittedCard({ card, fitted }) });
  }
  return { cases };
}

// A build over a hand-made sheet (house decision #199): keptValue on numbers, lists with copies, and what is missing.
function keptVectors() {
  let seed = 199;
  const r = (n: number) => (((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32) * n) | 0;
  const one = <T>(items: readonly T[]): T => items[r(items.length)] as T;
  const values = [3, 0, -2, 7, null, "x", ["A"], ["A", "B", "A"], ["B", "C"], [], ["C", "C", "C", "A"]];
  const cases: unknown[] = [];
  for (let i = 0; i < 300; i++) {
    const x = { how: one(["greater", "merge"] as const), hand: one(values), built: one(values), max: 1 + r(5) };
    cases.push({ ...x, result: keptValue(x) });
  }
  return { cases };
}

// Spawns (house decision #92): planSpawn and budgetOf on the skirmish fixture's foes, varied around their edges.
function spawnVectors() {
  const r = compileRuleset(SAMPLE_SKIRMISH);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  const ruleset = r.compiled.ruleset;
  let seed = 92;
  const rnd = (n: number) => (((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32) * n) | 0;
  const one = <T>(items: readonly T[]): T => items[rnd(items.length)] as T;
  const bodies: Record<string, FieldValue>[] = [
    ...SAMPLE_SKIRMISH_PACK.entries.map((e) => e.body as Record<string, FieldValue>),
    {},
    { kind: "boss", level: 4 },
    { kind: "brute", level: null, grudge: 1 },
    { kind: "nope", level: 2, "attr.dex": 9 },
  ];
  const optionSets = [
    [],
    ["scaled"],
    ["hardened"],
    ["quick", "scaled"],
    ["hardened", "quick", "scaled"],
    ["nope"],
    ["quick", "nope"],
  ];
  const rooms: SpawnRoom[] = [
    { campaign: { peril: 1 }, characters: 0, seated: 0 },
    { campaign: { peril: 3 }, characters: 4, seated: 2 },
    { campaign: { peril: 5 }, characters: 2, seated: 2 },
    { campaign: {}, characters: 1, seated: 1 },
  ];
  const cases: unknown[] = [];
  for (let i = 0; i < 400; i++) {
    const entity = one(["creature", "creature", "creature", "character"]);
    const values = one(bodies);
    const options = one(optionSets);
    const room = one(rooms);
    const mob = rnd(4) === 0;
    const plan = planSpawn({ ruleset, entity, values, options, room, mob });
    cases.push({ entity, values, options, room, mob, ...(isRefusalLike(plan) ? plan : { plan }) });
  }
  const budgets: unknown[] = [];
  for (let i = 0; i < 150; i++) {
    const picks = Array.from({ length: rnd(5) }, () => ({ values: one(bodies), count: 1 + rnd(8), mob: rnd(3) === 0 }));
    const room = one(rooms);
    const switches = one([[], ["fortified"], ["nope"]]);
    budgets.push({ picks, room, switches, lines: budgetOf({ ruleset, picks, room, switches }) });
  }
  return { ruleset: SAMPLE_SKIRMISH, cases, budgets };
}

// The keys each op's input takes, which a spend's run may name (house decision #84); Go keeps a table of its own.
const opKeyVectors = () =>
  Object.fromEntries(
    Object.entries(PRIMITIVES).flatMap(([p, prim]) =>
      Object.keys(prim.ops).map((op) => [`${p}.${op}`, opInputKeys(p, op)]),
    ),
  );

// The `charge` helper has no op to run through, so it has a section of its own: every state, a pool or two, amounts
// either side of what the pool holds.
function chargeVectors() {
  return STATES.flatMap((s, state) =>
    [...POOL_IDS, "spent", "other"].flatMap((pool) =>
      [0, 1, 2, 3, 5, 9, 13, -1, 1.5].map((amount) => {
        const r = charge({ state: s, pool, amount });
        return { state, pool, amount, ...("delta" in r ? { delta: r.delta } : { code: r.code, message: r.message }) };
      }),
    ),
  );
}

// Every delta target shape, the condition an op applies among them (house decision #66), against every target pattern:
// which a pattern lets through, and the target as the refusal prints it.
function deltaCheckVectors() {
  const deltas: Delta[] = [
    { target: { actorId: "a", resource: "hp" }, kind: "add", value: -2 },
    { target: { actorId: "a", field: "gone" }, kind: "set", value: true },
    { target: { actorId: "a", condition: "row1" }, kind: "set", value: null },
    { target: { actorId: "a", applyCondition: "prone" }, kind: "add", value: 1 },
    { target: { turn: "round" }, kind: "set", value: 2 },
    { target: { test: "outcome" }, kind: "set", value: "success" },
    { target: { pool: "luck" }, kind: "add", value: -1 },
  ];
  const patterns: TargetPattern[][] = [
    [],
    [{ resource: "*" }],
    [{ resource: "hp" }, { field: "gone" }],
    [{ condition: "*" }],
    [{ field: "*" }, { turn: "round" }, { test: "outcome" }, { pool: "*" }],
  ];
  return deltas.flatMap((d) =>
    patterns.map((targets) => ({ deltas: [d], targets, refusal: checkDeltas({ deltas: [d], targets }) })),
  );
}

const typeScope: ExprScope = {
  attr: { record: { str: "int", dex: "int" } },
  mixed: { record: { a: "int", b: "text" } },
  empty: { record: {} },
  nested: { record: { inner: { record: { x: "int" } }, other: { record: { y: "int" } } } },
  tags: { list: "text" },
  rolls: { list: "int" },
  book: { dict: "int" },
  name: "text",
  ready: "bool",
  zero: "int",
  big: "int",
  frac: "int",
  res: { record: { hp: "int", gone: "int" } },
  skill: { record: { attr: "text", rank: "int" } },
  missing: "int",
  form: { record: { f1: "int", f2: "int", f10: "int" } },
  forms: { record: { a1: "text", a3: "text" } },
  badmix: { record: { a1: "int", a2: "text" } },
  bare: { record: { a1: "int", b: "int" } },
  twin: { record: { a1: "int", b1: "int" } },
  zeros: { record: { f01: "int", f1: "int" } },
  hug: { record: { a1234567890: "int" } },
  deep: { record: { g: { record: { v1: "int", v2: "int" } } } },
  derived: { record: { d1: "int", d2: "int" } },
};
const EXPECTS: (ExprType | undefined)[] = [undefined, undefined, "int", "bool", "text", { list: "int" }];
// prettier-ignore
const TYPED_SOURCES = [
  "attr.str", "attr", "attr[name]", "attr[\"str\"]", "attr[\"nope\"]", "attr[1]", "mixed[name]", "empty[name]", "nested[name]", "nested[name].x",
  "nested.inner.x", "tags[0]", "tags[name]", "rolls[zero]", "book.any", "book[name]", "book[1]", "book[\"k\"]", "name.x", "name[0]", "1.x", "(1).x", "ready ? 1 : 2",
  "ready ? 1 : \"x\"", "1 ? 2 : 3", "name == \"a\"", "name == 1", "tags == tags", "1 == \"a\"", "-ready", "!1", "1 + ready", "ready && 1", "1 < 2", "ready < 1", "min()", "min(1)",
  "min(rolls)", "min(tags)", "min(1,2,3)", "min(1,ready)", "floor()", "floor(1)", "floor(1,2)", "floor(1,2,3)", "ceil(ready)", "clamp(1,2)", "clamp(1,2,3)", "clamp(1,2,ready)",
  "abs()", "abs(1,2)", "abs(ready)", "mod(1)", "mod(name)", "count()", "count(tags)", "count(name)", "sum(rolls)", "sum(tags)", "sum()", "has()", "has(1)", "has(res.gone)",
  "has(nope)", "has(attr[name])", "has(1,2)", "has(rolls[0])", "contains(tags, name)", "contains(tags, 1)", "contains(rolls, 1)",
  "contains(rolls, name)", "contains(name, name)", "contains(tags)", "contains(tags, name, name)", "contains(nope, 1)", "overlap(tags, tags)", "overlap(tags, rolls)", "overlap(tags)", "overlap(name, tags)", "overlap(rolls, rolls) + 1", "attr[name] + 1", "attr.str + attr[name]", "res.hp + res.gone + res.hp", "attr.str > 1 && has(res.hp)",
  "ready ? attr.str : attr.dex", "tags[attr.str]", "constructor", "attr.constructor", "toString",
  "at(form, 1)", "at(form, attr.str)", "at(forms, 1)", "at(form, name)", "at(form, \"a\")", "at(form)", "at(form, 1, 2)", "at()", "at(1, 2)", "at(name, 1)", "at(tags, 1)",
  "at(badmix, 1)", "at(bare, 1)", "at(twin, 1)", "at(zeros, 1)", "at(hug, 1)", "at(empty, 1)", "at(nope, 1)", "at(deep.g, 1)", "at(deep, 1)", "at(derived, 1)", "at(book, 1)",
  "at(form, 1) + 1", "at(forms, 1) == \"x\"", "has(at(form, 1))", "ready ? at(form, 1) : at(form, 2)", "at(attr, 1)", "at(mixed, 1)",
];

function checkVectors(sources: readonly string[]) {
  return [...TYPED_SOURCES, ...sources.slice(0, 9000)].map((src) => {
    const expect = pick(EXPECTS);
    const r = compileExpr({ source: src, scope: typeScope, ...(expect === undefined ? {} : { expect }) });
    return {
      src,
      expect: expect ?? null,
      ...(r.ok ? { type: typeName(r.expr.type), refs: r.expr.refs } : { error: r.error }),
    };
  });
}

const MANIFESTS: unknown[] = [
  SAMPLE_D20,
  SAMPLE_HARVEST,
  SAMPLE_POOL,
  SAMPLE_NO_ORDER,
  FIXTURE_RULESET,
  FREEFORM,
  SAMPLE_SCOPED,
  SAMPLE_TIERED,
  SAMPLE_SKIRMISH,
];

function allStrings(value: unknown, out: string[]): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allStrings(v, out);
    }
  }
  return out;
}

// prettier-ignore
const MANIFEST_STRINGS = [
  "public", "party", "owner", "gm", "int", "text", "enum", "bool", "ref", "list", "actor", "item", "entity", "campaign", "derived", "base", "add", "override", "homebrew", "srd", "ranked",
  "seated", "1 +", "nope", "1", "true", "res.hp", "derived.nope", "party.characters", "ctx.dc", "derived", "res", "max", "min", "ctx.nope", "1d20", "2d6", "1d20+1", "dF", "1.2.0", "^1.0.0",
  "1.x || >=2.0.0 <3", "1 || 2", "derived.ac", "attr", "attr.str", "a.b", "res", "x".repeat(70), "x".repeat(130), "é", "😀", "coop", "compete", "win", "lose", "choose", "assign",
  "fields", "table", "pointBuy", "faces", "poolSuccesses", "sumVsTarget", "gmless", "solo",
];

/** One change somewhere inside: some break the schema, others only the rules or an expression. */
function mutate(value: unknown, strings: readonly string[], depth = 0): unknown {
  const descend = depth < 2 || rnd(4) !== 0;
  if (Array.isArray(value)) {
    const items = value as unknown[];
    if (items.length > 0 && descend) {
      const at = rnd(items.length);
      return items.map((item, i) => (i === at ? mutate(item, strings, depth + 1) : item));
    }
    if (items.length > 0 && rnd(2) === 0) return [...items, items[rnd(items.length)]];
    return rnd(2) === 0 ? [] : pick(BAD_VALUES);
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value);
    if (entries.length > 0 && descend) {
      const key = pick(entries)[0];
      if (rnd(8) === 0) return Object.fromEntries(entries.filter(([k]) => k !== key));
      return { ...value, [key]: mutate((value as Record<string, unknown>)[key], strings, depth + 1) };
    }
    return rnd(2) === 0 ? { ...value, [pick(strings)]: pick(BAD_VALUES) } : pick(BAD_VALUES);
  }
  if (typeof value === "string") return rnd(5) === 0 ? pick(BAD_VALUES) : pick(strings);
  if (typeof value === "number")
    return rnd(5) === 0 ? pick(BAD_VALUES) : pick([value + 1, value - 1, 0, -value, 1000, 2000]);
  if (typeof value === "boolean") return !value;
  return pick(BAD_VALUES);
}

const exprView = (e: CompiledExpr | null) =>
  e === null ? null : { source: e.source, ast: e.ast, type: typeName(e.type), refs: e.refs };

function compiledView(c: CompiledRuleset) {
  const mapValues = <T, U>(rec: Record<string, T>, f: (v: T) => U) =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, f(v)]));
  return {
    ruleset: c.ruleset,
    entities: mapValues(c.entities, (e) => ({
      resources: e.resources,
      scope: e.scope,
      derived: e.derived.map((d) => ({
        id: d.id,
        label: d.label,
        visibility: d.visibility,
        deps: d.deps,
        expr: exprView(d.expr),
      })),
      effects: e.effects.map((x) => ({
        conditionId: x.sourceId, // the vectors keep the old key: a condition id is still a source id
        phase: x.phase,
        mode: x.mode,
        target: x.target,
        priority: x.priority,
        value: exprView(x.value),
        when: exprView(x.when),
      })),
    })),
    resources: mapValues(c.resources, (r) => ({
      min: exprView(r.min),
      max: exprView(r.max),
      resetOn: r.resetOn.map((x) => ({ event: x.event, to: exprView(x.to) })),
      start: exprView(r.start),
    })),
    tests: mapValues(c.tests, (t) => ({
      offers: t.offers.map((o) => ({
        id: o.def.id,
        when: exprView(o.when),
        changes: o.changes.map((x) => ({ pool: x.pool, resource: x.resource, by: exprView(x.by) })),
      })),
      modifier: exprView(t.modifier),
      target: exprView(t.target),
      pool: exprView(t.pool),
      modifierVisibility: t.modifierVisibility,
      targetVisibility: t.targetVisibility,
      offerVisibility: t.offerVisibility,
    })),
    initiative:
      c.initiative === null
        ? null
        : { score: exprView(c.initiative.score), tiebreak: c.initiative.tiebreak.map(exprView) },
    scoring:
      c.scoring === null
        ? null
        : {
            score: exprView(c.scoring.score),
            tiebreaks: c.scoring.tiebreaks.map(exprView),
            endWhen: c.scoring.endWhen.map(exprView),
          },
    healthStates: c.healthStates.map((s) => ({
      id: s.id,
      label: s.label ?? null,
      when: exprView(s.when),
      entities: s.entities,
    })),
    instantDeath: mapValues(c.instantDeath, exprView),
    conditions: Object.keys(c.conditions).sort(),
    notices: c.notices.map((n) => ({
      ...n,
      if: exprView(n.if),
      params: mapValues(n.params, exprView),
      rises: exprView(n.rises),
    })),
    reminders: c.reminders.map(exprView),
    immune: mapValues(c.immune, exprView),
    lookups: mapValues(c.lookups, (l) => ({
      modifier: exprView(l.modifier),
      effects: l.effects.map((row) =>
        row.map((x) => ({
          when: exprView(x.when),
          times: exprView(x.times),
          wounds: exprView(x.wounds),
          shock: exprView(x.shock),
          by: exprView(x.by),
        })),
      ),
    })),
  };
}

const fieldInt = { label: "F", type: "int", visibility: "public" };
const pcBase = {
  id: "pc",
  label: "PC",
  base: "actor",
  fields: {
    "attr.str": fieldInt,
    "attr.dex": fieldInt,
    hp: fieldInt,
    secret: { label: "S", type: "int" },
    name: { label: "N", type: "text" },
  },
  derived: [{ id: "a", label: "A", expr: "attr.str", visibility: "public" }],
};
const MINIMAL = {
  id: "m",
  version: "1.0.0",
  core: "^1.0.0",
  sources: [{ id: "s", title: "T", license: "homebrew" }],
  entities: [pcBase],
  resources: [{ id: "hp", label: "H", scope: "entity", max: "10" }],
  initiative: { strategy: "seated", firstPlayer: "fixed" },
};
const sumTest = { kind: "sumVsTarget", target: "1", dice: "1d20" };
const poolTest = {
  kind: "poolSuccesses",
  target: "1",
  pool: "1",
  die: 6,
  bands: [{ id: "b", from: 1, to: 2, worth: 1 }],
};
const reportedTest = (ids: string[]) => ({
  kind: "reported",
  outcomes: ids.map((id) => ({ id, label: id.toUpperCase() })),
});
const withPc = (over: object) => ({ entities: [{ ...pcBase, ...over }] });
const withFields = (fields: object) => withPc({ fields: { ...pcBase.fields, ...fields } });
const withDerived = (...derived: object[]) => withPc({ derived });
const condition = (effect: object, over: object = {}) => ({
  conditions: [
    {
      id: "c",
      label: "C",
      duration: "manual",
      visibility: "public",
      effects: [{ path: "hp", mode: "add", value: "1", ...effect }],
      ...over,
    },
  ],
});
const step = (over: object) => ({ id: "st", actor: "pc", label: "L", kind: "fields", fields: ["hp"], ...over });
// Random tables (house decision #49): ranges tile the die, or weights stand without one.
const tbl = (die: string | undefined, entries: object[], over: object = {}) => ({
  title: "T",
  ...(die === undefined ? {} : { die }),
  visibility: "party",
  entries,
  ...over,
});
const span = (id: string, lo: number, hi: number, over: object = {}) => ({ id, label: id, range: [lo, hi], ...over });
const d66Rows = [1, 2, 3, 4, 5, 6].map((t) => span(`r${t}`, t * 10 + 1, t * 10 + 6));
const TABLES_OK = {
  d6: tbl("d6", [span("a", 1, 2), span("b", 3, 6)]),
  two: tbl("2d6", [span("a", 2, 6), span("b", 7, 12)], { visibility: "gm" }),
  d66: tbl("d66", d66Rows, { visibility: "owner" }),
  d100: tbl("d100", [span("a", 1, 99), span("b", 100, 100)]),
  weighted: tbl(undefined, [
    { id: "a", label: "A", weight: 3 },
    { id: "b", label: "B", count: 2 },
    { id: "c", label: "C" },
  ]),
};
MANIFESTS.push({ ...MINIMAL, tables: TABLES_OK });

// Lookups (house decision #87): inputs, a modifier over the target, an open-ended line, lines past the die, every kind
// of effect but a hit (harmManifest has no lookup; SAMPLE_HARM's is read by lookupVectors), and a line naming the next.
const LOOKUP_MANIFEST = {
  ...MINIMAL,
  resources: [
    { id: "hp", label: "H", scope: "entity", max: "10" },
    { id: "luck", label: "L", scope: "entity", max: "5" },
    { id: "dread", label: "D", scope: "party", max: "6" },
  ],
  conditions: [{ id: "slow", label: "S", duration: "manual", stacking: "stack", maxStacks: 3, immune: "attr.str > 4" }],
  tables: {
    look: tbl(
      "d66",
      [
        span("a", 11, 36, {
          apply: [
            { kind: "resource", resource: "luck", by: "ctx.on ? 2 : -1" },
            { kind: "pool", pool: "dread", by: "ctx.n" },
          ],
        }),
        span("b", 41, 56, {
          apply: [{ kind: "condition", condition: "slow", when: "ctx.on", times: "ctx.n + 1" }],
          note: "N",
          cite: "p2",
          next: "plain",
        }),
        span("c", 61, 76, { apply: [{ kind: "pool", pool: "dread", by: "attr.str" }] }),
        { id: "d", label: "D", range: [81] },
      ],
      {
        visibility: "gm",
        typedOnly: true,
        inputs: [
          { id: "on", label: "On", type: "bool" },
          { id: "n", label: "N", type: "int", min: 0, max: 3, cite: "p1" },
          // House decision #192: capped at a shared pool as it stands.
          { id: "k", label: "K", type: "int", min: 1, max: "pools.dread" },
        ],
        modifier: "ctx.n * 10 + attr.dex + ctx.k",
        entities: ["pc"],
      },
    ),
    plain: tbl("2d6", [span("x", 2, 7), span("y", 8, 12)]),
    // A die the GM types (house decision #164) and has() of a resource the target does not carry, a party pool (#166).
    more: tbl(
      "d6",
      [
        span("m", 1, 3, {
          apply: [
            { kind: "resource", resource: "luck", by: "ctx.more", when: "has(res.luck)" },
            { kind: "resource", resource: "hp", by: "-ctx.more", when: "!has(res.dread)" },
          ],
        }),
        span("n", 4, 6, { apply: [{ kind: "pool", pool: "dread", by: "has(res.hp) ? 1 : 2" }] }),
      ],
      { visibility: "gm", typedOnly: true, inputs: [{ id: "more", label: "M", type: "int", dice: "2d3" }] },
    ),
  },
};
MANIFESTS.push(LOOKUP_MANIFEST);

// Held records (house decision #88): a kind kept in a list field, granted by a lookup line.
const HELD_KIND = { label: "M", entry: "mark", field: "marks", entities: ["pc"], unseen: "U", max: 3 };
const HELD_MANIFEST = {
  ...MINIMAL,
  entities: [
    { ...pcBase, fields: { ...pcBase.fields, marks: { label: "M", type: "list", visibility: "owner" } } },
    { id: "mark", label: "M", base: "ability", fields: {} },
  ],
  held: { mark: HELD_KIND },
  tables: {
    t: tbl("d6", [span("a", 1, 6, { apply: [{ kind: "grant", held: "mark", entry: "x-1" }] })], {
      modifier: "count(marks)",
    }),
  },
};
MANIFESTS.push(HELD_MANIFEST);

// Items (house decision #95): a host kind, a fitted kind with a slot and a GM's tag, a counted kind, and GIVE.
const ITEMS_MANIFEST = {
  ...MINIMAL,
  entities: [pcBase, { id: "gear", label: "G", base: "item", fields: { slot: { label: "S", type: "text" } } }],
  codex: { kinds: { item: { fields: { of: { label: "O", type: "ref", entity: "gear" } } } } },
  items: {
    kinds: [
      { id: "tool", label: "T", entry: "gear", tag: "tool", entities: ["pc"], card: "weapons", unique: true, max: 5 },
      {
        id: "addon",
        label: "A",
        entry: "gear",
        tag: "addon",
        entities: ["pc"],
        fits: { to: ["tool"], max: 2, slot: "slot", gmTag: "pair" },
      },
      { id: "shot", label: "S", entry: "gear", tag: "shot", entities: ["pc"], stacks: true, spend: true },
      { id: "kit", label: "K", entry: "gear", entities: ["pc"], card: "gear" },
    ],
    give: { ref: "of", loose: "kit" },
  },
};
MANIFESTS.push(ITEMS_MANIFEST);

// Acquiring an item by a Test (house decision #102): a rating and a tag overlap read into the Test's two inputs, a pick,
// a guard, limits, a top-up, a counted kind's quantity and the stores an entry loads; a fitting that changes its host.
const ACQUIRE_MANIFEST = {
  ...ITEMS_MANIFEST,
  entities: [
    { ...pcBase, fields: { ...pcBase.fields, words: { label: "W", type: "list" } } },
    {
      id: "gear",
      label: "G",
      base: "item",
      fields: { slot: { label: "S", type: "text" }, rating: fieldInt, loads: { label: "L", type: "text" } },
    },
  ],
  resources: [...MINIMAL.resources, { id: "coin", label: "C", scope: "entity", max: "20" }],
  tests: {
    get: {
      ...sumTest,
      target: "ctx.dn",
      modifier: "ctx.bonus - (ctx.rare ? 1 : 0)",
      inputs: { dn: "int", bonus: "int", rare: "bool" },
      inputLabels: { dn: "Number", rare: "Rare" },
    },
  },
  items: {
    ...ITEMS_MANIFEST.items,
    acquire: {
      test: "get",
      inputs: {
        rare: [{ label: "Rated 3 up", value: "item.rating >= 3" }],
        dn: [
          { label: "Base", value: "5" },
          { label: "Rating", value: "item.rating" },
          { label: "Matched", value: "-max(0, overlap(item.tags, words) - 1)" },
        ],
        bonus: [{ label: "Push", value: "ctx.push" }],
      },
      picks: { push: { label: "P", min: -1, max: "attr.str" } },
      if: "overlap(item.tags, words) > 0",
      limits: [
        { kinds: ["tool", "kit"], max: 1 },
        { kinds: ["shot"], max: 2 },
      ],
      topUp: { resource: "coin", max: "item.rating" },
      quantity: "item.rating + 1",
      load: { field: "loads", quantity: "2" },
    },
  },
};
MANIFESTS.push(ACQUIRE_MANIFEST);

// A GM's override of a derived value (house decision #96): set, it replaces the worked-out number.
const OVERRIDE_MANIFEST = {
  ...MINIMAL,
  entities: [
    {
      ...pcBase,
      fields: { ...pcBase.fields, aSet: { label: "A", type: "int", visibility: "public" } },
      derived: [{ id: "a", label: "A", expr: "attr.str", visibility: "public", override: "aSet" }],
    },
  ],
};
MANIFESTS.push(OVERRIDE_MANIFEST);

// House decision #55: campaign fields, the `campaign` root and at().
const cInt = { type: "int", label: "D", min: 1, max: 5, default: 1, cite: "p1" };
const cEnum = { type: "enum", label: "M", values: ["calm", "tense"], default: "calm", cite: "p1" };
const cBool = { type: "bool", label: "B", default: false, cite: "p1" };
const withCampaign = (campaignFields: object) => ({ campaignFields });
const withForm = (fields: object, expr: string) =>
  withPc({ fields: { ...pcBase.fields, ...fields }, derived: [{ id: "a", label: "A", expr }] });
const intField = { label: "F", type: "int" };

// `health.harm` (house decision #66): an invented ruleset with characters that go down, creatures that never take
// shock, and mobs. Its pieces are spread so each refusal below changes one of them.
const harmEntities = [
  { ...pcBase, fields: { ...pcBase.fields, injuries: fieldInt, gone: { label: "G", type: "bool" } } },
  {
    id: "foe",
    label: "Foe",
    base: "actor",
    fields: { gone: { label: "G", type: "bool" }, tough: fieldInt },
    derived: [{ id: "edge", label: "E", expr: "tough * 2" }],
  },
  { id: "horde", label: "Horde", base: "actor", fields: { size: fieldInt } },
  { id: "gear", label: "Gear", base: "item", fields: {} },
];
const harmResources = [
  { id: "hp", label: "H", scope: "entity", max: "10" },
  { id: "wounds", label: "W", scope: "entity", max: "5", capped: false },
  { id: "shock", label: "S", scope: "entity", max: "3", capped: false },
  { id: "members", label: "M", scope: "entity", entities: ["horde"], max: "size" },
  { id: "luck", label: "L", scope: "party" },
];
const harmConditions = [
  { id: "prone", label: "P", duration: "manual" },
  { id: "tired", label: "T", duration: "manual" },
];
const harmProfiles = [
  {
    entities: ["pc"],
    spent: { when: "res.shock > 3", conditions: ["tired"] },
    felled: { when: "res.wounds > 5", injuries: "injuries", condition: "prone", healTo: "5" },
    destroyed: { over: "10", field: "gone" },
  },
  { entities: ["foe"], shockless: "tough > 2", destroyed: { over: "derived.edge", field: "gone" } },
  { entities: ["horde"] },
];
const harmBlock = {
  wounds: "wounds",
  shock: "shock",
  mob: { members: "members", start: "size" },
  profiles: harmProfiles,
};
const harmManifest = (harm: object = {}, over: object = {}) => ({
  ...MINIMAL,
  entities: harmEntities,
  resources: harmResources,
  conditions: harmConditions,
  health: { harm: { ...harmBlock, ...harm } },
  ...over,
});
const harmProfile = (i: number, over: object) => ({
  profiles: harmProfiles.map((p, j) => (j === i ? { ...p, ...over } : p)),
});

// One manifest per rule of the block, in the schema and in the semantic pass.
function harmCrafted(): object[] {
  const cited = (x: object) => ({ ...x, cite: "p1" });
  return [
    harmManifest(),
    harmManifest({ shock: undefined, mob: undefined }),
    harmManifest(
      {},
      {
        sources: [{ id: "s", title: "T", license: "srd" }],
        resources: harmResources.map(cited),
        conditions: harmConditions.map(cited),
        initiative: { strategy: "seated", firstPlayer: "fixed", cite: "p1" },
      },
    ),
    harmManifest({ wounds: "nope" }),
    harmManifest({ wounds: "luck" }),
    harmManifest({}, { health: { tracks: [{ resource: "wounds" }], harm: harmBlock } }),
    harmManifest({ shock: "wounds" }),
    harmManifest({ mob: { members: "shock", start: "size" } }),
    harmManifest({ wounds: "hp" }),
    harmManifest({}, { resources: harmResources.map((r) => (r.id === "members" ? { ...r, capped: false } : r)) }),
    harmManifest({ mob: { members: "members", start: "nope" } }),
    harmManifest({ mob: { members: "hp", start: "size" } }),
    harmManifest(harmProfile(1, { entities: ["foe", "ghost", "gear"] })),
    harmManifest(harmProfile(2, { entities: ["horde", "pc"] })),
    harmManifest(harmProfile(1, { entities: ["foe", "foe"] })),
    harmManifest(harmProfile(0, { felled: { when: "true", injuries: "gone" } })),
    harmManifest(harmProfile(0, { destroyed: { over: "1", field: "injuries" } })),
    harmManifest(harmProfile(1, { destroyed: { over: "1", field: "nope" } })),
    harmManifest(
      harmProfile(0, { spent: { conditions: ["tired", "ghost"] }, felled: { when: "true", condition: "x" } }),
    ),
    harmManifest(harmProfile(1, { shockless: "1" })),
    harmManifest(harmProfile(0, { spent: { when: "res.nope > 1" } })),
    harmManifest(harmProfile(0, { felled: { when: "res.wounds" } })),
    harmManifest(harmProfile(0, { felled: { when: "true", healTo: "true" } })),
    harmManifest(harmProfile(0, { destroyed: { over: "tough", field: "gone" } })),
    harmManifest(harmProfile(0, { destroyed: { over: "1", field: "gone", when: "tough > 1" } })),
    harmManifest(harmProfile(0, { destroyed: { over: "1", field: "gone", when: "tough" } })),
    harmManifest(harmProfile(0, { destroyed: { over: "1", field: "gone", when: "nope" } })),
    harmManifest({ profiles: [] }),
    harmManifest({ profiles: Array.from({ length: 11 }, () => ({ entities: ["pc"] })) }),
    harmManifest({ wounds: "Bad_Id" }),
    harmManifest(harmProfile(0, { entities: [] })),
    harmManifest(harmProfile(0, { felled: {} })),
    harmManifest(harmProfile(0, { spent: { conditions: Array.from({ length: 21 }, () => "tired") } })),
    harmManifest({ mob: { members: "members" } }),
    harmManifest({ profiles: undefined }),
  ];
}

// The codex block and the words of an enum (house decision #71): one valid block, then each refusal.
function codexCrafted(): object[] {
  const entities = [pcBase, { id: "foe", label: "Foe", base: "actor", fields: {} }];
  const enumDef = (over: object = {}) => ({ type: "enum", label: "M", values: ["a", "b"], ...over });
  const codex = (fields: object, kind = "npc") => ({ entities, codex: { kinds: { [kind]: { fields } } } });
  const many = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, { type: "bool", label: "F" }]));
  return [
    codex({
      mood: enumDef({ labels: { a: "A" }, notes: { b: "B" }, visibility: "party", cite: "p1" }),
      n: { type: "int", label: "N", min: -3, max: 3 },
      t: { type: "text", label: "T", maxLength: 10 },
      b: { type: "bool", label: "B" },
      boss: { type: "ref", label: "R", entity: "foe" },
    }),
    codex({}, "faction"),
    { entities, codex: { kinds: {} } },
    { entities, codex: {} },
    codex({}, "ship"),
    codex(many(20)),
    codex(many(21)),
    codex({ m: { type: "text", label: "M", visibility: "owner" } }),
    codex({ m: { type: "text", label: "M", visibility: "public" } }),
    codex({ m: { type: "text", label: "M", editableBy: "owner" } }),
    codex({ m: { type: "list", label: "M" } }),
    codex({ m: enumDef({ labels: { c: "C" }, notes: { a: "x".repeat(41) } }) }),
    codex({ m: enumDef({ labels: { a: "x".repeat(61) }, notes: { z: "Z" } }) }),
    codex({ m: enumDef({ labels: { Bad_Id: "x" } }) }),
    codex({ m: { type: "ref", label: "R", entity: "nope" } }),
    codex({ m: { type: "int", label: "N", min: 3, max: 1 } }),
    codex({ "a.b": { type: "bool", label: "B" } }),
    // House decision #76: a link to another entry, and an enum's tones.
    codex({
      home: { type: "entry", label: "H", kind: "location", visibility: "party", cite: "p1" },
      at: { type: "entry", label: "A", kind: "npc" },
    }),
    codex({ m: { type: "entry", label: "H", kind: "ship" } }),
    codex({ m: { type: "entry", label: "H" } }),
    codex({ m: { type: "entry", label: "H", kind: "npc", visibility: "owner" } }),
    codex({ m: { type: "entry", label: "H", kind: "npc", entity: "foe" } }),
    codex({ m: enumDef({ tones: { a: "good", b: "bad" } }) }),
    codex({ m: enumDef({ tones: { c: "good" } }) }),
    codex({ m: enumDef({ tones: { a: "warn" } }) }),
    ...listCrafted(),
    { entities: [{ ...pcBase, fields: { ...pcBase.fields, e: enumDef({ tones: { a: "bad", z: "good" } }) } }] },
    { entities: [{ ...pcBase, fields: { ...pcBase.fields, e: { type: "entry", label: "E", kind: "npc" } } }] },
    {
      campaignFields: {
        era: { type: "enum", label: "E", values: ["a"], default: "a", tones: { a: "good", b: "bad" }, cite: "p1" },
      },
    },
    { entities: [{ ...pcBase, fields: { ...pcBase.fields, e: enumDef({ labels: { c: "C" } }) } }] },
    {
      campaignFields: { era: { type: "enum", label: "E", values: ["a"], default: "a", notes: { b: "B" }, cite: "p1" } },
    },
  ];
}

// Tags, rows and a kind's reminders (house decision #89): one valid block, then each refusal.
function listCrafted(): object[] {
  const kin = {
    id: "kin",
    label: "Kin",
    base: "entry",
    fields: {
      bite: { type: "int", label: "B" },
      mood: { type: "enum", label: "M", values: ["a", "b"] },
      note: { type: "text", label: "N" },
      boss: { type: "ref", label: "R", entity: "kin" },
      on: { type: "bool", label: "O" },
    },
  };
  const entities = [pcBase, kin];
  const rows = (over: object = {}) => ({
    type: "rows",
    label: "R",
    columns: [
      { id: "name", label: "N", type: "text", maxLength: 80 },
      { id: "dc", label: "D", type: "int", min: 1, max: 20 },
      { id: "how", label: "H", type: "enum", values: ["a", "b", "c"], labels: { a: "A" }, tones: { c: "bad" } },
      { id: "on", label: "O", type: "bool" },
      { id: "who", label: "W", type: "ref", entity: "kin" },
      { id: "test", label: "T", type: "test" },
    ],
    from: [{ entity: "kin", name: "name", values: { dc: "bite", how: "mood", who: "boss", on: "on" } }],
    pick: { label: "Seen" },
    ...over,
  });
  const tags = (over: object = {}) => ({ type: "tags", label: "T", entities: ["kin"], writeIn: true, ...over });
  const kind = (fields: object, reminders?: object[]) => ({
    entities,
    codex: { kinds: { location: { fields, ...(reminders === undefined ? {} : { reminders }) } } },
  });
  const col = (c: object) => rows({ columns: [{ id: "name", label: "N", type: "text" }, c], from: undefined });
  const fill = (f: object) => rows({ from: [f] });
  const tier = { campaignFields: { tier: { type: "int", label: "T", min: 1, max: 4, default: 1 } } };
  const rolled = {
    tables: { haz: { title: "H", die: "d6", visibility: "gm", entries: [{ id: "a", label: "A", range: [1, 6] }] } },
  };
  const extra = (dangers: object, over: object = {}) => ({ ...kind({ dangers }), ...tier, ...rolled, ...over });
  const testCol = (c: object) => ({ id: "test", label: "T", type: "test", ...c });
  return [
    // House decision #173: a table rolled into rows per a campaign value, an enum offered from the row's entry, a
    // Test's inputs worked out and listed per word, and each refusal.
    extra(rows({ rolls: { table: "haz", into: "name", times: "tier" } })),
    // House decision #177: a Test column filled from a text or enum field, never from a number.
    fill({ entity: "kin", values: { test: "note" } }),
    fill({ entity: "kin", values: { test: "mood" } }),
    fill({ entity: "kin", values: { test: "bite" } }),
    extra(rows({ rolls: { table: "haz", into: "name" } })),
    extra(rows({ rolls: { table: "nope", into: "dc", times: "nope" } })),
    extra(rows({ rolls: { table: "haz", into: "name", times: "tier" } }), { campaignFields: undefined }),
    extra(rows({ rolls: { table: "haz", into: "Bad id" } })),
    extra(
      rows({
        columns: [
          { id: "name", label: "N", type: "text" },
          { id: "dc", label: "D", type: "int" },
          { id: "how", label: "H", type: "enum", values: ["a", "b"], offer: "mood" },
          testCol({
            inputs: { dn: "campaign.tier + values.dc", skill: 'values.how == "a" ? "x" : values.name' },
            each: "skill",
          }),
        ],
        from: [{ entity: "kin", name: "name" }],
      }),
    ),
    extra(
      rows({
        columns: [{ id: "how", label: "H", type: "enum", values: ["a"], offer: "bite" }],
        from: [{ entity: "kin" }],
      }),
    ),
    extra(
      rows({
        columns: [{ id: "how", label: "H", type: "enum", values: ["a"], offer: "nope" }],
        from: [{ entity: "kin" }],
      }),
    ),
    extra(rows({ columns: [{ id: "how", label: "H", type: "enum", values: ["a"], offer: "mood" }], from: undefined })),
    extra(rows({ columns: [testCol({ inputs: { dn: "values.nope + 1" } })], from: undefined })),
    extra(rows({ columns: [testCol({ inputs: { dn: "values.test" } })], from: undefined })),
    extra(rows({ columns: [testCol({ inputs: { dn: "campaign.tier" } })], from: undefined }), {
      campaignFields: undefined,
    }),
    extra(
      rows({ columns: [testCol({ inputs: { a: "1", b: "1", c: "1", d: "1", e: "1", f: "1" } })], from: undefined }),
    ),
    extra(rows({ columns: [testCol({ each: "Bad id" })], from: undefined })),
    kind(
      {
        dangers: rows(),
        size: { type: "int", label: "S" },
        words: tags({ options: ["x", "y"], labels: { x: "X" }, maxItems: 5, visibility: "party" }),
      },
      [
        { id: "mix", if: 'contains(fields.words, "x") && fields.size > 1', text: "Mind the mix", cite: "p1" },
        { id: "some", if: "has(fields.size)", text: "Sized" },
      ],
    ),
    kind({ words: tags({ entities: undefined, writeIn: undefined }) }),
    kind({ words: tags({ entities: undefined, options: ["x"], writeIn: false }) }),
    kind({ words: tags({ entities: ["nope", "kin"] }) }),
    kind({ words: tags({ options: ["x"], labels: { y: "Y", x: "x".repeat(61) } }) }),
    kind({ words: tags({ maxItems: 31 }) }),
    kind({ words: tags({ maxItems: 0 }) }),
    kind({ words: tags({ entities: [] }) }),
    kind({ words: tags({ options: ["Bad_Id"] }) }),
    kind({ words: tags({ writeIn: "yes" }) }),
    kind({ dangers: rows({ columns: [] }) }),
    kind({
      dangers: rows({ columns: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, label: "C", type: "bool" })) }),
    }),
    kind({
      dangers: rows({
        from: undefined,
        columns: [
          { id: "a", label: "A", type: "bool" },
          { id: "a", label: "B", type: "int" },
        ],
      }),
    }),
    kind({ dangers: col({ id: "e", label: "E", type: "entry", kind: "npc" }) }),
    kind({ dangers: col({ id: "e", label: "E", type: "tags" }) }),
    kind({ dangers: col({ id: "e", label: "E", type: "text", maxLength: 501 }) }),
    kind({ dangers: col({ id: "e", label: "E", type: "ref", entity: "nope" }) }),
    kind({ dangers: col({ id: "e", label: "E", type: "int", min: 5, max: 1 }) }),
    kind({ dangers: col({ id: "e", label: "E", type: "enum", values: ["a"], notes: { b: "B" } }) }),
    kind({ dangers: col({ id: "Bad", label: "E", type: "bool" }) }),
    kind({ dangers: col({ id: "e", label: "x".repeat(61), type: "bool" }) }),
    kind({ dangers: rows({ maxRows: 31 }) }),
    kind({ dangers: rows({ pick: { label: "" } }) }),
    kind({ dangers: rows({ pick: {} }) }),
    kind({ dangers: rows({ from: [] }) }),
    kind({ dangers: fill({ entity: "nope" }) }),
    kind({ dangers: rows({ from: [{ entity: "kin" }, { entity: "kin" }] }) }),
    kind({ dangers: fill({ entity: "kin", name: "dc" }) }),
    kind({ dangers: fill({ entity: "kin", name: "gone" }) }),
    kind({
      dangers: fill({ entity: "kin", values: { gone: "bite", dc: "nope", how: "note", name: "bite", test: "note" } }),
    }),
    kind({ dangers: fill({ entity: "kin", values: { dc: "Bad.Field" } }) }),
    kind({
      dangers: rows({
        columns: [
          { id: "how", label: "H", type: "enum", values: ["a"] },
          { id: "who", label: "W", type: "ref", entity: "pc" },
        ],
        from: [{ entity: "kin", values: { how: "mood", who: "boss" } }],
      }),
    }),
    kind({ dangers: rows(), size: { type: "int", label: "S" } }, [
      { id: "r", if: "count(fields.dangers) > 0", text: "T" },
    ]),
    kind({ size: { type: "int", label: "S" } }, [{ id: "r", if: "fields.size", text: "T" }]),
    kind({ size: { type: "int", label: "S" } }, [{ id: "r", if: "fields.nope == 1", text: "T" }]),
    kind({ size: { type: "int", label: "S" } }, [
      { id: "r", if: "true", text: "T" },
      { id: "r", if: "true", text: "U" },
    ]),
    kind({ size: { type: "int", label: "S" } }, [{ id: "r", if: "true", text: "" }]),
    kind({ size: { type: "int", label: "S" } }, [{ id: "r", if: "true", text: "x".repeat(121) }]),
    kind({ size: { type: "int", label: "S" } }, [{ id: "r", text: "T" }]),
    kind(
      { size: { type: "int", label: "S" } },
      Array.from({ length: 21 }, (_, i) => ({ id: `r${i}`, if: "true", text: "T" })),
    ),
    kind({ words: tags() }, [{ id: "r", if: "contains(fields.words, 1)", text: "T" }]),
  ];
}

// `initiative.sides` (house decision #57): one valid block, then each refusal of the schema and of the semantic pass.
function sidesCrafted(): object[] {
  const two = sideList(2);
  const pool = (id: string, scope: string, over: object = {}) => ({ id, label: id, scope, ...over });
  const resources = [pool("hp", "entity", { max: "10" }), pool("gold", "party"), pool("tin", "gm")];
  const cost = (side: string, id: string, amount = 1) => ({ [side]: { pool: id, amount } });
  const block = (over: object = {}) => ({ initiative: { strategy: "sides", sides: two, ...over }, resources });
  const withKinds = (r: object) => ({
    ...r,
    entities: [pcBase, { ...pcBase, id: "gear", base: "item" }],
    health: { states: [{ id: "hurt", when: "true" }] },
  });
  const cited = { sources: [{ id: "s", title: "T", license: "srd" }] };
  const citedPools = resources.map((r) => ({ ...r, cite: "p1" }));
  const bare = (over: object) => ({
    ...cited,
    resources: citedPools,
    initiative: { strategy: "sides", sides: two, ...over },
  });
  return [
    block(),
    block({
      firstSide: "rotate",
      roundEnd: "manual",
      setup: {},
      outOfTurn: { cost: { ...cost("red", "gold"), ...cost("blue", "tin", 20) } },
      hold: {},
      barred: { throughRound: 10, liftCost: cost("blue", "tin", 2) },
    }),
    block({ sides: [two[0], two[0]] }),
    block({ sides: [two[0], two[1], two[0], two[1]] }),
    block({ sides: [two[0]] }),
    block({ sides: sideList(4).concat([{ id: "fifth", label: "F" }]) }),
    block({ sides: [{ id: "Bad_Id", label: "B" }, two[1]] }),
    block({ sides: [{ id: "red", label: "" }, two[1]] }),
    // Entities on a side and the states that leave a member unable (the ruleset below declares "pc", "gear" and "hurt").
    withKinds(block({ sides: [{ ...two[0], entities: ["pc"] }, two[1]], unableStates: ["hurt"] })),
    withKinds(
      block({
        sides: [
          { ...two[0], entities: ["pc"] },
          { ...two[1], entities: ["gear"] },
        ],
      }),
    ),
    withKinds(
      block({
        sides: [
          { ...two[0], entities: ["pc"] },
          { ...two[1], entities: ["pc"] },
        ],
      }),
    ),
    withKinds(block({ sides: [{ ...two[0], entities: ["pc", "pc"] }, two[1]] })),
    withKinds(block({ sides: [{ ...two[0], entities: ["nope"] }, two[1]] })),
    withKinds(block({ sides: [{ ...two[0], entities: [] }, two[1]], unableStates: [] })),
    withKinds(block({ sides: [{ ...two[0], entities: "pc" }, two[1]] })),
    withKinds(block({ unableStates: ["nope"] })),
    withKinds(block({ unableStates: ["hurt", "hurt", "nope"] })),
    withKinds(block({ unableStates: "hurt" })),
    withKinds(block({ unableStates: ["Bad_Id"] })),
    block({ firstSide: "manual" }),
    block({ roundEnd: "never" }),
    block({ outOfTurn: { cost: cost("green", "gold") } }),
    block({ outOfTurn: { cost: { ...cost("green", "gold"), ...cost("amber", "tin") } } }),
    block({ barred: { liftCost: cost("green", "gold") } }),
    block({ outOfTurn: { cost: cost("red", "nope") } }),
    block({ outOfTurn: { cost: cost("red", "hp") } }),
    block({ barred: { liftCost: cost("red", "hp") } }),
    block({ barred: { liftCost: { ...cost("red", "nope"), ...cost("green", "hp") } } }),
    block({ outOfTurn: { cost: cost("red", "gold", 0) } }),
    block({ outOfTurn: { cost: cost("red", "gold", 21) } }),
    block({ outOfTurn: { cost: cost("red", "gold", 1.5) } }),
    block({ outOfTurn: { cost: { Bad_Id: { pool: "gold", amount: 1 } } } }),
    block({ outOfTurn: {} }),
    block({ barred: { throughRound: 0 } }),
    block({ barred: { throughRound: 11 } }),
    block({ barred: { throughRound: 2.5 } }),
    block({ barred: { liftCost: "x" } }),
    block({ setup: "x" }),
    block({ hold: [] }),
    {
      ...block(),
      resources: [pool("gold", "entity"), pool("gold", "party"), pool("tin", "gm"), pool("hp", "entity")],
      initiative: { strategy: "sides", sides: two, outOfTurn: { cost: cost("red", "gold") } },
    },
    {
      ...block(),
      resources: [pool("gold", "party"), pool("gold", "entity"), pool("tin", "gm"), pool("hp", "entity")],
      initiative: { strategy: "sides", sides: two, outOfTurn: { cost: cost("red", "gold") } },
    },
    { ...block(), phases: [{ id: "a", label: "A", mode: "turns" }] },
    { ...block({ sides: [two[0], two[0]] }), phases: [{ id: "a", label: "A", mode: "simultaneous" }] },
    { ...block(), phases: [] },
    bare({}),
    bare({ cite: "p1" }),
    bare({ cite: "p1", setup: {}, hold: {}, barred: {}, outOfTurn: { cost: cost("red", "gold") } }),
    bare({
      cite: "p1",
      setup: { cite: "p2" },
      hold: { cite: "p2" },
      barred: { cite: "p2" },
      outOfTurn: { cost: cost("red", "gold"), cite: "p2" },
    }),
  ];
}

// Layout rows that name a widget (house decision #83), each check once, on the sheet and the other targets.
const rows = (...show: unknown[]) => ({ layout: { pc: { sections: [{ id: "s", label: "S", show }] } } });
const WIDGET_CRAFTED: object[] = [
  rows(
    "attr.str",
    { widget: "strip", label: "Who", bind: { title: "name", values: ["name", "a", "res.hp"] } },
    { widget: "grid", bind: { ratings: ["attr.str", "attr.dex"], bonus: ["a", "hp"], total: ["derived.a", "res.hp"] } },
    { widget: "grid", variant: "pairs", bind: { ratings: ["attr.str"], link: ["name"], total: ["a"] } },
    { widget: "frames", bind: { values: ["a", "hp"] } },
    { widget: "sum", bind: { parts: ["attr.str", "attr.dex"], total: "a" } },
    { widget: "track", bind: { value: "res.hp", max: "a" } },
    {
      widget: "pips",
      bind: { value: "hp" },
      steps: [
        { label: "One", size: 3 },
        { label: "Two", size: 5 },
      ],
    },
    { widget: "notes", bind: { fields: ["name"] } },
  ),
  rows({ widget: "nope", bind: {} }),
  rows({ widget: "grid", variant: "rows", bind: { ratings: ["hp"], link: ["name"] } }),
  rows({ widget: "grid", bind: { ratings: ["hp"], link: ["name"], extra: ["hp"] } }),
  rows({ widget: "grid" }, { widget: "sum", bind: { parts: ["hp"] } }),
  rows({ widget: "strip", bind: { values: "name", title: ["name"] } }),
  rows({ widget: "frames", bind: { values: ["nope", "name", "derived.hp", "res.a", "res.nope", "secret"] } }),
  rows({ widget: "notes", bind: { fields: ["hp", "a", "name"] } }),
  rows({ widget: "grid", bind: { ratings: ["hp", "a"], total: ["a"], bonus: ["a", "a", "a"] } }),
  rows(
    { widget: "pips", bind: { value: "hp" } },
    { widget: "track", bind: { value: "hp" }, steps: [{ label: "A", size: 1 }] },
  ),
  rows({ widget: "pips", bind: { value: "hp" }, steps: [{ label: "", size: 0 }] }),
  rows({ widget: "cards", variant: "weapons" }, { widget: "folds" }),
  rows({ wodget: "strip" }),
  rows({ widget: "grid", bind: { ratings: 3 } }),
  rows({ widget: "grid", bind: { ratings: [] } }),
  rows({ widget: "Bad", bind: { "Bad-Slot": "x" } }),
  rows(42),
  { layout: { sheet: { sections: [], phoneTurn: [{ widget: "track", bind: { value: "res.hp" } }], screen: ["x"] } } },
  { layout: { pc: { sections: [], trackerRow: [{ widget: "frames", bind: { values: ["nope"] } }] } } },
  {
    layout: { nobody: { sections: [{ id: "s", label: "S", show: [{ widget: "frames", bind: { values: ["hp"] } }] }] } },
  },
  { layout: { pc: { sections: [], screen: "x" } } },
];

const CRAFTED: object[] = [
  ...WIDGET_CRAFTED,
  // result and build are roots of a Test's offers and a notice's scope: a field may not take either (#227).
  withFields({ result: { type: "int", label: "R", visibility: "gm" } }),
  withFields({ "build.x": { type: "int", label: "B" } }),
  // An entity id declared twice: both engines check a creation step against the first definition.
  { entities: [pcBase, { ...pcBase, base: "item" }], creation: [step({})] },
  { entities: [{ ...pcBase, base: "item" }, pcBase], creation: [step({})] },
  {
    ...withCampaign({ danger: cInt, mood: cEnum, on: cBool }),
    ...withDerived({
      id: "a",
      label: "A",
      expr: 'campaign.danger + (campaign.on ? 1 : 0) + (campaign.mood == "calm" ? 1 : 2)',
    }),
  },
  withCampaign({ danger: { ...cInt, default: 6 } }),
  withCampaign({ danger: { ...cInt, default: 0 } }),
  withCampaign({ mood: { ...cEnum, default: "wild" } }),
  withCampaign({ danger: { ...cInt, min: 6, max: 2 } }),
  withCampaign({ danger: { ...cInt, min: 6, max: 2, default: 9 } }),
  withCampaign({ mood: { ...cEnum, values: ["calm", "calm", "tense"] } }),
  withCampaign({ max: cInt }),
  withCampaign({ min: cInt, true: cBool, false: cBool }),
  withCampaign({ danger: { ...cInt, cite: undefined } }),
  {
    sources: [{ id: "s", title: "T", license: "srd" }],
    resources: [],
    initiative: undefined,
    ...withCampaign({ danger: { ...cInt, cite: undefined }, mood: cEnum }),
  },
  withCampaign({ "a.b": cInt }),
  withCampaign({ danger: { ...cInt, min: 1.5 } }),
  withCampaign({ danger: { ...cInt, min: -1001 } }),
  withCampaign({ danger: { ...cInt, max: 1001, default: 1001 } }),
  withCampaign({ danger: { ...cInt, label: "" } }),
  withCampaign({ danger: { type: "text", label: "T", default: "a" } }),
  withCampaign({ mood: { ...cEnum, values: [] } }),
  withCampaign({ mood: { ...cEnum, values: Array.from({ length: 21 }, (_, i) => `v${i}`), default: "v0" } }),
  withCampaign({ mood: { ...cEnum, default: "no way" } }),
  withCampaign({ on: { ...cBool, default: "yes" } }),
  withCampaign({}),
  withCampaign(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${i}`, cInt]))),
  withCampaign(Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}`, cInt]))),
  withFields({ "campaign.x": fieldInt }),
  withFields({ campaign: fieldInt }),
  withDerived({ id: "a", label: "A", expr: "campaign.danger" }),
  {
    ...withCampaign({ danger: cInt }),
    ...withDerived({ id: "a", label: "A", expr: "campaign.danger", visibility: "public" }),
  },
  { ...withCampaign({ danger: cInt }), ...withDerived({ id: "a", label: "A", expr: "campaign.nope" }) },
  { ...withCampaign({ danger: cInt }), ...withDerived({ id: "a", label: "A", expr: "campaign.mood + 1" }) },
  { ...withCampaign({ mood: cEnum }), ...withDerived({ id: "a", label: "A", expr: "campaign.mood" }) },
  {
    ...withCampaign({ danger: cInt }),
    resources: [{ id: "pool", label: "P", scope: "party", max: "campaign.danger * 2" }],
  },
  { ...withCampaign({ danger: cInt }), tests: { t: { ...sumTest, target: "10 + campaign.danger" } } },
  { tests: { t: { ...sumTest, target: "campaign.danger" } } },
  withForm({ "form.f1": intField, "form.f2": intField, "form.f10": intField }, "at(form, 2)"),
  withForm({ "form.f1": intField, "form.f2": intField }, "at(form, hp)"),
  withForm({ "form.f1": intField, "form.f2": { label: "N", type: "text" } }, "at(form, 1)"),
  withForm({ "form.f1": intField, "form.x": intField }, "at(form, 1)"),
  withForm({ "form.f1": intField, "form.g1": intField }, "at(form, 1)"),
  withForm({ "form.f1": intField, "form.f01": intField }, "at(form, 1)"),
  withForm({ "form.a1234567890": intField }, "at(form, 1)"),
  withForm({ "form.f1": intField }, "at(form)"),
  withForm({ "form.f1": intField }, "at(hp, 1)"),
  withForm({ "form.f1": intField }, 'at(form, "1")'),
  withForm({ "form.f1": intField, "form.f2": intField }, "at(form, 1) + at(form, 2)"),
  { ...withForm({ "form.f1": intField, "form.f2": intField }, "at(form, 1)"), ...withCampaign({ danger: cInt }) },
  {
    entities: [
      {
        ...pcBase,
        fields: { ...pcBase.fields, "form.f1": { ...intField, visibility: "owner" }, "form.f2": intField },
        derived: [{ id: "a", label: "A", expr: "at(form, 1)", visibility: "party" }],
      },
    ],
  },
  withPc({
    derived: [
      { id: "d1", label: "D", expr: "1" },
      { id: "a", label: "A", expr: "at(derived, 1)" },
    ],
  }),
  { tables: TABLES_OK },
  // House decision #50: a Test and a health state may name the actor types they apply to.
  { tests: { t: { ...sumTest, entities: ["pc"] } }, health: { states: [{ id: "s", when: "true", entities: ["pc"] }] } },
  { tests: { t: { ...sumTest, entities: ["nope"] } } },
  { tests: { t: { ...sumTest, entities: [] } } },
  { entities: [pcBase, { id: "gear", label: "G", base: "item" }], tests: { t: { ...sumTest, entities: ["gear"] } } },
  { health: { states: [{ id: "s", when: "true", entities: ["pc", "nope"] }] } },
  { tables: { t: tbl("d6", [span("a", 1, 2), span("b", 4, 6)]) } },
  { tables: { t: tbl("d6", [span("a", 1, 4), span("b", 4, 6)]) } },
  { tables: { t: tbl("d6", [span("a", 0, 3), span("b", 4, 7)]) } },
  { tables: { t: tbl("d6", [span("a", 6, 1)]) } },
  { tables: { t: tbl("d6", [{ id: "a", label: "A" }]) } },
  { tables: { t: tbl("d6", [span("a", 1, 6, { weight: 2 })]) } },
  { tables: { t: tbl(undefined, [span("a", 1, 2)]) } },
  {
    tables: {
      t: tbl(undefined, [
        { id: "a", label: "A" },
        { id: "a", label: "B" },
      ]),
    },
  },
  { tables: { t: tbl("d66", d66Rows.slice(0, 5)) } },
  {
    tables: {
      t: tbl(
        "d66",
        d66Rows.map((r, i) => (i === 5 ? span("r6", 61, 70) : r)),
      ),
    },
  },
  { tables: { t: tbl("d66", [span("a", 11, 66)]) } },
  { tables: { t: tbl("2d66", [span("a", 1, 2)]) } },
  { tables: { t: tbl("d6!", [span("a", 1, 6)]) } },
  { tables: { t: tbl("d6+1", [span("a", 2, 7)]) } },
  { tables: { t: tbl("dF", [span("a", -1, 1)]) } },
  { tables: { t: tbl("100d1000", [span("a", 100, 100000)]) } },
  { tables: { t: tbl("d6", [span("a", 1, 6, { range: [1] })]) } },
  { tables: { t: tbl("d6", [span("a", 1, 6, { range: [1, 2, 3] })]) } },
  { tables: { t: tbl("d6", [span("a", 1.5, 6)]) } },
  { tables: { t: tbl(undefined, [{ id: "a", label: "A", weight: 0 }]) } },
  { tables: { t: tbl(undefined, [{ id: "a", label: "A", weight: 101 }]) } },
  { tables: { t: tbl(undefined, [{ id: "a", label: "A", count: 21 }]) } },
  { tables: { t: tbl(undefined, []) } },
  { tables: { t: tbl(undefined, [{ id: "a", label: "A" }], { visibility: "public" }) } },
  { tables: { t: tbl(undefined, [{ id: "a", label: "A" }], { cite: "x".repeat(41) }) } },
  { tables: { Bad: tbl(undefined, [{ id: "a", label: "A" }]) } },
  { sources: [{ id: "s", title: "T", license: "srd" }], tables: { t: tbl(undefined, [{ id: "a", label: "A" }]) } },
  {
    sources: [{ id: "s", title: "T", license: "srd" }],
    tables: { t: tbl(undefined, [{ id: "a", label: "A" }], { cite: "p.1" }) },
  },
  {},
  { sources: [{ id: "s", title: "T", license: "srd" }] },
  {
    sources: [{ id: "s", title: "T", license: "srd" }],
    options: [{ id: "o", label: "O" }],
    ...condition({}),
    tests: { t: sumTest },
    phases: [{ id: "p", label: "P", mode: "turns" }],
    creation: [step({})],
  },
  {
    sources: [{ id: "s", title: "T", license: "srd" }],
    resources: [{ id: "hp", label: "H", scope: "entity", cite: "p1" }],
    initiative: { strategy: "seated", firstPlayer: "fixed", cite: "p1" },
    health: { tracks: [{ resource: "hp" }] },
    scoring: { score: "1", endWhen: [{ when: "true" }] },
  },
  { extends: { id: "m", version: "1.0.0" } },
  {
    sources: [
      { id: "s", title: "T", license: "srd" },
      { id: "s", title: "U", license: "homebrew" },
    ],
  },
  { entities: [pcBase, pcBase] },
  {
    resources: [
      { id: "hp", label: "H", scope: "entity" },
      { id: "hp", label: "I", scope: "party" },
    ],
  },
  { resources: [{ id: "hp", label: "H", scope: "party", entities: ["pc"] }] },
  { resources: [{ id: "hp", label: "H", scope: "entity", entities: ["nope"] }] },
  { resources: [{ id: "hp", label: "H", scope: "entity", entities: [] }] },
  {
    resources: [
      {
        id: "g",
        label: "G",
        scope: "gm",
        max: "party.characters",
        resetOn: [
          { event: "longRest", to: "max" },
          { event: "shortRest", to: "min + 1" },
          { event: "longRest", to: "nope" },
        ],
      },
    ],
  },
  {
    resources: [
      {
        id: "g",
        label: "G",
        scope: "entity",
        min: "res.hp",
        max: "attr.str",
        resetOn: [{ event: "longRest", to: "max + min" }],
      },
    ],
  },
  { resources: [{ id: "g", label: "G", scope: "entity", resetOn: [{ event: "longRest", to: "max" }] }] },
  { resources: [{ id: "g", label: "G", scope: "entity", max: "5", start: "min" }] },
  { resources: [{ id: "g", label: "G", scope: "entity", start: "nope" }] },
  {
    phases: [
      { id: "p", label: "P", mode: "turns" },
      { id: "p", label: "Q", mode: "simultaneous" },
    ],
  },
  {
    options: [
      { id: "o", label: "O" },
      { id: "o", label: "O" },
    ],
    decisions: [
      { id: "d", text: "T" },
      { id: "d", text: "U" },
    ],
  },
  { creation: [step({}), step({})] },
  {
    terms: { "Bad-Id": "x", ok: "y" },
    layout: { a: { sections: [{ id: "s", label: "L", show: ["x".repeat(131)] }] } },
  },
  withFields({ derived: fieldInt }),
  withFields({
    "res.x": fieldInt,
    "max.y": fieldInt,
    true: fieldInt,
    "ctx.z": fieldInt,
    min: fieldInt,
    party: fieldInt,
    "false.a": fieldInt,
  }),
  withFields({ attr: fieldInt }),
  withFields({ "attr.str.deep": fieldInt }),
  withFields({ r: { label: "R", type: "ref", entity: "nope" } }),
  withFields({
    r: { label: "R", type: "ref", entity: "pc" },
    l: { label: "L", type: "list", maxItems: 3 },
    e: { label: "E", type: "enum", values: ["a"] },
    b: { label: "B", type: "bool" },
  }),
  withFields({ n: { label: "N", type: "int", min: 5, max: 1 } }),
  withFields({ e: { label: "E", type: "enum", values: [] }, u: { label: "U", type: "nope" }, v: { type: "int" } }),
  withPc({ fields: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`f${i}`, fieldInt])) }),
  withDerived({ id: "a", label: "A", expr: "derived.b" }, { id: "b", label: "B", expr: "derived.a" }),
  withDerived({ id: "a", label: "A", expr: "derived.a" }),
  withDerived(
    { id: "a", label: "A", expr: "derived.b + 1" },
    { id: "b", label: "B", expr: "derived.c" },
    { id: "c", label: "C", expr: "1" },
  ),
  withDerived({ id: "a", label: "A", expr: "derived[name]" }, { id: "b", label: "B", expr: "1" }),
  withDerived({ id: "a", label: "A", expr: "secret", visibility: "public" }),
  withDerived(
    { id: "a", label: "A", expr: "secret", visibility: "gm" },
    { id: "b", label: "B", expr: "derived.a", visibility: "party" },
  ),
  withDerived({ id: "a", label: "A", expr: "res.hp + party.characters", visibility: "public" }),
  withDerived(
    { id: "a", label: "A", expr: "party.characters", visibility: "public" },
    { id: "b", label: "B", expr: "attr[name] + derived.a", visibility: "owner" },
  ),
  withDerived({ id: "a", label: "A", expr: "name" }, { id: "b", label: "B", expr: "nope" }),
  withDerived({ id: "a", label: "A", expr: "1" }, { id: "a", label: "B", expr: "2" }),
  { entities: [{ id: "it", label: "I", base: "item" }] },
  { entities: [{ id: "it", label: "I", base: "item", derived: [{ id: "x", label: "X", expr: "nope" }] }, pcBase] },
  {
    entities: [{ id: "bad", label: "B", base: "actor", derived: [{ id: "x", label: "X", expr: "nope" }] }, pcBase],
    ...condition({ path: "derived.x", phase: "derived" }),
  },
  condition({}),
  condition({ path: "secret" }),
  condition({ path: "hp", value: "secret" }),
  condition({ path: "hp", when: "true" }),
  condition({ path: "hp", when: "1" }),
  condition({ path: "hp", value: "derived.a" }),
  condition({ path: "hp" }, { visibility: "gm" }),
  condition({ path: "nope" }),
  condition({ path: "name" }),
  condition({ path: "a", phase: "derived" }),
  condition({ path: "derived.a", phase: "derived", value: "derived.a + 1", priority: 2 }),
  condition({ path: "derived.nope", phase: "derived" }),
  condition({ path: "derived.a", phase: "derived", value: "secret" }),
  {
    conditions: [
      {
        id: "z",
        label: "Z",
        duration: "manual",
        visibility: "public",
        effects: [
          { path: "hp", mode: "add", value: "1", priority: 1 },
          { path: "hp", mode: "add", value: "2", priority: 1 },
        ],
      },
      {
        id: "m",
        label: "E",
        duration: "manual",
        visibility: "public",
        effects: [{ path: "hp", mode: "multiply", value: "2" }],
      },
      {
        id: "a",
        label: "A",
        duration: "manual",
        visibility: "public",
        effects: [
          { path: "hp", mode: "override", value: "3", priority: 1 },
          { path: "hp", mode: "add", value: "4", priority: -1 },
        ],
      },
    ],
  },
  {
    tests: {
      t: {
        ...sumTest,
        inputs: { dc: "int", on: "bool", kind: "text" },
        target: "ctx.dc",
        modifier: "attr[ctx.kind]",
        inputOptions: { kind: ["a"], dc: ["b"], nope: ["c"] },
      },
    },
  },
  { tests: { t: { ...sumTest, target: "secret", modifier: "attr.str + derived.a" } } },
  { tests: { t: { ...sumTest, target: "true" } } },
  { tests: { t: { ...sumTest, modifier: "nope" } } },
  { tests: { t: { ...sumTest, dice: "1d20+1" } } },
  { tests: { t: { ...sumTest, dice: "2d6", advantage: true, critOn: [12, 13] } } },
  { tests: { t: { ...sumTest, dice: "nope" } } },
  { tests: { a: { ...sumTest, cite: "c" }, z: sumTest, b: { ...sumTest, dice: "x" }, "9": sumTest } },
  { tests: { t: { ...poolTest, modifier: "attr.str", pool: "secret" } } },
  { tests: { t: { ...poolTest, pool: "name" } } },
  {
    tests: {
      t: {
        ...poolTest,
        die: 1,
        shift: "nope",
        bands: [
          { id: "b", from: 5, to: 2, worth: 1 },
          { id: "b", from: 1, to: 9, worth: 1 },
          { id: "c", from: 1, to: 1, worth: 11 },
        ],
      },
    },
  },
  {
    tests: {
      t: {
        ...poolTest,
        shift: "b",
        special: { label: "L", count: 1, flags: { critical: { from: 9, to: 1 }, complication: { from: 1, to: 1 } } },
      },
    },
  },
  {
    tests: {
      t: {
        ...poolTest,
        special: { label: "L", count: 1, flags: { nope: { from: 1, to: 1 }, other: { from: 1, to: 1 } } },
      },
    },
  },
  { tests: { t: { ...poolTest, special: { label: "L", count: 1, flags: { critical: "x" } } } } },
  { tests: { t: { ...poolTest, bands: [] } } },
  { tests: { t: reportedTest(["a", "b"]) } },
  { tests: { t: { ...reportedTest(["a", "b", "c"]), inputs: { who: "text" }, inputOptions: { who: ["x"] } } } },
  { tests: { t: { ...sumTest, degrees: { step: 5, naturalShift: true, cite: "p.1" } } } },
  { tests: { t: { ...sumTest, degrees: { step: 5 } } } },
  { tests: { t: { ...sumTest, degrees: { step: 0 } } } },
  { tests: { t: { ...sumTest, degrees: { step: 21, cite: 3 } } } },
  { tests: { t: { ...sumTest, critOn: [20], degrees: { step: 2 } } } },
  { tests: { t: { ...sumTest, dice: "2d6", degrees: { step: 2, naturalShift: true } } } },
  {
    sources: [{ id: "s", title: "T", license: "private" }],
    tests: { t: { ...sumTest, cite: "p.1", degrees: { step: 2 } } },
  },
  { tests: { t: reportedTest(["a"]) } },
  { tests: { t: reportedTest(["a", "b", "c", "d", "e", "f", "g", "h", "i"]) } },
  { tests: { t: reportedTest(["a", "b", "a"]) } },
  { tests: { t: { ...reportedTest(["a", "b"]), inputOptions: { who: ["x"] } } } },
  // A Test's words (house decision #77): named inputs and declared options only, and each word 1 to 60 (80 the label).
  {
    tests: {
      t: {
        ...sumTest,
        inputs: { dc: "int", kind: "text" },
        inputOptions: { kind: ["a", "b"] },
        label: "The test",
        inputLabels: { dc: "DC", nope: "N" },
        inputOptionLabels: { kind: { a: "A", z: "Z" }, dc: { "1": "One" }, gone: { a: "A" } },
      },
    },
  },
  {
    tests: {
      t: {
        ...reportedTest(["a", "b"]),
        inputs: { who: "text" },
        inputOptions: { who: ["x"] },
        label: "",
        inputLabels: { who: "x".repeat(61) },
        inputOptionLabels: { who: { x: "" } },
      },
    },
  },
  {
    tests: {
      t: {
        ...reportedTest(["a", "b"]),
        inputs: { who: "text" },
        inputOptions: { who: ["x"] },
        label: "Who",
        inputLabels: { who: "Who" },
        inputOptionLabels: { who: { x: "Ex" } },
      },
    },
  },
  {
    sources: [{ id: "s", title: "T", license: "private" }],
    tests: { t: { ...reportedTest(["a", "b"]), cite: "p.1" } },
  },
  {
    initiative: {
      strategy: "ranked",
      score: "attr.str",
      tiebreak: ["attr.dex", "nope", "1"],
      dice: "1d20",
      rerollEachRound: true,
    },
  },
  { initiative: { strategy: "ranked", score: "nope" } },
  { initiative: { strategy: "ranked", score: "1", dice: "xx" } },
  { initiative: { strategy: "nope" } },
  {
    scoring: {
      score: "attr.str",
      tiebreaks: [
        { expr: "attr.dex", order: "low" },
        { expr: "nope", order: "high" },
      ],
      endWhen: [{ when: "round > 3" }, { when: "attr.str" }],
    },
  },
  { scoring: { score: "1", endWhen: [{ when: "true", outcome: "win" }] } },
  { scoring: { score: "nope" } },
  { scoring: { mode: "coop", score: "1", endWhen: [{ when: "true" }, { when: "true", outcome: "lose" }] } },
  {
    scoring: {
      mode: "coop",
      score: "1",
      endWhen: [
        { when: "true", outcome: "win" },
        { when: "round > 1", outcome: "lose" },
      ],
    },
  },
  { health: { tracks: [{ resource: "nope", temp: "nada" }] } },
  { resources: [{ id: "hp", label: "H", scope: "party" }], health: { tracks: [{ resource: "hp", temp: "hp" }] } },
  {
    health: {
      tracks: [
        { resource: "hp", deathSaves: { successes: 1, failures: 1 } },
        { resource: "hp", deathSaves: { successes: 21, failures: 0 } },
      ],
    },
  },
  {
    health: {
      tracks: [
        { resource: "hp", instantDeathOverflow: "attr.str" },
        { resource: "hp", instantDeathOverflow: "nope" },
      ],
      states: [
        { id: "low", when: "res.hp < 1" },
        { id: "x", when: "1" },
        { id: "y", label: "Y", when: "true" },
      ],
    },
  },
  { creation: [step({ actor: "nope" })] },
  { creation: [step({ fields: ["nope"] })] },
  { creation: [step({ fields: ["hp", "hp"] }), step({ id: "s2", fields: ["hp"] })] },
  { creation: [step({ kind: "assign", fields: ["name"], method: { kind: "table", values: [1, 2] } })] },
  {
    creation: [
      step({ kind: "assign", fields: ["hp"], method: { kind: "pointBuy", budget: 1, min: 3, max: 1, costs: {} } }),
    ],
  },
  {
    creation: [
      step({
        kind: "assign",
        fields: ["hp"],
        method: { kind: "pointBuy", budget: 1, min: -1, max: 1, costs: { "-1": 1, "0": 1 } },
      }),
    ],
  },
  {
    creation: [
      step({
        kind: "assign",
        fields: ["hp"],
        method: { kind: "pointBuy", budget: 1, min: -1, max: 1, costs: { "-1": 1, "0": 1, "1": 2, x: 1 } },
      }),
    ],
  },
  { creation: [step({ kind: "choose", pick: "nope", copy: [{ from: "a", to: "hp" }] })] },
  {
    creation: [
      step({
        kind: "choose",
        pick: "pc",
        count: 2,
        copy: [
          { from: "hp", to: "name" },
          { from: "nope", to: "gone" },
        ],
      }),
    ],
  },
  {
    creation: [
      step({ kind: "choose", pick: "pc", copy: [{ from: "hp", to: "hp" }] }),
      step({ id: "s2", fields: ["hp"] }),
    ],
  },
  { ...withDerived({ id: "a", label: "A", expr: "hp + secret", visibility: "gm" }), creation: [step({})] },
  {
    ...withDerived({ id: "a", label: "A", expr: "has(secret) ? 1 : 2", visibility: "gm" }),
    creation: [step({ fields: ["secret"] }), step({ id: "s2", actor: "pc", fields: ["hp"] })],
  },
  { version: "1.2", core: "not a range" },
  { version: "1.2.3-rc.1", core: " >=1.0.0  <2 || 3.x " },
  { core: "1.x || 2" },
  { id: "Bad_Id", sources: [] },
  { sources: "" },
  { conditions: "x".repeat(501) },
  { tests: { t: { ...poolTest, special: { label: "L", count: 1, flags: { nope: { from: 1, to: 1 } } } } } },
  withDerived(
    { id: "a", label: "A", expr: "1" },
    { id: "b", label: "B", expr: "2" },
    { id: "c", label: "C", expr: "3" },
    { id: "d", label: "D", expr: "derived.c + derived.a" },
  ),
  ...sidesCrafted(),
  ...harmCrafted(),
  ...codexCrafted(),
  ...noticesCrafted(),
  ...offersCrafted(),
  ...reminderCrafted(),
  ...spendCrafted(),
  ...strikeCrafted(),
  ...panelCrafted(),
  ...headerCrafted(),
  ...lookupCrafted(),
  ...heldCrafted(),
  ...checklistCrafted(),
  ...summaryCrafted(),
  // House decision #145: the suggested lines to leave out, valid and each refusal.
  ...[
    { lines: ["Spiders", "x".repeat(80)], cite: "p.2" },
    { lines: [], cite: "p.2" },
    { lines: [""], cite: "p.2" },
    { lines: ["x".repeat(81)], cite: "p.2" },
    { lines: Array.from({ length: 31 }, (_, i) => `Line ${i}`), cite: "p.2" },
    { lines: ["Spiders"], cite: "" },
  ].map((safetyExamples) => ({ safetyExamples })),
  { safetyExamples: { lines: ["Spiders"] }, sources: [{ id: "s", title: "T", license: "private" }] },
  // House decision #92: spawn blocks the schema, the semantic pass or the compiler refuses.
  ...[
    {
      options: [
        { id: "x", label: "X", cite: "p.1", entities: ["gear"], when: "level" },
        { id: "x", label: "X", cite: "p.1", effects: [{ path: "nope", mode: "add", value: "1" }] },
      ],
      adjust: [{ option: "y", add: { name: "1", level: "true" }, cite: "p.1" }],
      budget: { lines: [{ id: "a", label: "A", cost: "ctx.nope", budget: "level" }] },
    },
    {
      options: [
        { id: "x", label: "X", cite: "p.1", when: "level", effects: [{ path: "nope", mode: "add", value: "1" }] },
      ],
      adjust: [{ add: { level: "ctx.count" }, cite: "p.1" }],
      budget: {
        cite: "p.1",
        lines: [{ id: "a", label: "A", cost: "ctx.budget", budget: "level" }],
        switches: [{ id: "s", label: "S", by: "party.seated > 1" }],
      },
    },
    { adjust: [{ add: {}, cite: "p.1" }], budget: { lines: [], switches: [{ id: "Bad", label: "", by: "1" }] } },
    { options: [{ id: "x", label: "X", cite: "p.1", entities: [] }], adjust: [{ add: { a: "1" }, extra: 1 }] },
  ].map((spawn) => ({ ...SAMPLE_SKIRMISH, spawn })),
  ...itemCrafted(),
  ...entryFromCrafted(),
  ...generatorCrafted(),
  ...acquireCrafted(),
];

// Acquiring by a Test (house decision #102): every rule the acquisition can break, one manifest each.
function acquireCrafted(): object[] {
  const a = ACQUIRE_MANIFEST.items.acquire;
  const acquire = (over: object) => ({
    ...ACQUIRE_MANIFEST,
    items: { ...ACQUIRE_MANIFEST.items, acquire: { ...a, ...over } },
  });
  const test = (over: object) => ({ ...ACQUIRE_MANIFEST, tests: { get: { ...ACQUIRE_MANIFEST.tests.get, ...over } } });
  return [
    acquire({ test: "nope" }),
    acquire({ kinds: ["tool", "nope"] }),
    acquire({ kinds: [] }),
    acquire({ limits: [{ kinds: ["nope"], max: 1 }] }),
    acquire({ limits: [{ kinds: ["tool"], max: 0 }] }),
    acquire({ inputs: { dn: a.inputs.dn } }),
    acquire({ inputs: { ...a.inputs, extra: [{ label: "E", value: "1" }] } }),
    acquire({ inputs: { ...a.inputs, dn: [] } }),
    acquire({ inputs: { ...a.inputs, dn: [{ label: "R", value: "item.nope" }] } }),
    acquire({ inputs: { ...a.inputs, dn: [{ label: "R", value: "ctx.nope" }] } }),
    acquire({ inputs: { ...a.inputs, dn: [{ label: "R", value: "item.tags" }] } }),
    acquire({ if: "1" }),
    acquire({ picks: { push: { label: "P", min: 0, max: "ctx.push" } } }),
    acquire({
      picks: {
        a: { label: "A", min: 0, max: "1" },
        b: { label: "B", min: 0, max: "1" },
        c: { label: "C", min: 0, max: "1" },
        d: { label: "D", min: 0, max: "1" },
      },
    }),
    acquire({ topUp: { resource: "nope" } }),
    acquire({ topUp: { resource: "coin", max: "true" } }),
    acquire({ quantity: "item.slot" }),
    acquire({ load: { field: "nope", quantity: "1" } }),
    acquire({ load: { field: "loads", quantity: "words" } }),
    acquire({ cite: "" }),
    { ...acquire({}), sources: [{ id: "s", title: "T", license: "private" }] },
    test({
      kind: "reported",
      outcomes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    }),
    test({ inputs: { dn: "int", bonus: "text", rare: "bool" } }),
    // House decision #175: a yes-or-no input is one part, read as a yes or no.
    acquire({ inputs: { ...a.inputs, rare: [...a.inputs.rare, { label: "R", value: "true" }] } }),
    acquire({ inputs: { ...a.inputs, rare: [{ label: "R", value: "1" }] } }),
    acquire({ inputs: { ...a.inputs, rare: [] } }),
    acquire({ inputs: { ...a.inputs, dn: [{ label: "R", value: "true" }] } }),
    test({ offers: [{ id: "acquire", label: "A", when: "true", changes: [{ resource: "coin", by: "1" }] }] }),
    {
      ...acquire({}),
      entities: [
        ACQUIRE_MANIFEST.entities[0],
        {
          ...ACQUIRE_MANIFEST.entities[1],
          fields: { ...ACQUIRE_MANIFEST.entities[1]?.fields, tags: { label: "T", type: "list" } },
        },
      ],
    },
    { ...acquire({}), resources: [...MINIMAL.resources, { id: "coin", label: "C", scope: "party", max: "20" }] },
  ];
}

// Items (house decision #95): every rule an items block can break, one manifest each.
function itemCrafted(): object[] {
  const kinds = ITEMS_MANIFEST.items.kinds;
  const kind = (i: number, over: object) => ({
    ...ITEMS_MANIFEST,
    items: { ...ITEMS_MANIFEST.items, kinds: kinds.map((k, j) => (j === i ? { ...k, ...over } : k)) },
  });
  const give = (g: object | undefined) => ({ ...ITEMS_MANIFEST, items: { kinds, give: g } });
  return [
    kind(0, { entry: "pc" }),
    kind(0, { entry: "nope" }),
    kind(0, { entities: ["gear", "nope"] }),
    kind(0, { entities: [] }),
    kind(0, { card: "powers" }),
    kind(0, { max: 0 }),
    kind(0, { max: 201 }),
    kind(0, { spend: true }),
    kind(1, { id: "tool" }),
    kind(1, { fits: { to: ["nope"], max: 1 } }),
    kind(1, { fits: { to: ["tool"], max: 0 } }),
    kind(1, { fits: { to: ["tool"], max: 1, slot: "nope" } }),
    kind(1, { fits: { to: [], max: 1 } }),
    kind(2, { fits: { to: ["tool"], max: 1 } }),
    // House decision #176: a slot per host kind, a host filter, a copy limit and the exemptions, valid then broken.
    ...[
      {},
      { slotOn: { kit: "slot" } },
      { slotOn: { tool: "nope" } },
      { slotOn: { tool: "copies" } },
      { hosts: "nope" },
      { hosts: "copies" },
      { copies: "slot" },
      { copies: "nope" },
      { exempt: { max: "" } },
      { exempt: { slot: "x".repeat(41) } },
      { slotOn: { Bad: "slot" } },
    ].map((over) => ({
      ...kind(1, {
        fits: {
          to: ["tool"],
          max: 2,
          slot: "slot",
          slotOn: { tool: "toolSlot" },
          hosts: "hosts",
          copies: "copies",
          exempt: { max: "free", slot: "loose" },
          ...over,
        },
      }),
      entities: [
        pcBase,
        {
          id: "gear",
          label: "G",
          base: "item",
          fields: {
            slot: { label: "S", type: "text" },
            toolSlot: { label: "T", type: "enum", values: ["a", "b"] },
            hosts: { label: "H", type: "list" },
            copies: { label: "C", type: "int" },
          },
        },
      ],
    })),
    kind(0, { tag: "" }),
    kind(0, { label: "x".repeat(61) }),
    give({ ref: "nope", loose: "kit" }),
    give({ ref: "of", loose: "shot" }),
    give({ ref: "of", loose: "nope" }),
    give({ ref: "of" }),
    {
      ...give({ ref: "of", loose: "kit" }),
      codex: { kinds: { item: { fields: { of: { label: "O", type: "int" } } } } },
    },
    { ...ITEMS_MANIFEST, items: { kinds: [] } },
    { ...ITEMS_MANIFEST, items: { kinds: Array.from({ length: 21 }, (_, i) => ({ ...kinds[3], id: `k${i}` })) } },
    { ...ITEMS_MANIFEST, sources: [{ id: "s", title: "T", license: "private" }] },
  ];
}

// Generators (house decision #98): one valid manifest using every step kind, then each refusal by its path.
function generatorCrafted(): object[] {
  const base = {
    entities: [pcBase, { id: "site", label: "S", base: "item", fields: { level: { type: "int", label: "L" } } }],
    campaignFields: { season: { type: "int", label: "S", min: 1, max: 5, default: 1 } },
    tables: {
      first: {
        title: "F",
        die: "1d6",
        visibility: "gm",
        entries: [{ id: "a", label: "A", range: [1, 6], next: "second" }],
      },
      second: { title: "S", die: "1d6", visibility: "gm", entries: [{ id: "b", label: "B", range: [1, 6] }] },
      dealt: { title: "D", visibility: "owner", entries: [{ id: "a", label: "A" }] },
    },
    codex: {
      kinds: {
        location: {
          fields: {
            name: { type: "text", label: "N" },
            n: { type: "int", label: "N" },
            mood: { type: "enum", label: "M", values: ["a", "b"] },
            at: { type: "ref", label: "A", entity: "site" },
            on: { type: "bool", label: "O" },
          },
          from: [{ entity: "site" }],
        },
      },
    },
  };
  const roll = { id: "r", label: "R", kind: "roll", table: "first" };
  const gen = (over: object) => ({
    ...base,
    generators: [{ id: "g", label: "G", steps: [roll], make: { kind: "location", title: "r" }, ...over }],
  });
  return [
    gen({
      steps: [
        roll,
        { id: "n", label: "N", kind: "number", min: 1, max: 3, when: 'steps.r == "b"' },
        { id: "m", label: "M", kind: "choice", options: ["a", "b"], labels: { a: "Ay" } },
        {
          id: "p",
          label: "P",
          kind: "pick",
          entity: "site",
          filter: 'entry.level >= campaign.season && steps.m != "b"',
        },
        { id: "t", label: "T", kind: "text", maxLength: 20 },
      ],
      each: { times: "steps.n", steps: [{ id: "e", label: "E", kind: "roll", table: "second" }] },
      make: {
        kind: "location",
        title: "t",
        from: "p",
        fields: { name: "r", n: "n", mood: "m", at: "p" },
        each: { title: "e", fields: { name: "t" } },
      },
    }),
    gen({ steps: [roll, { ...roll }] }),
    gen({ each: { times: "1", steps: [{ ...roll }] }, make: { kind: "location", title: "r", each: { title: "r" } } }),
    gen({
      steps: [
        { ...roll, table: "nope" },
        { ...roll, id: "d", table: "dealt" },
      ],
    }),
    gen({ steps: [roll, { id: "p", label: "P", kind: "pick", entity: "ghost" }] }),
    gen({ steps: [roll, { id: "n", label: "N", kind: "number", min: 3, max: 1 }] }),
    gen({ steps: [roll, { id: "m", label: "M", kind: "choice", options: ["a", "a"], labels: { z: "Z" } }] }),
    gen({ make: { kind: "location", title: "nope" } }),
    gen({ make: { kind: "location", title: "r", from: "r" } }),
    gen({ make: { kind: "npc", title: "r", fields: { name: "r" } } }),
    gen({ make: { kind: "location", title: "r", fields: { name: "nope", on: "r", n: "r", mood: "r", at: "r" } } }),
    gen({ each: { times: "1", steps: [{ ...roll, id: "e" }] } }),
    gen({ make: { kind: "location", title: "r", each: { title: "r" } } }),
    // A run with no entry of its own (house decision #202): only with rounds, and `root` is false or absent.
    gen({ make: { kind: "location", title: "r", root: false } }),
    gen({
      each: { times: "1", steps: [{ ...roll }] },
      make: { kind: "location", title: "r", root: false, each: { title: "r" } },
    }),
    gen({
      each: { times: "1", steps: [{ ...roll }] },
      make: { kind: "location", title: "r", root: true, each: { title: "r" } },
    }),
    gen({
      each: { times: "1", steps: [{ ...roll, id: "e" }] },
      make: { kind: "scene", title: "r", each: { title: "e" } },
    }),
    gen({
      steps: [
        { ...roll, when: "steps.later == 1" },
        { id: "later", label: "L", kind: "number", min: 1, max: 2 },
      ],
    }),
    gen({ steps: [roll, { id: "p", label: "P", kind: "pick", entity: "site", filter: "entry.nope > 1" }] }),
    gen({ steps: [roll, { id: "p", label: "P", kind: "pick", entity: "site", filter: "entry.level" }] }),
    gen({
      each: { times: "steps.r", steps: [{ ...roll, id: "e" }] },
      make: { kind: "location", title: "r", each: { title: "e" } },
    }),
    // House decision #179: a roll's whole chain as its words, and a text field joining several steps; each refusal.
    gen({
      steps: [
        { ...roll, trail: true },
        { id: "t", label: "T", kind: "text" },
      ],
      make: { kind: "location", title: "r", fields: { name: ["r", "t"] } },
    }),
    gen({
      steps: [roll, { id: "m", label: "M", kind: "choice", options: ["a"] }],
      make: { kind: "location", title: "r", fields: { mood: ["m", "m"] } },
    }),
    gen({ make: { kind: "location", title: "r", fields: { name: ["r", "nope"] } } }),
    gen({
      steps: [roll, { id: "n", label: "N", kind: "number", min: 1, max: 3 }],
      make: { kind: "location", title: "r", fields: { name: ["r", "n"] } },
    }),
    gen({ make: { kind: "location", title: "r", fields: { name: ["r"] } } }),
    gen({ make: { kind: "location", title: "r", fields: { name: ["r", "r", "r", "r", "r"] } } }),
    gen({ steps: [{ ...roll, trail: "yes" }] }),
    gen({ steps: [roll, { id: "t", label: "T", kind: "text", maxLength: 201 }] }),
    gen({ steps: [roll, { id: "s", label: "S", kind: "nope" }] }),
    { ...gen({}), generators: [gen({}).generators[0], gen({}).generators[0]] },
    { ...gen({}), sources: [{ id: "s", title: "T", license: "private" }] },
  ];
}

// SAMPLE_D20 with a second generator using a text, a choice, a pick skipped by `when` and made `from`, and a person of
// a choice's mood (house decision #98).
const GENERATOR_MANIFESTS: unknown[] = [
  {
    ...SAMPLE_D20,
    generators: [
      ...(SAMPLE_D20.generators ?? []),
      {
        id: "charter",
        label: "A charter",
        cite: "Sample p.92",
        steps: [
          { id: "name", label: "Name", kind: "text", maxLength: 20 },
          {
            id: "mood",
            label: "Mood",
            kind: "choice",
            options: ["warm", "wary", "cold"],
            labels: { warm: "Warm" },
          },
          {
            id: "charter",
            label: "Charter",
            kind: "pick",
            entity: "charter",
            when: 'steps.mood != "cold"',
            filter: "entry.seasonFrom <= campaign.season",
          },
        ],
        make: { kind: "lore", title: "name", from: "charter", fields: { charter: "charter" } },
      },
      {
        id: "person",
        label: "A person",
        cite: "Sample p.92",
        steps: [{ id: "mood", label: "Mood", kind: "choice", options: ["warm", "cold"] }],
        make: { kind: "npc", title: "mood", fields: { mood: "mood", look: "mood" } },
      },
    ],
  },
  SAMPLE_HARM,
];

function generatorRunVectors(): object[] {
  const served = [
    { entity: "creature", key: "wisp", name: "Ember Wisp", body: { level: 1 } },
    { entity: "creature", key: "rat", name: "Rat", body: { level: 0, guard: 9 } },
    { entity: "charter", key: "lantern", name: "Lantern Charter", body: { seasonFrom: 2, seasonTo: 3 } },
    { entity: "charter", key: "dawn", name: "Dawn Charter", body: { seasonFrom: 4 } },
  ];
  const lookup = (entity: string, key: string) => served.find((e) => e.entity === entity && e.key === key);
  const rulesets = GENERATOR_MANIFESTS.map((m) => {
    const r = compileRuleset(m);
    if (!r.ok) throw new Error(`a generator manifest does not compile: ${JSON.stringify(r.problems)}`);
    return r.compiled.ruleset;
  });
  const warren = (values: object, each: object[] = [{ chamber: { rows: ["pit"] } }]) => ({
    manifest: 0,
    generator: "warren",
    run: { values: { rooms: { value: 1 }, origin: { rows: ["burrowed"] }, keeper: { key: "rat" }, ...values }, each },
  });
  const charter = (values: object, campaign: object = { season: 3 }) => ({
    manifest: 0,
    generator: "charter",
    run: {
      values: { name: { value: " The Pact " }, mood: { value: "warm" }, charter: { key: "lantern" }, ...values },
      each: [],
    },
    campaign,
  });
  const cases = [
    warren({}),
    warren({ rooms: { value: 2 } }, [{ chamber: { rows: ["pit"] } }, { chamber: { rows: ["vault"] } }]),
    warren({ origin: { rows: ["built", "smiths"] } }),
    warren({ origin: { rows: ["built"] } }),
    warren({ origin: { rows: ["built", "pit"] } }),
    warren({ origin: { rows: ["burrowed", "smiths"] } }),
    warren({ origin: { rows: ["forged"] } }),
    warren({ origin: { rows: [] } }),
    warren({ origin: { rows: Array.from({ length: 9 }, () => "built") } }),
    warren({ origin: { key: "burrowed" } }),
    warren({ origin: { rows: ["flooded"] } }),
    warren({ origin: { rows: ["flooded"] }, keeper: { key: "wisp" } }),
    warren({ keeper: { key: "ghost" } }),
    warren({ keeper: { key: "lantern" } }),
    warren({ keeper: {} }),
    warren({ rooms: { value: 0 } }, []),
    warren({ rooms: { value: 7 } }),
    warren({ rooms: { value: 1.5 } }),
    warren({ rooms: { value: "1" } }),
    warren({ rooms: { value: -0 } }, []),
    warren({}, []),
    warren({}, [{ chamber: { rows: ["pit"] } }, { chamber: { rows: ["pit"] } }]),
    warren({}, [{ chamber: { rows: ["gone"] } }]),
    warren({}, [{}]),
    charter({}),
    charter({ name: { value: "   " } }),
    charter({ name: { value: "x".repeat(21) } }),
    charter({ name: { value: "é".repeat(20) } }),
    charter({ mood: { value: "cold" }, charter: { key: "nope" } }),
    charter({ mood: { value: "grim" } }),
    charter({ charter: { key: "dawn" } }),
    charter({ charter: { key: "dawn" } }, { season: 5 }),
    charter({}, {}),
    charter({ name: { value: 3 } }),
    { manifest: 0, generator: "person", run: { values: { mood: { value: "cold" } }, each: [] } },
    // House decision #179: the shrine's chain as its title and its story joining the chain and the keeper.
    {
      manifest: 0,
      generator: "shrine",
      run: { values: { origin: { rows: ["built", "monks"] }, keeper: { key: "wisp" } }, each: [] },
    },
    {
      manifest: 0,
      generator: "shrine",
      run: { values: { origin: { rows: ["flooded"] }, keeper: { key: "rat" } }, each: [] },
    },
    { manifest: 1, generator: "portent", run: { values: { sign: { rows: ["crow"] } }, each: [] } },
    // Chambers for a warren already made (house decision #202): no root, the rounds' entries only.
    {
      manifest: 0,
      generator: "chambers",
      run: {
        values: { rooms: { value: 2 } },
        each: [{ chamber: { rows: ["pit"] } }, { chamber: { rows: ["vault"] } }],
      },
    },
    {
      manifest: 0,
      generator: "chambers",
      run: { values: { rooms: { value: 2 } }, each: [{ chamber: { rows: ["pit"] } }] },
    },
    { manifest: 1, generator: "portent", run: { values: { sign: { rows: ["crow"] } }, each: [{}] } },
  ];
  return cases.map((c) => {
    const ruleset = rulesets[c.manifest]!;
    const generator = ruleset.generators!.find((g) => g.id === c.generator)!;
    return {
      ...c,
      served,
      result: checkRun({
        ruleset,
        generator,
        run: c.run as GeneratorRun,
        served: lookup,
        campaign: ("campaign" in c ? c.campaign : {}) as Record<string, number>,
      }),
    };
  });
}

// Entries made from pack entries, rolled fields and a reminder reading the campaign (house decision #97): one valid
// manifest using every key, then each refusal by its path.
function entryFromCrafted(): object[] {
  const base = {
    entities: [
      pcBase,
      {
        id: "site",
        label: "S",
        base: "item",
        fields: {
          within: { type: "ref", label: "W", entity: "site" },
          other: { type: "ref", label: "O", entity: "pc" },
          peril: { type: "int", label: "P" },
          mood: { type: "enum", label: "M", values: ["a", "b"] },
          checks: { type: "list", label: "C" },
          note: { type: "text", label: "N" },
        },
      },
    ],
    campaignFields: { season: { type: "int", label: "S", min: 1, max: 5, default: 1 } },
    tables: {
      first: { title: "F", die: "1d6", visibility: "gm", entries: [{ id: "a", label: "A", range: [1, 6] }] },
      dealt: { title: "D", visibility: "owner", entries: [{ id: "a", label: "A" }] },
    },
  };
  const kinds = (over: object) => ({ ...base, codex: { kinds: over } });
  const place = (from: object, fields: object = {}) =>
    kinds({ location: { fields: { peril: { type: "int", label: "P" }, ...fields }, from: [from] } });
  const scene = (from: object) => kinds({ scene: { fields: {}, from: [from] } });
  return [
    kinds({
      location: {
        fields: {
          peril: { type: "int", label: "P" },
          name: { type: "text", label: "N", roll: { tables: ["first", "first"], join: " " } },
          mood: { type: "enum", label: "M", values: ["a", "b", "c"] },
        },
        from: [{ entity: "site", name: "name", values: { peril: "peril", mood: "mood" }, children: "within" }],
        titleRoll: { tables: ["first"] },
      },
      scene: {
        fields: {},
        from: [{ entity: "site", tests: { field: "checks", inputs: { dc: "peril" } }, roster: "checks" }],
      },
      lore: {
        fields: { from: { type: "int", label: "F" } },
        reminders: [{ id: "r", if: "fields.from > campaign.season", text: "T" }],
        ready: ["from"],
      },
    }),
    place({ entity: "nope" }),
    kinds({ location: { fields: {}, from: [{ entity: "site" }, { entity: "site" }] } }),
    place({ entity: "site", name: "peril" }),
    place({ entity: "site", values: { nope: "peril" } }),
    place({ entity: "site", values: { peril: "nope" } }),
    place({ entity: "site", values: { peril: "note" } }),
    place({ entity: "site", values: { m: "mood" } }, { m: { type: "enum", label: "M", values: ["a"] } }),
    place({ entity: "site", children: "other" }),
    place({ entity: "site", children: "peril" }),
    scene({ entity: "site", children: "within" }),
    place({ entity: "site", tests: { field: "checks" } }),
    place({ entity: "site", roster: "checks" }),
    scene({ entity: "site", tests: { field: "peril" } }),
    scene({ entity: "site", roster: "note" }),
    scene({ entity: "site", tests: { field: "checks", inputs: { dc: "within" } } }),
    scene({ entity: "site", tests: { field: "checks", inputs: { dc: "nope" } } }),
    // House decision #177: a list fills a tags field; a Test's own inputs over the shared ones; each refusal.
    place({ entity: "site", values: { marks: "checks" } }, { marks: { type: "tags", label: "M", writeIn: true } }),
    place({ entity: "site", values: { marks: "note" } }, { marks: { type: "tags", label: "M", writeIn: true } }),
    {
      ...scene({ entity: "site", tests: { field: "checks", per: { t: { dc: "peril", who: "mood" } } } }),
      tests: { t: sumTest },
    },
    scene({ entity: "site", tests: { field: "checks", per: { t: { dc: "peril" } } } }),
    { ...scene({ entity: "site", tests: { field: "checks", per: { t: { dc: "within" } } } }), tests: { t: sumTest } },
    // House decision #178: a title rolled on tables by a field's value, and a scene's pool lines from pack entries.
    kinds({
      npc: {
        fields: {
          kin: { type: "enum", label: "K", values: ["a", "b"] },
          from: { type: "ref", label: "F", entity: "site" },
        },
        titleRoll: { tables: ["first"], per: { field: "kin", tables: { b: ["first", "first"] } } },
      },
      location: {
        fields: {
          by: { type: "ref", label: "B", entity: "site" },
          look: {
            type: "text",
            label: "L",
            roll: { tables: ["first"], per: { field: "by", tables: { "old-mill": ["first"] } } },
          },
        },
      },
    }),
    kinds({
      npc: {
        fields: { kin: { type: "enum", label: "K", values: ["a"] } },
        titleRoll: { tables: ["first"], per: { field: "kin", tables: { z: ["nope", "dealt"] } } },
      },
    }),
    kinds({
      npc: {
        fields: { n: { type: "int", label: "N" } },
        titleRoll: { tables: ["first"], per: { field: "n", tables: { a: ["first"] } } },
      },
    }),
    kinds({ npc: { fields: {}, titleRoll: { tables: ["first"], per: { field: "nope", tables: {} } } } }),
    kinds({ npc: { fields: {}, titleRoll: { tables: ["first"], per: { field: "nope", tables: { a: [] } } } } }),
    {
      ...kinds({
        scene: {
          fields: {},
          poolLines: [{ entity: "site", pool: "dread", amount: "peril", spend: true, text: "note" }],
        },
      }),
      resources: [
        { id: "dread", label: "D", scope: "gm" },
        { id: "hp", label: "H", scope: "entity" },
      ],
    },
    {
      ...kinds({
        location: { fields: {}, poolLines: [{ entity: "site", pool: "hp", amount: "note", text: "peril" }] },
        scene: { fields: {}, poolLines: [{ entity: "nope", pool: "nope", amount: "peril" }] },
      }),
      resources: [{ id: "hp", label: "H", scope: "entity" }],
    },
    kinds({ scene: { fields: {}, poolLines: [] } }),
    kinds({ npc: { fields: { look: { type: "text", label: "L", roll: { tables: ["nope", "dealt"] } } } } }),
    kinds({ npc: { fields: {}, titleRoll: { tables: [] } } }),
    kinds({ npc: { fields: {}, titleRoll: { tables: ["first"], join: "x".repeat(11) } } }),
    kinds({ lore: { fields: {}, reminders: [{ id: "r", if: "campaign.era > 1", text: "T" }] } }),
    // House decision #172: a group of reminders, of which the first that holds shows; a group is an id.
    kinds({
      lore: {
        fields: {},
        reminders: [
          { id: "a", if: "campaign.season > 2", text: "T", group: "g" },
          { id: "b", if: "campaign.season > 1", text: "U", group: "g" },
        ],
      },
    }),
    kinds({ lore: { fields: {}, reminders: [{ id: "a", if: "campaign.season > 2", text: "T", group: "Bad id" }] } }),
    // The readiness rule (house decision #107): an unknown field, another kind's field, a duplicate, the bounds.
    kinds({ scene: { fields: { goal: { type: "text", label: "G" } }, ready: ["goal", "nope"] } }),
    kinds({
      scene: { fields: { goal: { type: "text", label: "G" } }, ready: ["peril"] },
      location: { fields: { peril: { type: "int", label: "P" } } },
    }),
    kinds({ scene: { fields: { goal: { type: "text", label: "G" } }, ready: ["goal", "goal"] } }),
    kinds({ scene: { fields: { goal: { type: "text", label: "G" } }, ready: [] } }),
    kinds({ scene: { fields: { goal: { type: "text", label: "G" } }, ready: ["Bad"] } }),
    {
      ...kinds({ lore: { fields: {}, reminders: [{ id: "r", if: "campaign.season > 1", text: "T" }] } }),
      campaignFields: undefined,
    },
  ];
}

// Held records (house decision #88): every rule a held kind can break, one manifest each.
function heldCrafted(): object[] {
  const one = (kind: object, over: object = {}) => ({
    ...HELD_MANIFEST,
    ...over,
    held: { mark: { ...HELD_KIND, ...kind } },
  });
  const [pc, mark] = HELD_MANIFEST.entities;
  const marks = (def: object) => ({ entities: [{ ...pc, fields: { ...pc!.fields, marks: def } }, mark] });
  return [
    one({ entry: "pc" }),
    one({ entry: "nope" }),
    one({ entities: ["mark", "nope"] }),
    one({ entities: [] }),
    one({ field: "hp" }),
    one({ field: "nope" }),
    one({ field: "Bad" }),
    one({}, marks({ label: "M", type: "list", visibility: "party" })),
    one({ unseen: undefined }, marks({ label: "M", type: "list", visibility: "party" })),
    one({}, marks({ label: "M", type: "list" })),
    one({ max: 0 }),
    one({ max: 51 }),
    // A record's includes (house decision #165): a list field of the entry type, and nothing else.
    one({ includes: "with" }, { entities: [pc, { ...mark, fields: { with: { label: "W", type: "list" } } }] }),
    one({ includes: "with" }, { entities: [pc, { ...mark, fields: { with: { label: "W", type: "text" } } }] }),
    one({ includes: "with" }),
    one({ includes: "Bad" }),
    // A record's extra rolls and gear (house decision #191).
    ...(() => {
      const fields = {
        more: { label: "R", type: "int" },
        arms: { label: "A", type: "list" },
        word: { label: "W", type: "text" },
      };
      const typed = { entities: [pc, { ...mark, fields }] };
      const kinds = (holders: string[]) => ({
        ...typed,
        items: { kinds: [{ id: "kit", label: "K", entry: "mark", entities: holders, cite: "p1" }] },
      });
      return [
        one({ extraRolls: "more" }, typed),
        one({ extraRolls: "word" }, typed),
        one({ extraRolls: "nope" }, typed),
        one({ gear: { field: "arms", kind: "kit" } }, kinds(["pc"])),
        one({ gear: { field: "word", kind: "kit" } }, kinds(["pc"])),
        one({ gear: { field: "arms", kind: "nope" } }, kinds(["pc"])),
        one({ gear: { field: "arms", kind: "kit" } }, typed),
        one({ gear: { field: "arms" } }, kinds(["pc"])),
      ];
    })(),
    one({ unseen: "" }),
    one({ label: "x".repeat(61) }),
    { ...HELD_MANIFEST, held: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`k${i}`, HELD_KIND])) },
    { ...HELD_MANIFEST, sources: [{ id: "s", title: "T", license: "private" }] },
    {
      ...HELD_MANIFEST,
      tables: { t: tbl("d6", [span("a", 1, 6, { apply: [{ kind: "grant", held: "nope", entry: "x" }] })]) },
    },
    {
      ...HELD_MANIFEST,
      tables: { t: tbl("d6", [span("a", 1, 6, { apply: [{ kind: "grant", held: "mark", entry: "Bad Key" }] })]) },
    },
    { ...HELD_MANIFEST, tables: { t: tbl("d6", [span("a", 1, 6, { apply: [{ kind: "grant", held: "mark" }] })]) } },
    { ...HELD_MANIFEST, ...rows({ widget: "held" }) },
    { ...HELD_MANIFEST, ...rows({ widget: "held", variant: "x" }, { widget: "held", bind: { a: ["hp"] } }) },
    rows({ widget: "held" }),
  ];
}

// Lookups (house decision #87): every rule a lookup table can break, one manifest each.
function lookupCrafted(): object[] {
  const one = (t: object, over: object = {}) => ({ ...LOOKUP_MANIFEST, ...over, tables: { t } });
  const line = (apply: object[], over: object = {}) => tbl("d6", [span("a", 1, 6, { apply, ...over })]);
  const pool = { kind: "pool", pool: "dread", by: "1" };
  return [
    one(tbl("d6", [{ id: "a", label: "A", range: [1] }, span("b", 2, 6)])),
    one(tbl("d6", [span("a", 1, 3), { id: "b", label: "B", range: [4] }])),
    one(tbl("d6", [span("a", 1, 6), span("b", 7, 8)])),
    one(tbl("d6", [span("a", 1, 6), span("b", 7, 8)], { modifier: "1" })),
    one(tbl("d6", [span("a", 1, 6), span("b", 8, 9)], { modifier: "1" })),
    one(tbl("d66", [...d66Rows, { id: "x", label: "X", range: [71] }], { modifier: "1" })),
    one(tbl("d66", [...d66Rows, { id: "x", label: "X", range: [81] }], { modifier: "1" })),
    one(tbl("d66", [...d66Rows, { id: "x", label: "X", range: [76, 72] }], { modifier: "1" })),
    one(tbl(undefined, [{ id: "a", label: "A", apply: [pool] }])),
    one({ ...line([pool]), visibility: "owner" }),
    one({ ...line([pool]), typedOnly: false }),
    one({ ...line([pool]), inputs: [{ id: "x", label: "X", type: "bool", min: 1 }] }),
    one({ ...line([pool]), inputs: [{ id: "x", label: "X", type: "int", min: 3, max: 1 }] }),
    // A stepper's max over the shared pools (house decision #192).
    ...[
      { type: "int", min: 0, max: "pools.dread" },
      { type: "int", max: "pools.dread + campaign.x" },
      { type: "int", max: "pools.hp" },
      { type: "int", max: "pools.dread > 1" },
      { type: "int", max: "res.hp" },
      { type: "int", max: "" },
      { type: "bool", max: "pools.dread" },
      { type: "int", dice: "1d3", max: "pools.dread" },
    ].map((x) => one({ ...line([pool]), inputs: [{ id: "x", label: "X", ...x }] })),
    // A die the GM types (house decision #164): plain NdX of at most 1000, a number, its own bounds.
    one({ ...line([pool]), inputs: [{ id: "x", label: "X", type: "int", dice: "1d3" }] }),
    one({ ...line([pool]), inputs: [{ id: "x", label: "X", type: "int", dice: "1d3", min: 1 }] }),
    one({ ...line([pool]), inputs: [{ id: "x", label: "X", type: "bool", dice: "1d3" }] }),
    one({ ...line([pool]), inputs: [{ id: "x", label: "X", type: "int", dice: "1d3+1" }] }),
    one({ ...line([pool]), inputs: [{ id: "x", label: "X", type: "int", dice: "d66" }] }),
    one({ ...line([pool]), inputs: [{ id: "x", label: "X", type: "int", dice: "10d101" }] }),
    one({ ...line([pool]), inputs: [{ id: "x", label: "X", type: "int", dice: "x".repeat(21) }] }),
    one({ ...line([{ ...pool, when: "has(res.nope) && has(attr.nope)" }]) }),
    one({ ...line([{ ...pool, when: "has(nope.x)" }]) }),
    one({
      ...line([pool]),
      inputs: [
        { id: "x", label: "X", type: "int" },
        { id: "x", label: "Y", type: "bool" },
      ],
    }),
    one({ ...line([pool]), inputs: [] }),
    one({ ...line([pool]), inputs: [{ id: "x", label: "X", type: "text" }] }),
    one({ ...line([pool]), entities: ["pc", "nope"] }),
    one(line([{ kind: "condition", condition: "nope" }])),
    one(line([{ kind: "resource", resource: "dread", by: "1" }])),
    one(line([{ kind: "resource", resource: "nope", by: "1" }])),
    one(line([{ kind: "pool", pool: "luck", by: "1" }])),
    one(line([{ kind: "harm", wounds: "1" }])),
    one(line([{ kind: "harm" }])),
    one(line([{ kind: "nope" }])),
    one(line([{ kind: "pool", pool: "dread" }])),
    one(line([pool], { next: "gone" })),
    one(line([pool], { note: "" })),
    one(line([])),
    one(line(Array.from({ length: 9 }, () => pool))),
    one({ ...line([{ ...pool, by: "true" }]) }),
    one({ ...line([{ ...pool, when: "1" }]) }),
    one({ ...line([{ ...pool, times: "ctx.x" }]), inputs: [{ id: "x", label: "X", type: "bool" }] }),
    one({ ...line([pool]), modifier: "hp > 1" }),
    one({ ...line([{ ...pool, by: "nope" }]), entities: ["pc"] }),
    { ...harmManifest(), tables: { t: line([{ kind: "harm", wounds: "1", shock: "2" }]) } },
    { ...harmManifest(), tables: { t: line([{ kind: "resource", resource: "wounds", by: "1" }]) } },
  ];
}

// The setup checklist (house decision #90): one valid list using every count, then each refusal.
function checklistCrafted(): object[] {
  const base = {
    entities: [pcBase, { id: "kin", label: "K", base: "ability", fields: {} }],
    resources: [
      { id: "hp", label: "H", scope: "entity", max: "10" },
      { id: "luck", label: "L", scope: "party", max: "3" },
    ],
    campaignFields: { tier: { type: "int", label: "T", min: 1, max: 5, default: 1 } },
    codex: {
      kinds: {
        lore: {
          fields: {
            frame: { type: "text", label: "F" },
            mood: { type: "enum", label: "M", values: ["a", "b"] },
            kinds: { type: "tags", label: "K", writeIn: true },
          },
        },
      },
    },
  };
  const step = (done: object, over: object = {}) => ({ id: "s", label: "S", done, ...over });
  const list = (...steps: object[]) => ({ ...base, checklist: steps.map((s, i) => ({ id: `s${i}`, ...s })) });
  return [
    list(
      step({ count: "entries", kind: "lore", field: "kinds" }, { goto: { tab: "codex", kind: "lore" }, note: "N" }),
      step({ count: "entries", kind: "lore", field: "mood", equals: "a", min: 2 }, { optional: true }),
      step({ count: "entries", kind: "scene", prep: "roster" }, { goto: { tab: "prep" } }),
      step({ count: "actors", entity: "pc", min: 3 }, { goto: { tab: "party" } }),
      step({ count: "campaignField", field: "tier" }),
      step({ count: "pool", pool: "luck", min: 1 }),
      step({ count: "sessions" }),
      step({ count: "packs", slug: "sample-bestiary" }),
      step({ count: "safety" }, { cite: "p1" }),
    ),
    { ...base, checklist: [] },
    // House decision #173: a step's room value, an expression over the campaign fields.
    list(step({ count: "campaignField", field: "tier" }, { now: "campaign.tier * 100" })),
    list(step({ count: "campaignField", field: "tier" }, { now: "campaign.nope" })),
    list(step({ count: "sessions" }, { now: "res.hp" })),
    { ...list(step({ count: "sessions" }, { now: "campaign.tier" })), campaignFields: undefined },
    list(step({ count: "nothing" })),
    list(step({ count: "entries", kind: "ship" })),
    list(step({ count: "entries", kind: "lore", field: "nope" })),
    list(step({ count: "entries", kind: "npc", field: "frame" })),
    list(step({ count: "entries", kind: "lore", equals: "a" })),
    list(step({ count: "entries", kind: "lore", field: "mood", equals: "c" })),
    list(step({ count: "entries", kind: "lore", field: "frame", equals: 3 })),
    list(step({ count: "entries", kind: "lore", field: "mood", equals: 1.5 })),
    list(step({ count: "entries", kind: "lore", prep: "roster" })),
    list(step({ count: "entries", kind: "scene", prep: "hazards" })),
    list(step({ count: "actors", entity: "ghost" })),
    list(step({ count: "actors", entity: "kin" })),
    list(step({ count: "actors", entity: "pc", built: true })),
    list(step({ count: "actors" })),
    list(step({ count: "campaignField", field: "era" })),
    list(step({ count: "pool", pool: "hp" })),
    list(step({ count: "pool", pool: "gold" })),
    list(step({ count: "sessions", min: 0 })),
    list(step({ count: "sessions", min: 101 })),
    list(step({ count: "packs", slug: "" })),
    list(step({ count: "safety", min: 1 })),
    list(step({ count: "sessions" }, { goto: { tab: "settings" } })),
    list(step({ count: "sessions" }, { goto: { tab: "prep", kind: "npc" } })),
    list(step({ count: "sessions" }, { goto: { tab: "codex", kind: "ship" } })),
    // A place inside the tab (house decision #200): one of the tab's own, never another's.
    list(step({ count: "sessions" }, { goto: { tab: "party", anchor: "session" } })),
    list(step({ count: "sessions" }, { goto: { tab: "rules", anchor: "settings" } })),
    list(step({ count: "sessions" }, { goto: { tab: "party", anchor: "settings" } })),
    list(step({ count: "sessions" }, { goto: { tab: "codex", anchor: "open" } })),
    list(step({ count: "sessions" }, { goto: { tab: "party", anchor: "nope" } })),
    list(step({ count: "sessions" }, { label: "" })),
    list(step({ count: "sessions" }, { note: "x".repeat(201) })),
    list(step({ count: "sessions" }), step({ count: "safety" }, { id: "s0" })),
    { ...base, checklist: Array.from({ length: 31 }, (_, i) => step({ count: "sessions" }, { id: `s${i}` })) },
    // Outside homebrew every step cites its page.
    { ...list(step({ count: "sessions" })), sources: [{ id: "s", title: "T", license: "private" }] },
  ];
}

// A Test's marks and offers (house decision #80): one manifest per check.
function offersCrafted(): object[] {
  const pools = [
    { id: "hp", label: "H", scope: "entity", max: "10" },
    { id: "dread", label: "D", scope: "party", max: "5" },
  ];
  const offer = (over: object = {}) => ({
    id: "o",
    label: "Shaken",
    when: "!result.passed && ctx.fear",
    changes: [{ pool: "dread", by: "1" }],
    ...over,
  });
  const test = (over: object = {}, base: object = poolTest) => ({
    resources: pools,
    tests: { t: { ...base, marks: { fear: { label: "Fear" } }, offers: [offer()], ...over } },
  });
  const gain = "max(0, result.target - result.total) * (result.flags.complication ? 2 : 1) + attr.str";
  return [
    test(),
    test({ offers: [offer(), offer({ id: "g", when: "result.margin < 0", changes: [{ resource: "hp", by: gain }] })] }),
    test({}, sumTest),
    test(
      { offers: [offer({ when: 'result.outcome == "a" && result.natural > 1 && result.shifts == 0' })] },
      reportedTest(["a", "b"]),
    ),
    test({ marks: {} }),
    test({ marks: { fear: { label: "" } } }),
    test({ marks: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`m${i}`, { label: "M" }])) }),
    test({ inputs: { fear: "bool" } }),
    test({ offers: [offer(), offer()] }),
    test({ offers: Array.from({ length: 11 }, (_, i) => offer({ id: `o${i}` })) }),
    test({ offers: [offer({ changes: [] })] }),
    test({ offers: [offer({ changes: [{ by: "1" }] })] }),
    test({ offers: [offer({ changes: [{ pool: "dread", resource: "hp", by: "1" }] })] }),
    test({ offers: [offer({ changes: [{ pool: "nope", by: "1" }] })] }),
    test({ offers: [offer({ changes: [{ pool: "hp", by: "1" }] })] }),
    test({ offers: [offer({ changes: [{ resource: "dread", by: "1" }] })] }),
    test({ offers: [offer({ changes: [{ resource: "nope", by: "1" }] })] }),
    test({ offers: [offer({ when: "1" })] }),
    test({ offers: [offer({ when: "attr.str > 1" })] }),
    test({ offers: [offer({ when: "result.nope" })] }),
    test({ offers: [offer({ changes: [{ pool: "dread", by: "result.passed" }] })] }),
    test({ offers: [offer({ label: "x".repeat(61) })] }),
    {
      ...test(),
      entities: [pcBase, { ...pcBase, id: "npc" }],
      resources: [...pools, { id: "grit", label: "G", scope: "entity", entities: ["pc"], max: "3" }],
      tests: { t: { ...poolTest, offers: [offer({ when: "true", changes: [{ resource: "grit", by: "1" }] })] } },
    },
    withFields({ "result.x": fieldInt }),
    { ...withFields({ "result.x": fieldInt }), ...test() },
    {
      sources: [{ id: "s", title: "T", license: "srd" }],
      resources: pools.map((x) => ({ ...x, cite: "p1" })),
      initiative: undefined,
      tests: {
        t: {
          ...poolTest,
          cite: "p1",
          marks: { fear: { label: "F" } },
          offers: [offer(), offer({ id: "c", cite: "p2" })],
        },
      },
    },
    // Choices the taker makes while reporting (house decision #170): read by the target and the offers, not the
    // modifier or the pool; a switch reads as yes or no, a number as a whole number.
    test({
      target: "max(1, 3 - ctx.wrath)",
      choices: { wrath: { label: "Wrath", max: 2 }, brace: { label: "Braced" } },
      offers: [offer({ when: "!result.passed && !ctx.brace", changes: [{ pool: "dread", by: "1 + ctx.wrath" }] })],
    }),
    test({ choices: { brace: { label: "B" } } }, sumTest),
    test({ choices: { brace: { label: "B" } } }, reportedTest(["a", "b"])),
    test({ choices: {} }),
    test({ choices: { brace: { label: "" } } }),
    test({ choices: { w: { label: "W", max: 0 } } }),
    test({ choices: { w: { label: "W", max: 21 } } }),
    test({ choices: { w: { label: "W", max: 1.5 } } }),
    test({ choices: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`c${i}`, { label: "C" }])) }),
    test({ choices: { fear: { label: "F" } } }),
    test({ inputs: { brace: "bool" }, choices: { brace: { label: "B" } } }),
    test({ modifier: "ctx.wrath", choices: { wrath: { label: "W", max: 2 } } }),
    test({ pool: "ctx.wrath", choices: { wrath: { label: "W", max: 2 } } }),
    test({ target: "ctx.brace", choices: { brace: { label: "B" } } }),
    test({ target: "ctx.wrath ? 1 : 2", choices: { wrath: { label: "W", max: 2 } } }),
    {
      sources: [{ id: "s", title: "T", license: "srd" }],
      resources: pools.map((x) => ({ ...x, cite: "p1" })),
      initiative: undefined,
      tests: { t: { ...poolTest, cite: "p1", choices: { a: { label: "A" }, b: { label: "B", cite: "p2" } } } },
    },
  ];
}

// A definition's meaning (house decision #126): on every kind of definition, trimmed, at most 300 characters.
function summaryCrafted(): object[] {
  const cited = { sources: [{ id: "s", title: "T", license: "srd" }] };
  return [
    {
      ...withPc({
        fields: { ...pcBase.fields, hp: { ...fieldInt, summary: "  How hard you are to stop.  " } },
        derived: [{ id: "a", label: "A", expr: "attr.str", visibility: "public", summary: "x".repeat(300) }],
      }),
      resources: [{ id: "hp", label: "H", scope: "entity", max: "10", summary: "What you can lose." }],
      conditions: [{ id: "c", label: "C", duration: "manual", summary: "You stumble." }],
      campaignFields: { tier: { ...cInt, summary: "How grand the tale is." } },
      codex: { kinds: { npc: { fields: { mood: { type: "text", label: "M", summary: "How they feel." } } } } },
    },
    withFields({ hp: { ...fieldInt, summary: "x".repeat(301) } }),
    withFields({ hp: { ...fieldInt, summary: " " + "x".repeat(300) + " " } }),
    withFields({ hp: { ...fieldInt, summary: "   " } }),
    withFields({ hp: { ...fieldInt, summary: "" } }),
    withFields({ hp: { ...fieldInt, summary: 3 } }),
    withDerived({ id: "a", label: "A", expr: "attr.str", summary: "" }),
    { resources: [{ id: "hp", label: "H", scope: "entity", max: "10", summary: "x".repeat(301) }] },
    { conditions: [{ id: "c", label: "C", duration: "manual", summary: " " }] },
    withCampaign({ tier: { ...cInt, summary: "x".repeat(301) } }),
    { codex: { kinds: { npc: { fields: { mood: { type: "text", label: "M", summary: "" } } } } } },
    { ...cited, conditions: [{ id: "c", label: "C", duration: "manual", summary: "Uncited." }] },
  ];
}

// The notices block (house decision #79): one manifest per check.
function noticesCrafted(): object[] {
  const rule = (over: object = {}) => ({
    id: "low",
    when: "crossed",
    if: "res.hp < 3",
    text: "{name} is low",
    ...over,
  });
  return [
    { notices: [rule(), rule({ id: "spent", when: "sessionStart", entities: ["pc"], if: "secret > 0 && hp > 1" })] },
    { notices: [] },
    { notices: [rule(), rule()] },
    { notices: [rule({ entities: ["nope"] })] },
    { entities: [pcBase, { ...pcBase, id: "gear", base: "item" }], notices: [rule({ entities: ["gear"] })] },
    { notices: [rule({ when: "turnStart" })] },
    { notices: [rule({ text: "x".repeat(120) })] },
    { notices: [rule({ text: "x".repeat(121) })] },
    { notices: [rule({ text: "" })] },
    { notices: [rule({ if: "1" })] },
    { notices: [rule({ if: "nope > 1" })] },
    { notices: Array.from({ length: 51 }, (_, i) => rule({ id: `r${i}` })) },
    // House decision #168: params, a group, a number that rises, a ledger actor's play.
    { notices: [rule({ params: { left: "res.hp", hidden: "secret" }, text: "{name} has {left}" })] },
    { notices: [rule({ params: { name: "res.hp" } })] },
    { notices: [rule({ params: Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((k) => [k, "1"])) })] },
    { notices: [rule({ params: { x: "nope + 1", y: "1 +" } })] },
    { notices: [rule({ group: "every", text: "All are low" }), rule({ id: "any", group: "any", text: "One is low" })] },
    { notices: [rule({ group: "every", params: { x: "1" }, rises: "res.hp" })] },
    { notices: [rule({ group: "all" })] },
    { notices: [rule({ rises: "res.hp", params: { hp: "res.hp" }, text: "{name} rose to {hp}" })] },
    // House decision #174: a rising rule's params read how far it rose; any other rule's do not.
    { notices: [rule({ rises: "10 - res.hp", params: { dn: "ctx.rose + 1" }, text: "{name}: DN {dn}" })] },
    { notices: [rule({ params: { dn: "ctx.rose + 1" }, text: "{name}: DN {dn}" })] },
    { notices: [rule({ rises: "res.hp", params: { dn: "ctx.nope" }, text: "{name}: DN {dn}" })] },
    { notices: [rule({ when: "sessionStart", rises: "res.hp" }), rule({ id: "b", rises: "res.hp > 1" })] },
    { notices: [rule({ if: "build.xpSpent > 1" })] },
    {
      ...SAMPLE_LEDGER_RULESET,
      notices: [
        {
          id: "rank",
          when: "crossed",
          if: "build.xpSpent - build.xpAtAscension >= 10",
          rises: "floor(build.xpSpent, 10)",
          params: { rank: "floor(build.xpSpent, 10)" },
          text: "{name} reached Rank {rank}",
          cite: "p1",
        },
      ],
    },
    {
      sources: [{ id: "s", title: "T", license: "srd" }],
      resources: [{ id: "hp", label: "H", scope: "entity", max: "10", cite: "p1" }],
      initiative: undefined,
      notices: [rule(), rule({ id: "cited", cite: "p2" })],
    },
  ];
}

/** Reminders, a condition's line, arming, immunity and refused rests (house decision #81): every check. */
function reminderCrafted(): object[] {
  const cond = (over: object) => ({ conditions: [{ id: "c", label: "C", duration: "ownTurnEnd", ...over }] });
  const states = { health: { states: [{ id: "down", when: "res.hp <= 0" }] } };
  const cited = { sources: [{ id: "s", title: "T", license: "srd" }] };
  return [
    { reminders: [{ id: "r", at: "turnStart", text: "Go" }] },
    { reminders: [{ id: "r", at: "roundEnd", text: "Go", if: "held && round > 1 && !barred && attr.str > 2" }] },
    { reminders: [{ id: "r", at: "turnEnd", text: "Go", if: "res.hp" }] },
    { reminders: [{ id: "r", at: "turnEnd", text: "Go", if: "nope > 1" }] },
    { reminders: [{ id: "r", at: "later", text: "Go" }] },
    { reminders: [{ id: "r", at: "turnEnd", text: "" }] },
    { reminders: [{ id: "r", at: "turnEnd", text: "x".repeat(121) }] },
    {
      reminders: [
        { id: "r", at: "turnEnd", text: "x".repeat(120) },
        { id: "r", at: "roundEnd", text: "y" },
      ],
    },
    { ...cited, reminders: [{ id: "r", at: "turnEnd", text: "Go" }] },
    { reminders: Array.from({ length: 101 }, (_, i) => ({ id: `r${i}`, at: "turnEnd", text: "Go" })) },
    cond({ at: "turnEnd", text: "Burn" }),
    cond({ at: "turnEnd" }),
    cond({ text: "Burn" }),
    cond({ from: "nextOwnTurn" }),
    cond({ from: "nextOwnTurn", duration: "roundEnd" }),
    cond({ from: "lastTurn" }),
    cond({ immune: "attr.str >= 3" }),
    cond({ immune: "attr.str" }),
    cond({ immune: "round > 1" }),
    // House decision #174: an immunity and a reminder read only on some actor types.
    cond({ immune: { if: "attr.str >= 3", entities: ["pc"] } }),
    cond({ immune: { if: "attr.str >= 3", entities: ["nope"] } }),
    cond({ immune: { if: "attr.str >= 3" } }),
    cond({ immune: { if: "attr.str >= 3", entities: [] } }),
    { reminders: [{ id: "r", at: "turnEnd", text: "Go", if: "attr.str > 2", entities: ["pc"] }] },
    { reminders: [{ id: "r", at: "turnEnd", text: "Go", entities: ["pc"] }] },
    { reminders: [{ id: "r", at: "turnEnd", text: "Go", if: "attr.str > 2", entities: ["nope"] }] },
    { ...states, rests: [{ event: "longRest", refusedIn: ["down"] }] },
    { ...states, rests: [{ event: "longRest", refusedIn: ["nope", "down"] }] },
    { ...states, rests: [{ event: "longRest", refusedIn: [] }] },
    { ...states, rests: [{ event: "nap", refusedIn: ["down"] }] },
    {
      ...states,
      rests: [
        { event: "longRest", refusedIn: ["down"] },
        { event: "longRest", refusedIn: ["down"] },
      ],
    },
    { ...states, ...cited, rests: [{ event: "shortRest", refusedIn: ["down"] }] },
    {
      initiative: { strategy: "sides", sides: sideList(2), setup: { note: "Set the scene." } },
    },
    { initiative: { strategy: "sides", sides: sideList(2), setup: { note: "" } } },
    { initiative: { strategy: "sides", sides: sideList(2), setup: { note: "x".repeat(201) } } },
  ];
}

// The engine's codex kinds are core-schema's, which the engine cannot import (house decision #71).
if (JSON.stringify(CodexEntryKind.options) !== JSON.stringify(CodexKind.options))
  throw new Error("rules-engine CodexEntryKind and core-schema CodexKind differ");

// `health.harm` with random changes, so the two schemas and semantic passes are held equal beyond the crafted cases.
MANIFESTS.push(harmManifest());

// Spends (house decision #84): the harm fixture's, and crafted problems on the skirmish fixture's (already listed).
MANIFESTS.push(SAMPLE_HARM);

function spendCrafted(): object[] {
  const spend = (over: Record<string, unknown>) => ({
    ...SAMPLE_SKIRMISH,
    spends: [{ id: "x", label: "X", cite: "p.1", cost: [], ...over }],
  });
  return [
    spend({ cost: [{ pool: "hp", amount: "1" }, { resource: "momentum", amount: "1" }, { amount: "1" }] }),
    spend({
      cost: [
        { pool: "momentum", resource: "hp", amount: "1" },
        { pool: "nope", amount: "true" },
      ],
    }),
    spend({ inputs: { self: { label: "S", min: 0, max: "1" }, n: { label: "N", min: 2, max: "attr.str" } } }),
    spend({
      inputs: {
        a: { label: "A", min: 0, max: "1" },
        b: { label: "B", min: 0, max: "1" },
        c: { label: "C", min: 0, max: "1" },
        d: { label: "D", min: 0, max: "1" },
      },
    }),
    spend({
      run: [
        { primitive: "health.harm", op: "hit", input: {} },
        { primitive: "dice.sumVsTarget", op: "resolve", input: {} },
      ],
    }),
    spend({
      run: [
        { primitive: "initiative.sides", op: "fly", input: {} },
        { primitive: "initiative.sides", op: "seize", input: { who: "ctx.self", id: "ctx.nope" } },
      ],
    }),
    spend({
      run: [
        { primitive: "resource.capped", op: "adjust", input: { actorId: "ctx.self", resource: '"hp"', delta: -1 } },
      ],
    }),
    spend({ if: "ctx.fight.round", clearOn: ["encounterEnd", "encounterEnd"], entities: ["lineage", "nope"] }),
    spend({ cite: undefined, label: "", id: "Bad" }),
    // House decision #91: a limit, and the table a spend opens next.
    spend({ limit: { per: "turn", max: 0 }, then: { table: "nope", inputs: { extra: "nope", Bad: 1 } } }),
    spend({
      inputs: { n: { label: "N", min: 0, max: "1" } },
      limit: { per: "round", max: 11 },
      then: { table: "backlash", inputs: { extra: "n" } },
    }),
    // House decision #169: a round clears asks, and the table is offered only while its own `if` holds.
    spend({
      inputs: { n: { label: "N", min: 0, max: "1" } },
      clearOn: ["roundEnd", "sessionStart", "sessionEnd", "encounterEnd"],
      then: { table: "backlash", inputs: { extra: "n" }, if: "ctx.n == 1 && ctx.fight.on" },
    }),
    spend({ then: { table: "backlash", if: "1" }, clearOn: ["roundStart"] }),
    spend({ then: { table: "backlash", if: "nope" } }),
    // The key names one of the table's inputs, the value one of the spend's (house decision #91).
    spend({
      inputs: { n: { label: "N", min: 0, max: "1" } },
      then: { table: "backlash", inputs: { extra: "n", nope: "n", spare: "gone" } },
    }),
    {
      ...SAMPLE_SKIRMISH,
      entities: SAMPLE_SKIRMISH.entities.map((e) => ({
        ...e,
        fields: { ...e.fields, held: { type: "list", label: "H", chips: "yes", picks: { entity: "nope" } } },
      })),
    },
    // House decision #171: quick picks from a list of the actor's own saved sheet, as a strike's means.
    ...[
      { from: "ledger", lines: "powers" },
      { from: "ledger", lines: "talents" },
      { from: "list", lines: "powers" },
      { from: "ledger" },
      { entity: "hero", from: "ledger", lines: "weapons" },
    ].flatMap((picks) =>
      [SAMPLE_SKIRMISH, SAMPLE_LEDGER_RULESET].map((r) => ({
        ...r,
        entities: r.entities.map((e) => ({
          ...e,
          fields: { ...e.fields, held: { type: "list", label: "H", chips: true, picks } },
        })),
      })),
    ),
    { ...SAMPLE_SKIRMISH, requests: { max: 0 } },
    { ...SAMPLE_SKIRMISH, spends: [...(SAMPLE_SKIRMISH.spends ?? []), ...(SAMPLE_SKIRMISH.spends ?? []).slice(0, 1)] },
  ];
}

// The `header` block (house decision #109): what is valid, and each refusal at its path.
function headerCrafted(): object[] {
  const fields = withCampaign({ danger: cInt, mood: { ...cInt, label: "M" }, a: cInt, b: cInt });
  const h = (header: unknown, over: object = {}) => ({ ...fields, header, ...over });
  return [
    h({ fields: ["danger"], round: true }),
    h({ fields: ["danger", "mood", "a"] }),
    h({ fields: ["constructor"] }),
    h({ round: true }),
    h({}),
    h({ fields: ["nope"] }),
    h({ fields: ["danger", "danger"] }),
    h({ fields: ["danger", "mood", "a", "b"] }),
    h({ fields: [] }),
    h({ fields: ["Bad id"] }),
    h({ round: true }, { initiative: undefined }),
    h({ round: false }),
    h({ fields: ["danger"] }, { campaignFields: undefined }),
    h({ fields: ["danger", "danger"], round: true }, { initiative: undefined }),
  ];
}

// Strikes (house decision #99): the duel fixture's, and crafted problems on the harm fixture's and the skirmish's.
MANIFESTS.push(SAMPLE_DUEL);

// Panels (house decision #114): what the validator and the compiler refuse, each once, on the harm fixture without
// its layout, and the panel widget's rows; a phone strip's rows (#115).
function panelCrafted(): object[] {
  const [incoming, hit] = SAMPLE_HARM.panels as unknown as [Record<string, unknown>, Record<string, unknown>];
  const panel = (...panels: Record<string, unknown>[]) => ({ ...SAMPLE_HARM, layout: {}, panels });
  const turn = (...phoneTurn: object[]) => ({ ...SAMPLE_HARM, layout: { hero: { sections: [], phoneTurn } } });
  return [
    panel(incoming, incoming),
    panel({ ...incoming, id: "Bad", label: "", cite: undefined, entities: ["nope", "growth"] }),
    panel({ ...incoming, holds: "nope", unless: "hurt", opensOn: { rises: "nope" } }),
    panel({ ...hit, opensOn: { rises: "momentum" }, spends: ["endure", "nope"] }, { ...hit, id: "h2", spends: [] }),
    {
      ...panel({ ...hit, opensOn: { rises: "momentum" } }),
      resources: [...SAMPLE_HARM.resources!, { id: "momentum", label: "M", scope: "party", max: "3", cite: "p.1" }],
    },
    panel(
      { ...incoming, options: { entry: "nope" } },
      { ...incoming, id: "o2", options: { entry: "stance", group: "kind", needs: "nope" } },
    ),
    panel({
      ...incoming,
      options: { entry: "stance", group: "gist", needs: "gist", usable: 'entry.gist == "x" && grit > 1' },
    }),
    panel(
      { ...incoming, options: { entry: "stance", usable: "entry.nope" } },
      { ...incoming, id: "o3", options: { entry: "nope", usable: "1" } },
    ),
    panel({ id: "empty", label: "E", cite: "p.1" }),
    panel({ ...incoming, lines: Array.from({ length: 11 }, () => ({ text: "x" })), figures: [], spends: [] }),
    panel({ ...incoming, when: 'ctx.fight.acting && ctx.fight.held && ctx.fight.foeActing && ctx.self == "x"' }),
    panel({
      ...incoming,
      when: "grit",
      lines: [{ text: "x", when: "hide > 0" }, { text: "" }],
      figures: [{ label: "F", expr: "gone" }],
    }),
    panel({ ...incoming, entities: undefined, when: "res.resolve > 0" }),
    { ...SAMPLE_HARM, panels: Array.from({ length: 21 }, (_, i) => ({ ...incoming, id: `p${i}` })), layout: {} },
    turn(
      { widget: "panel" },
      { widget: "panel", variant: "nope" },
      { widget: "panel", variant: "hit", bind: { a: "grit" } },
    ),
    turn({ widget: "spends" }, { widget: "spends", variant: "x" }, { widget: "spends", bind: { x: "grit" } }),
    { ...SAMPLE_HARM, layout: { sheet: { sections: [], phoneTurn: [{ widget: "panel", variant: "hit" }] } } },
    {
      ...SAMPLE_HARM,
      layout: { hero: { sections: [], phoneStrip: [{ widget: "frames", bind: { values: ["nope", "grit"] } }, "x"] } },
    },
    // House decision #180: the acting foe of a type, the items carried, and a shared pool on the strip; each refusal.
    panel({ ...incoming, foe: "swarm", lines: [{ text: "x", when: "ctx.foe.size > 1 && ctx.foe.res.wounds >= 0" }] }),
    panel({ ...incoming, foe: "nope" }, { ...incoming, id: "f2", foe: "growth" }),
    panel({ ...incoming, foe: "swarm", lines: [{ text: "x", when: "ctx.foe.hide > 1" }] }),
    panel({ ...incoming, lines: [{ text: "x", when: "ctx.foe.size > 1" }] }),
    panel({ ...incoming, options: { entry: "stance", usable: 'contains(ctx.carried.carried, "maul")' } }),
    panel({ ...incoming, options: { entry: "stance", usable: 'contains(ctx.carried.nope, "maul")' } }),
    panel({ ...incoming, when: 'contains(ctx.carried.carried, "maul")' }),
    {
      ...SAMPLE_HARM,
      resources: [
        ...SAMPLE_HARM.resources!,
        { id: "momentum", label: "M", scope: "party", max: "3", cite: "p.1", visibility: "party" },
      ],
      layout: { hero: { sections: [], phoneStrip: ["pools.momentum", "pools.wounds", "pools.nope", "pools."] } },
    },
  ];
}

function strikeCrafted(): object[] {
  const blow = SAMPLE_HARM.strikes![0]!;
  // 0.1.6: its layout names no strike but the blow, which each case below replaces.
  const strike = (over: Record<string, unknown>, base: Record<string, unknown> = SAMPLE_HARM_BEFORE_OWNER) => ({
    ...base,
    strikes: [{ ...blow, ...over }],
  });
  return [
    strike({ id: "Bad", cite: undefined, label: "" }),
    strike({ means: [{ from: "nope" }], values: { a: { key: "", type: "text" } } }),
    strike({
      means: [
        { from: "ledger", lines: "armour" },
        { from: "list", field: "Bad", entry: "x" },
      ],
    }),
    strike({
      means: [
        { from: "ledger", lines: "weapons" },
        { from: "list", field: "grit", entry: "nope" },
      ],
    }),
    strike({ means: undefined }),
    // A held item as the means (house decision #95): a kind the ruleset declares and an attacker holds.
    ...[["hero"], ["brute"]].map((entities) => ({
      ...strike({
        means: [
          { from: "items", kind: "arms" },
          { from: "items", kind: "nope" },
        ],
      }),
      items: { kinds: [{ id: "arms", label: "Arms", entry: "arm", entities, card: "weapons", cite: "Sample p.17" }] },
    })),
    strike({ means: [{ from: "items" }, { from: "items", kind: "Bad" }] }),
    // Further numbers and text values (sample-harm 0.1.5).
    strike({ shows: [blow.shows![0], { ...blow.shows![0], label: "Again" }] }),
    strike({ shows: Array.from({ length: 7 }, (_, i) => ({ ...blow.shows![0], id: `n${i}` })) }),
    strike({
      shows: [{ id: "Bad", label: "", expr: "ctx.means.traits", adds: [{ label: "X", by: "1", when: "ctx.far" }] }],
    }),
    strike({ pool: { label: "P", expr: "derived.might", adds: [{ label: "T", by: "ctx.means.traits" }] } }),
    strike({ values: { traits: { key: "traits", type: "list" } } }),
    strike({
      inputs: [
        { id: "aim", label: "A", type: "bool", min: 0 },
        { id: "aim", label: "B", type: "int", min: 3, max: 1 },
        { id: "soak", label: "C", type: "int" },
      ],
    }),
    // A choice, the owner's flag and the per-round count (house decision #113).
    strike({
      inputs: [
        { id: "aim", label: "A", type: "choice", min: 0 },
        { id: "far", label: "B", type: "int", options: [{ label: "X", value: 1 }] },
        {
          id: "c",
          label: "C",
          type: "choice",
          options: [
            { label: "X", value: 1 },
            { label: "Y", value: 1 },
            { label: "", value: 1.5 },
          ],
        },
        {
          id: "d",
          label: "D",
          type: "choice",
          options: Array.from({ length: 11 }, (_, i) => ({ label: "O", value: i })),
        },
      ],
    }),
    strike({ byOwner: false, limit: { per: "turn", max: 0 } }),
    strike({ byOwner: true, limit: { per: "round", max: 11 } }),
    strike({
      byOwner: true,
      limit: { per: "round", max: 2 },
      inputs: [
        { id: "aim", label: "Aim", type: "bool" },
        {
          id: "far",
          label: "Far",
          type: "choice",
          options: [
            { label: "Near", value: 0 },
            { label: "Far", value: 2 },
          ],
        },
      ],
      beat: {
        label: "B",
        expr: "ctx.target.derived.guard",
        adds: [{ label: "Far", when: "ctx.far > 1", by: "ctx.far" }],
      },
    }),
    strike({
      outcomes: [
        { id: "a", label: "A", when: "ctx.total" },
        { id: "a", label: "A", when: "true", shock: "ctx.nope" },
        { id: "b", label: "B", when: 'ctx.outcome == "a"', wounds: "true" },
      ],
    }),
    strike({ pool: { label: "P", expr: "grit", adds: [{ label: "X", by: "ctx.aim", when: "1" }] } }),
    strike({ beat: { label: "B", expr: "ctx.target.hide" }, soak: { label: "S", expr: "ctx.total" } }),
    strike({ notes: [{ text: "N", when: "ctx.outcome" }, { text: "" }], then: { table: "nope", inputs: { a: "b" } } }),
    strike({ then: { table: "blow", inputs: { past: "far", surge: "nope", nope: "aim" } } }),
    strike({ entities: ["arm", "nope"], targets: ["swarm", "arm"] }),
    strike({ targets: ["hero"], entities: ["brute"], pool: { label: "P", expr: "hide" } }),
    // A ruleset without harm: a hit is refused; one with harm but no shock refuses shock.
    strike({}, { ...SAMPLE_HARM, health: { states: [] }, tables: undefined, spends: undefined }),
    strike({ outcomes: [{ id: "a", label: "A", when: "true", shock: "1" }] }, SAMPLE_DUEL),
    { ...SAMPLE_HARM, strikes: [blow, blow] },
    // The strike widget names a kind, and every type it is laid out for strikes with it.
    {
      ...SAMPLE_HARM,
      layout: {
        hero: { sections: [], phoneTurn: [{ widget: "strike" }, { widget: "strike", variant: "nope" }] },
        brute: { sections: [], trackerRow: [{ widget: "strike", variant: "blow" }] },
      },
      strikes: [{ ...blow, entities: ["hero"] }],
    },
  ];
}

// The `game` block: a homebrew ruleset needs no cite for gmless or solo, the others do (principle 1).
// The mutations turn the license to `srd` and the modes around, which reach the cite rule.
MANIFESTS.push({
  ...MINIMAL,
  game: { title: "Table", family: "Test", genres: ["a"], players: { min: 1, max: 4 }, modes: ["gm", "gmless", "solo"] },
});

// Every effect mode, effects that read each other, and a max that can fall below its min, for the derive vectors.
MANIFESTS.push({
  ...MINIMAL,
  entities: [
    {
      ...pcBase,
      fields: { ...pcBase.fields, capped: { label: "C", type: "int", visibility: "public", min: 0, max: 9 } },
      derived: [
        { id: "a", label: "A", expr: "attr.str", visibility: "public" },
        { id: "b", label: "B", expr: "derived.a + capped", visibility: "public" },
      ],
    },
  ],
  resources: [
    {
      id: "hp",
      label: "H",
      scope: "entity",
      min: "attr.dex",
      max: "attr.str",
      resetOn: [
        { event: "longRest", to: "max" },
        { event: "shortRest", to: "min" },
      ],
    },
  ],
  conditions: [
    {
      id: "c",
      label: "C",
      duration: "manual",
      visibility: "public",
      effects: [
        { path: "capped", mode: "multiply", value: "2" },
        { path: "hp", mode: "downgrade", value: "attr.str" },
        { path: "derived.a", phase: "derived", mode: "multiply", value: "3" },
        { path: "derived.b", phase: "derived", mode: "add", value: "derived.a", priority: 1 },
        {
          path: "derived.a",
          phase: "derived",
          mode: "upgrade",
          value: "derived.b",
          priority: 2,
          when: "derived.a > 0",
        },
      ],
    },
    {
      id: "d",
      label: "D",
      duration: "manual",
      visibility: "public",
      effects: [{ path: "capped", mode: "override", value: "attr.dex", priority: -1 }],
    },
  ],
});

function manifestVectors() {
  const cases: unknown[] = [];
  const one = (manifest: unknown) => {
    const r = compileRuleset(manifest);
    cases.push(
      r.ok ? { manifest, ok: true, compiled: compiledView(r.compiled) } : { manifest, ok: false, problems: r.problems },
    );
  };
  for (const base of MANIFESTS) {
    one(base);
    const strings = [...MANIFEST_STRINGS, ...allStrings(base, [])];
    const size = (JSON.stringify(base) ?? "").length;
    // A smaller manifest gets more cases, so the rules it alone reaches stay covered without a huge file.
    for (let i = 0; i < Math.min(2500, Math.floor(4_000_000 / size)); i++) {
      let m = base;
      for (let n = 1 + rnd(2); n > 0; n--) m = mutate(m, strings);
      one(m);
    }
  }
  // Each rule a manifest can break, since random changes rarely reach most of them.
  for (const over of CRAFTED) one({ ...MINIMAL, ...over });
  one({ ...(SAMPLE_D20 as object), terms: { big: "x".repeat(60), pad: Array.from({ length: 1 }, () => "y") } });
  one({
    ...(SAMPLE_D20 as object),
    decisions: Array.from({ length: 150 }, (_, i) => ({ id: `d${i}`, text: "é".repeat(1000) })),
  });
  one({
    ...(SAMPLE_D20 as object),
    decisions: Array.from({ length: 300 }, (_, i) => ({ id: `d${i}`, text: "é".repeat(999) })),
  });
  one({ ...(SAMPLE_D20 as object), terms: { __proto__x: "a", ["__proto__"]: "b" } });
  // The ledger builder's block (house decision #62): every check, then random changes on a stream of their own, so
  // the cases above and every generator after this one stay as they were.
  for (const change of LEDGER_CHANGES) {
    const m = structuredClone(SAMPLE_LEDGER_RULESET) as Mutable;
    change(m);
    one(m);
  }
  const saved = seed;
  seed = 62;
  const strings = [...MANIFEST_STRINGS, ...allStrings(SAMPLE_LEDGER_RULESET, [])];
  for (let i = 0; i < 600; i++) one(mutate(SAMPLE_LEDGER_RULESET, strings));
  seed = saved;
  return cases;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the changes break the shape on purpose
type Mutable = Record<string, any>;

/** One change per check of the build block, the first none at all. */
const LEDGER_CHANGES: ((m: Mutable) => void)[] = [
  () => {},
  // The widgets that read the saved build's sheet (house decision #83).
  (m) =>
    (m.layout = {
      hero: {
        sections: [
          {
            id: "k",
            label: "K",
            show: [
              { widget: "cards", variant: "powers" },
              { widget: "folds", variant: "talents" },
            ],
          },
        ],
      },
    }),
  (m) => (m.build.params.startingXp.perTier = -1),
  (m) => (m.build.params.tiers = { min: 3, max: 2 }),
  (m) => (m.build.params.vocabulary.mods = [{ key: "guard" }]),
  (m) => (m.build.strategy = "steps"),
  (m) => (m.build.libraryLine = "species"),
  (m) => (m.build.libraryLine = "talents"),
  (m) => delete m.build.libraryLine,
  (m) => (m.build.actor = "wargear"),
  (m) => (m.build.actor = "nope"),
  (m) => (m.build.kinds.powers = "nope"),
  (m) => (m.build.kinds.languages = "hero"),
  (m) => (m.build.kinds.wargear = "keyword"),
  (m) => delete m.build.kinds["sub-factions"],
  (m) => delete m.build.sheet.attributes.MGT,
  (m) => (m.build.sheet.skills.Juggle = "skill.lore"),
  (m) => (m.build.sheet.mods.grit = "nope"),
  (m) => (m.build.sheet.mods["Bad Key!".repeat(10)] = "nope"),
  (m) => (m.build.sheet.attributes.AGI = "species"),
  (m) => (m.build.sheet.species = "xp"),
  (m) => (m.build.sheet.archetype = "keywords"),
  (m) => (m.build.sheet.keywords = "speed"),
  (m) => (m.build.sheet.powered = "attr.mgt"),
  (m) => (m.resources[0].entities = ["wargear"]),
  (m) => (m.resources[1].scope = "party"),
  (m) => (m.build.sheet.corruption = "nope"),
  (m) => (m.build.tier = "rank"),
  (m) => (m.campaignFields.tier = { type: "bool", label: "Tier", default: false, cite: "Base p.2" }),
  (m) => (m.campaignFields.tier.max = 5),
  (m) => (m.campaignFields.tier.min = 0),
  (m) => (m.build.xp = "species"),
  (m) => (m.build.xp = "nope"),
  (m) => {
    delete m.build.xp;
    delete m.build.sheet.wealth;
    delete m.build.sheet.corruption;
  },
  (m) => delete m.build.cite,
  (m) => {
    m.creation = [{ id: "name", actor: "hero", kind: "fields", label: "Name", fields: ["species"], cite: "Base p.1" }];
  },
  // Play after creation (house decision #64).
  (m) => {
    delete m.build.ascension;
    delete m.build.gone;
    delete m.build.award;
  },
  (m) => (m.build.gone = ["nope", "lost", "lost"]),
  // What a build over a hand-made sheet keeps (house decision #96).
  (m) => (m.build.keep = { fields: ["nope", "armourRating"], resources: ["corruption", "nope"] }),
  (m) => (m.build.keep = {}),
  (m) => (m.build.keep = { fields: Array.from({ length: 51 }, () => "xp") }),
  (m) => delete m.build.keep,
  // House decision #199: a field kept as the greater number or merged as a list, and the path a type with both takes.
  (m) =>
    (m.build.keep = { fields: ["armourRating"], greater: ["armourRating", "species", "nope"], merge: ["keywords"] }),
  (m) => (m.build.keep = { greater: ["armourRating"], merge: ["armourRating", "keywords", "keywords"] }),
  (m) => (m.build.first = "steps"),
  (m) => (m.build.first = "build"),
  (m) => (m.build.first = "nope"),
  (m) => {
    m.creation = [{ id: "name", actor: "hero", kind: "fields", label: "Name", fields: ["species"], cite: "Base p.1" }];
    m.build.first = "steps";
  },
  // The GM's override of a derived value (house decision #96).
  (m) => (m.entities[0].derived[0].override = "species"),
  (m) => (m.entities[0].derived[0].override = "nope"),
  (m) => (m.entities[0].fields.guardSet.visibility = "gm"),
  (m) => delete m.entities[0].derived[0].override,
  (m) => (m.build.gone = Array.from({ length: 11 }, () => "lost")),
  (m) => (m.build.gone = []),
  (m) => {
    m.entities.push({ id: "rival", label: "Rival", base: "actor", fields: {} });
    m.health.states.push({ id: "routed", when: "true", entities: ["rival"] }, { id: "any", when: "true" });
    m.build.gone = ["routed", "any"];
  },
  (m) => {
    m.build.actor = "nope";
    m.build.gone = ["nope"];
    m.build.award.suggested = [60];
  },
  (m) => (m.build.ascension = { xp: 0, cite: "Base p.30" }),
  (m) => (m.build.ascension = { xp: 1.5, cite: "Base p.30" }),
  (m) => (m.build.ascension = { xp: 1 }),
  (m) => (m.build.award.suggested = [0, 5, 5, 3, 50, 51]),
  (m) => (m.build.award.suggested = [1, 2, 3, 4, 5, 6, 7]),
  (m) => (m.build.award.suggested = [-1]),
  (m) => (m.build.award.suggested = []),
  (m) => (m.build.award = { max: 0, suggested: [], cite: "Base p.31" }),
  (m) => (m.build.award = { max: 1001, suggested: [1000], cite: "Base p.31" }),
  (m) => (m.build.award = { max: 1000, suggested: [1000] }),
];

/**
 * Packs with catalogue records (house decision #62), against the ledger ruleset and one without build. The input is
 * read by Go in its key order, and each record answered is compared as text, so its key order is held equal.
 */
function ledgerPackVectors() {
  const rulesets = [SAMPLE_LEDGER_RULESET, SAMPLE_D20];
  const compiled = rulesets.map((m) => {
    const r = compileRuleset(m);
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    return r.compiled.ruleset;
  });
  const cases: unknown[] = [];
  const one = (rulesetIndex: number, input: unknown) => {
    const r = validatePack({ input, ruleset: compiled[rulesetIndex] as Ruleset });
    cases.push({
      ruleset: rulesetIndex,
      input,
      ok: r.ok,
      ...(r.ok
        ? {
            pack: r.pack,
            hashes: r.pack.entries.map(contentHash),
            records: r.pack.entries.map((e) => (e.record === undefined ? null : JSON.stringify(e.record))),
          }
        : { problems: r.problems }),
    });
  };
  const pack = () => structuredClone(SAMPLE_LEDGER_PACK) as Mutable;
  const at = (p: Mutable, key: string) => p.entries.find((e: Mutable) => e.key === key);
  const reversed = (o: Mutable): Mutable => Object.fromEntries(Object.entries(o).reverse());
  one(0, SAMPLE_LEDGER_PACK);
  // Keys arrive in another order than the schemas', inner records (partial records of Attributes) included.
  const shuffled = pack();
  for (const e of shuffled.entries) {
    if (e.record === undefined) continue; // the stores carry no record (house decision #95)
    e.record = reversed(e.record);
    for (const [k, v] of Object.entries(e.record))
      if (typeof v === "object" && v !== null && !Array.isArray(v)) e.record[k] = reversed(v as Mutable);
  }
  one(0, shuffled);
  const changes: ((p: Mutable) => void)[] = [
    (p) => p.entries.push({ key: "x", type: "hero", name: "X", cite: "Base p.1", record: { id: "x" } }),
    (p) => delete at(p, "factions.wardens").record,
    (p) => (at(p, "factions.wardens").record = []),
    (p) => (at(p, "factions.wardens").record = "x"),
    // Not page 0: the Go twin words a refused .positive() as ">=1" where zod says ">0" (reported, left as it is).
    (p) => Object.assign(at(p, "factions.wardens").record, { page: "x", source: "nope" }),
    (p) => delete at(p, "factions.wardens").record.name,
    (p) => Object.assign(at(p, "factions.wardens"), { key: "old-wardens", name: "Wardens of Old" }),
    // The key is free of the record's id; an id is unique within its type only.
    (p) => (at(p, "factions.wardens").key = "anything-else"),
    (p) => p.entries.push({ ...at(p, "factions.wardens"), key: "factions.wardens-again" }),
    // A catalogue record is never GM-only (house decision #63), the default visibility included.
    (p) => (at(p, "factions.wardens").visibility = "gm"),
    (p) => delete at(p, "factions.wardens").visibility,
    (p) => (at(p, "factions.wardens").visibility = "party"),
    (p) => {
      const wardens = at(p, "factions.wardens");
      p.entries.push({ ...wardens, key: "talents.wardens", type: "talent", record: { ...wardens.record, xp: 1 } });
    },
    (p) => (at(p, "factions.wardens").record.summary = "x".repeat(MAX_ENTRY_RECORD_BYTES)),
    (p) => (at(p, "factions.wardens").record.summary = "é".repeat(MAX_ENTRY_RECORD_BYTES / 2)),
    (p) => (at(p, "wargear.lantern-staff").record.weapon.range = "far"),
    (p) => (p.entries = p.entries.filter((e: Mutable) => e.type === "talent")),
    // A fitting's effect on its host's card (house decision #102): a value of the card, added or overridden, read of
    // nothing.
    ...[
      { path: "host.ap", mode: "override", value: "-2" },
      { path: "host.ar", mode: "add", value: "1" },
      { path: "host.nope", mode: "add", value: "1" },
      { path: "host.damage", mode: "multiply", value: "2" },
      { path: "host.damage", mode: "add", value: "armourRating" },
      { path: "host.damage", mode: "add", value: "1", when: "true" },
      { path: "host.damage", mode: "add", value: "1", when: "1" },
      // A Trait of the host (house decision #198): a word with no bracket or comma, gained, re-rated or set.
      { path: "host.trait.Keen", mode: "upgrade", value: "1" },
      { path: "host.trait.Rapid Fire", mode: "add", value: "-1" },
      { path: "host.trait.Heavy", mode: "override", value: "0" },
      { path: "host.trait.Heavy", mode: "multiply", value: "2" },
      { path: "host.trait.Heavy (2)", mode: "upgrade", value: "1" },
      { path: "host.trait. Heavy", mode: "upgrade", value: "1" },
      { path: "host.trait.", mode: "upgrade", value: "1" },
      { path: "host.trait.Keen", mode: "upgrade", value: "armourRating" },
      { path: "host.trait.Keen", mode: "upgrade", value: "1", when: "true" },
    ].map((eff) => (p: Mutable) => (at(p, "wargear.sight-lens").effects = [eff])),
    (p) => (at(p, "wargear.lantern-staff").effects = [{ path: "host.damage", mode: "add", value: "1" }]),
  ];
  for (const change of changes) {
    const p = pack();
    change(p);
    one(0, p);
  }
  one(1, { ...SAMPLE_PACK, entries: [{ ...SAMPLE_PACK.entries[0], record: { id: "reedfolk" } }] });
  one(1, SAMPLE_PACK);
  return { rulesets, cases };
}

function genFieldValue(def: FieldDef): FieldValue | undefined {
  if (rnd(8) === 0) return undefined;
  if (rnd(12) === 0) return pick<FieldValue>(["x", 3, true, null, ["a"]]);
  switch (def.type) {
    case "int":
      return rnd(41) - 15;
    case "bool":
      return rnd(2) === 0;
    case "list":
      return ["a", "b"].slice(0, rnd(3));
    case "enum":
      return pick(def.values);
    default:
      return pick(["str", "dex", "fighter", "x"]);
  }
}

// What a campaign stores for a declared field: usually nothing, a fitting value, or a wrong or unknown one.
function genStored(c: CompiledRuleset): Record<string, unknown> {
  const stored: Record<string, unknown> = {};
  for (const [id, def] of Object.entries(c.ruleset.campaignFields ?? {})) {
    if (rnd(3) === 0) continue;
    if (rnd(4) === 0) {
      stored[id] = pick<unknown>(["x", 2.5, true, null, 1001, -1001, ["a"]]);
      continue;
    }
    if (def.type === "int") stored[id] = def.min + rnd(def.max - def.min + 1) + (rnd(5) === 0 ? 1 : 0);
    else if (def.type === "enum") stored[id] = pick([...def.values, "zzz"]);
    else stored[id] = rnd(2) === 0;
  }
  if (rnd(4) === 0) stored.unknownId = rnd(9);
  return stored;
}

function deriveVectors() {
  const out: unknown[] = [];
  const attempt = <T>(run: () => T): { value: T } | { error: string } => {
    try {
      return { value: run() };
    } catch (err) {
      return { error: (err as Error).message };
    }
  };
  MANIFESTS.forEach((manifest, manifestIndex) => {
    const r = compileRuleset(manifest);
    if (!r.ok) throw new Error(`fixture ${manifestIndex} does not compile`);
    const c = r.compiled;
    const conditionIds = Object.keys(c.conditions);
    for (const [entity, ce] of Object.entries(c.entities)) {
      for (let i = 0; i < 400; i++) {
        const fields: Record<string, FieldValue> = {};
        for (const [id, def] of Object.entries(ce.def.fields)) {
          const v = genFieldValue(def);
          if (v !== undefined) fields[id] = v;
        }
        const resources = Object.fromEntries(ce.resources.filter(() => rnd(6) !== 0).map((id) => [id, rnd(31) - 5]));
        const conditions = conditionIds.filter(() => rnd(3) === 0);
        // House decision #92: the spawn options an actor took run with its conditions.
        const options = (c.ruleset.spawn?.options ?? []).map((o) => o.id).filter(() => rnd(2) === 0);
        const characters = rnd(7);
        const declared = Object.keys(c.ruleset.campaignFields ?? {}).length > 0;
        const stored = declared ? genStored(c) : undefined;
        const campaign = stored === undefined ? undefined : campaignValues({ compiled: c, stored });
        const values = {
          fields,
          resources,
          conditions,
          options,
          party: { characters },
          ...(campaign === undefined ? {} : { campaign }),
        };
        const base = attempt(() => applyBaseEffects({ compiled: c, entity, values }));
        const derived = attempt(() => deriveValues({ compiled: c, entity, values }));
        const scope = actorScope({
          fields,
          derived: "value" in derived ? derived.value : {},
          resources,
          party: { characters },
          ...(campaign === undefined ? {} : { campaign }),
        });
        out.push({
          ...(stored === undefined ? {} : { stored, campaign }),
          manifest: manifestIndex,
          entity,
          fields,
          resources,
          conditions,
          options,
          characters,
          base,
          derived,
          bounds: Object.keys(c.resources).map((resource) => ({
            resource,
            bounds: attempt(() => resourceBounds({ compiled: c, resource, scope })),
            resets: attempt(() => resetValues({ compiled: c, resource, scope })),
            start: attempt(() => startValue({ compiled: c, resource, scope })),
            death: attempt(() => instantDeathAt({ compiled: c, resource, scope })),
          })),
          states: attempt(() => healthStatesOf({ compiled: c, entity, scope })),
        });
      }
    }
  });
  return out;
}

const sortDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, sortDeep(v)]),
  );
};

/** Entries' effects against the sample, every case written out (no random stream, so the other vectors do not move). */
function entryDeriveVectors() {
  const manifest = 0;
  const r = compileRuleset(SAMPLE_D20);
  if (!r.ok) throw new Error("sample does not compile");
  const attempt = <T>(run: () => T): { value: T } | { error: string } => {
    try {
      return { value: run() };
    } catch (err) {
      return { error: (err as Error).message };
    }
  };
  type Eff = NonNullable<PackEntry["effects"]>[number];
  const add = (path: string, value: string, over: Partial<Eff> = {}): Eff => ({
    path,
    mode: "add",
    value,
    phase: path.startsWith("derived.") ? "derived" : "base",
    ...over,
  });
  const entry = (type: string, key: string, effects: Eff[]) => ({ type, key, name: `Entry ${key}`, effects });
  const hero = { name: "Ash", level: 3, "attr.str": 14, "attr.dex": 16, "attr.con": 12, guard: 11 };
  const swift = entry("lineage", "swift", [add("attr.dex", "2")]);
  const shield = entry("calling", "shield", [add("derived.defense", "3")]);
  const set = (type: string, key: string, over: Partial<Eff> = {}) =>
    entry(type, key, [add("derived.defense", "20", { mode: "override", ...over })]);
  const cases: { entity: string; fields: Record<string, FieldValue>; conditions: string[]; entries: unknown[] }[] = [
    { entity: "character", fields: hero, conditions: [], entries: [] },
    { entity: "character", fields: hero, conditions: [], entries: [swift] },
    { entity: "character", fields: hero, conditions: [], entries: [shield] },
    { entity: "character", fields: hero, conditions: ["dazed", "braced"], entries: [swift, shield] },
    // Equal priority: source ids decide ("aaa/x" < "braced" < "zzz/x").
    { entity: "character", fields: hero, conditions: ["braced"], entries: [set("aaa", "x")] },
    { entity: "character", fields: hero, conditions: ["braced"], entries: [set("zzz", "x")] },
    // Different priority beats source id.
    { entity: "character", fields: hero, conditions: ["braced"], entries: [set("zzz", "x", { priority: -1 })] },
    { entity: "character", fields: hero, conditions: ["braced"], entries: [set("aaa", "x", { priority: 1 })] },
    { entity: "character", fields: hero, conditions: ["braced"], entries: [set("calling", "b"), set("calling", "a")] },
    // A when that is false, then true.
    {
      entity: "character",
      fields: hero,
      conditions: [],
      entries: [entry("calling", "w", [add("derived.defense", "3", { when: "level > 5" })])],
    },
    {
      entity: "character",
      fields: { ...hero, level: 6 },
      conditions: [],
      entries: [entry("calling", "w", [add("derived.defense", "3", { when: "level > 5" })])],
    },
    // An effect that does not fit the actor, one that reads a missing field, one with a multiply and a clamp.
    { entity: "character", fields: hero, conditions: [], entries: [entry("calling", "n", [add("derived.nope", "3")])] },
    { entity: "creature", fields: { name: "W", level: 1, "attr.con": 8 }, conditions: [], entries: [shield] },
    {
      entity: "character",
      fields: hero,
      conditions: [],
      entries: [entry("calling", "m", [add("attr.dex", "-30"), add("derived.maxHp", "2", { mode: "multiply" })])],
    },
    { entity: "character", fields: { ...hero, "attr.dex": null }, conditions: [], entries: [swift] },
    {
      entity: "character",
      fields: hero,
      conditions: [],
      entries: [entry("calling", "e", [add("derived.defense", "attr.nope")])],
    },
    {
      entity: "creature",
      fields: { name: "W", level: 1, "attr.con": 8 },
      conditions: [],
      entries: [entry("calling", "c", [add("derived.maxHp", "level", { mode: "upgrade" })])],
    },
  ];
  return cases.map((x) => {
    const values = {
      fields: x.fields,
      resources: { hp: 9 },
      conditions: x.conditions,
      party: { characters: 4 },
      entries: x.entries as never,
    };
    return {
      manifest,
      ...x,
      resources: values.resources,
      characters: 4,
      base: attempt(() => applyBaseEffects({ compiled: r.compiled, entity: x.entity, values })),
      derived: attempt(() => deriveValues({ compiled: r.compiled, entity: x.entity, values })),
    };
  });
}

function fieldValueVectors() {
  const defs: (FieldDef | CodexField)[] = [
    { label: "F", visibility: "gm", editableBy: "gm", type: "int" },
    { label: "F", visibility: "gm", editableBy: "gm", type: "int", min: -2, max: 5 },
    { label: "F", visibility: "gm", editableBy: "gm", type: "text" },
    { label: "F", visibility: "gm", editableBy: "gm", type: "text", maxLength: 3 },
    { label: "F", visibility: "gm", editableBy: "gm", type: "text", maxLength: 10_000 },
    { label: "F", visibility: "gm", editableBy: "gm", type: "enum", values: ["a", "b"] },
    { label: "F", visibility: "gm", editableBy: "gm", type: "bool" },
    { label: "F", visibility: "gm", editableBy: "gm", type: "ref", entity: "x" },
    { label: "F", visibility: "gm", editableBy: "gm", type: "list" },
    { label: "F", visibility: "gm", editableBy: "gm", type: "list", maxItems: 2 },
    { label: "F", visibility: "party", type: "entry", kind: "location" },
  ];
  // prettier-ignore
  const values: unknown[] = [
    null, true, false, 0, 1, -2, -3, 5, 6, 1.5, 1e300, 2147483647, 2147483648, -2147483648, -2147483649, "", "a", "b", "abc", "abcd", "é😀", "😀😀", "x".repeat(120), "x".repeat(121),
    "x".repeat(10000), "x".repeat(10001), "é".repeat(10001), [], ["a"], ["a", "b"], ["a", "b", "c"], [1], ["a", 1], ["x".repeat(1000)], ["x".repeat(1001)], ["😀".repeat(501)],
    Array.from({ length: 500 }, () => "a"), Array.from({ length: 501 }, () => "a"), {}, { a: 1 },
    "0193a1b2-c3d4-7e5f-8a6b-9c0d1e2f3a4b", "0193A1B2-C3D4-7E5F-8A6B-9C0D1E2F3A4B", "0193a1b2-c3d4-7e5f-8a6b-9c0d1e2f3a4", "0193a1b2-c3d4-9e5f-8a6b-9c0d1e2f3a4b", "00000000-0000-0000-0000-000000000000",
  ];
  // House decision #89: a tags field and a rows field, with values of their own shapes.
  const tags: CodexField[] = [
    { label: "T", visibility: "gm", type: "tags", writeIn: true },
    { label: "T", visibility: "gm", type: "tags", maxItems: 2, options: ["a"], writeIn: false },
  ];
  const rows: CodexField[] = [
    {
      label: "R",
      visibility: "gm",
      type: "rows",
      maxRows: 3,
      columns: [
        { id: "name", label: "N", type: "text", maxLength: 5 },
        { id: "dc", label: "D", type: "int", min: 1, max: 20 },
        { id: "how", label: "H", type: "enum", values: ["low", "high"] },
        { id: "on", label: "O", type: "bool" },
        { id: "who", label: "W", type: "ref", entity: "kin" },
        { id: "test", label: "T", type: "test", each: "skill", inputs: { dn: "1" } },
      ],
      from: [{ entity: "kin", name: "name" }],
    },
    { label: "R", visibility: "party", type: "rows", columns: [{ id: "note", label: "N", type: "text" }] },
  ];
  const row = (extra: Record<string, unknown>) => ({ id: "r1", values: {}, ...extra });
  // prettier-ignore
  const shaped: unknown[] = [
    [], ["a"], ["a", "b"], ["a", "a"], ["A", "a"], [" "], [""], ["x".repeat(60)], ["x".repeat(61)], ["a", "b", "c"], Array.from({ length: 31 }, (_, i) => `w${i}`), [1], "a",
    [row({})], [row({}), row({})], [row({}), row({ id: "r2" }), row({ id: "r3" }), row({ id: "r4" })], Array.from({ length: 31 }, (_, i) => row({ id: `r${i}` })),
    [{ id: "r1" }], [{ values: {} }], [row({ id: "" })], [row({ id: "x".repeat(41) })], [row({ extra: 1 })], [row({ values: [] })], [row({ values: null })],
    [row({ values: { name: "abcde", dc: 20, how: "low", on: true, who: "elf", test: { testId: "check", inputs: { dc: 12, hard: true, how: "x" } } } })],
    [row({ values: { name: "abcdef" } })], [row({ values: { dc: 21 } })], [row({ values: { dc: 1.5 } })], [row({ values: { how: "mid" } })], [row({ values: { on: 1 } })],
    [row({ values: { who: "" } })], [row({ values: { nope: 1, dc: 99 } })], [row({ values: { zz: 1, dc: 99 } })], [row({ values: { note: "x".repeat(500) } })], [row({ values: { note: "x".repeat(501) } })],
    [row({ values: { test: { testId: "check" } } })], [row({ values: { test: { testId: "" } } })], [row({ values: { test: { testId: "c", extra: 1 } } })],
    [row({ values: { test: { testId: "c", inputs: [] } } })], [row({ values: { test: { testId: "c", inputs: { a: null } } } })], [row({ values: { test: { testId: "c", inputs: { a: "x".repeat(101) } } } })],
    [row({ values: { test: "check" } })], [row({ from: { entity: "kin", key: "elf", cite: "Sample p.1" } })], [row({ from: { entity: "kin", key: "elf" } })],
    [row({ from: { entity: "gear", key: "elf" } })], [row({ from: { entity: "kin", key: "" } })], [row({ from: { entity: "kin", key: "elf", cite: "" } })],
    [row({ from: { entity: "kin", key: "elf", page: 1 } })], [row({ from: null })], [row({}), row({})],
    // House decision #173: the column's each input lists words; no other input does, and the list is bounded.
    [row({ values: { test: { testId: "c", inputs: { skill: ["Climb", "Swim"] } } } })], [row({ values: { test: { testId: "c", inputs: { dn: ["Climb"] } } } })],
    [row({ values: { test: { testId: "c", inputs: { skill: [] } } } })], [row({ values: { test: { testId: "c", inputs: { skill: Array.from({ length: 11 }, (_, i) => `s${i}`) } } } })],
    [row({ values: { test: { testId: "c", inputs: { skill: ["x".repeat(101)] } } } })], [row({ values: { test: { testId: "c", inputs: { skill: [1] } } } })],
  ];
  const typed = [...tags, ...rows].flatMap((def) =>
    [...values, ...shaped].map((value) => ({ def, value, why: checkFieldValue({ def, value }) })),
  );
  return [
    ...defs.flatMap((def) => values.map((value) => ({ def, value, why: checkFieldValue({ def, value }) }))),
    ...typed,
  ];
}

/** A stored rows value as each declaration now fits it (house decision #89): what the Seat view sends. */
function fitRowsVectors() {
  const def: Extract<CodexField, { type: "rows" }> = {
    label: "R",
    visibility: "gm",
    type: "rows",
    maxRows: 2,
    columns: [
      { id: "dc", label: "D", type: "int", max: 10 },
      { id: "how", label: "H", type: "enum", values: ["low"] },
    ],
    from: [{ entity: "kin" }],
  };
  // prettier-ignore
  const values: unknown[] = [
    null, "x", [], [1, null, { id: 3 }], [{ id: "a", values: { dc: 4, how: "low", gone: 1 } }],
    [{ id: "a", values: { dc: 40, how: "high" }, from: { entity: "kin", key: "elf" } }, { id: "a", values: {} }, { id: "b", from: { entity: "old", key: "x" } }],
    [{ id: "a", values: [] }, { id: "b", values: { dc: 1 } }, { id: "c", values: { dc: 2 } }], [{ id: "", values: {} }, { id: "x".repeat(41) }],
  ];
  return values.map((value) => ({ def, value, fit: fitRows({ def, value }) }));
}

function campaignValueVectors() {
  const defs = [
    { type: "int", label: "D", min: 1, max: 5, default: 1 },
    { type: "int", label: "D", min: -1000, max: 1000, default: 0 },
    { type: "enum", label: "M", values: ["calm", "tense"], default: "calm" },
    { type: "bool", label: "B", default: true },
  ] satisfies CampaignField[];
  const values: unknown[] = [
    null,
    true,
    false,
    0,
    1,
    5,
    6,
    -1,
    1.5,
    1000,
    1001,
    -1000,
    -1001,
    1e300,
    "",
    "calm",
    "tense",
    "x",
    [],
    ["calm"],
    {},
    { a: 1 },
  ];
  return defs.flatMap((def) => values.map((value) => ({ def, value, why: checkCampaignValue({ def, value }) })));
}

const scoreField = { label: "F", type: "int", visibility: "public" };
const scoringBase = {
  id: "g",
  version: "1.0.0",
  core: "^1.0.0",
  sources: [{ id: "s", title: "T", license: "homebrew" }],
  entities: [{ id: "pc", label: "P", base: "actor", fields: { vp: scoreField, gold: scoreField, wood: scoreField } }],
  initiative: { strategy: "seated", firstPlayer: "rotate" },
};
const SCORING_MANIFESTS: unknown[] = [
  {
    ...scoringBase,
    scoring: {
      score: "vp",
      tiebreaks: [
        { expr: "gold", order: "high" },
        { expr: "wood", order: "low" },
      ],
      endWhen: [{ when: "vp >= 5" }, { when: "round > 3" }, { when: "gold > 100" }],
    },
  },
  { ...scoringBase, scoring: { score: "vp", order: "low", endWhen: [{ when: "has(wood)" }] } },
  {
    ...scoringBase,
    scoring: {
      mode: "coop",
      score: "vp",
      endWhen: [
        { when: "vp < 0", outcome: "lose" },
        { when: "vp > 3", outcome: "win" },
        { when: "round > 2", outcome: "lose" },
      ],
    },
  },
  scoringBase,
];

function scoringVectors() {
  const out: unknown[] = [];
  SCORING_MANIFESTS.forEach((manifest, index) => {
    const r = compileRuleset(manifest);
    if (!r.ok) throw new Error(`scoring fixture ${index}: ${JSON.stringify(r.problems)}`);
    const c = r.compiled;
    for (let i = 0; i < 400; i++) {
      const ids = ["a", "b", "c", "d"].slice(0, 1 + rnd(4));
      const actors: Record<string, Record<string, number> | null> = {};
      const scopes: Record<string, ScoredActor> = {};
      for (const id of ids) {
        const fields: Record<string, number> = {};
        for (const key of ["vp", "gold", "wood"]) if (rnd(6) !== 0) fields[key] = rnd(7) - 1;
        const isNull = rnd(8) === 0;
        actors[id] = isNull ? null : fields;
        scopes[id] = { scope: isNull ? null : actorScope({ fields }) };
      }
      const order = [...ids, ...(rnd(5) === 0 ? ["gone"] : [])];
      const round = rnd(6);
      const met = endMet({ ruleset: c, actors: scopes, order, round });
      let rows: ScoreRow[] | null = null;
      let error: string | null = null;
      try {
        rows = scoreRows({ ruleset: c, actors: scopes, order });
      } catch (err) {
        error = (err as Error).message;
      }
      out.push({
        manifest: index,
        actors,
        order,
        round,
        met,
        rows,
        error,
        ranked: rows === null || c.scoring === null ? null : rankResults({ scoring: c.scoring.def, rows, met }),
      });
    }
  });
  return out;
}

// Reminder lines (house decision #81): the invented sides fixture, and one of our own with every kind of line.
const REMINDER_MANIFESTS: unknown[] = [
  SAMPLE_SKIRMISH,
  {
    ...scoringBase,
    conditions: [
      { id: "burn", label: "B", duration: "ownTurnEnd", at: "turnStart", text: "Burn" },
      { id: "bleed", label: "L", duration: "ownTurnEnd", at: "turnEnd", text: "Bleed" },
      { id: "slow", label: "S", duration: "roundEnd", at: "roundEnd", text: "Slow" },
      { id: "plain", label: "P", duration: "manual" },
    ],
    reminders: [
      { id: "a", at: "turnStart", text: "A" },
      { id: "b", at: "turnStart", text: "B", if: "vp > 2", cite: "p1" },
      { id: "c", at: "roundEnd", text: "C", if: "held" },
      { id: "d", at: "roundEnd", text: "D", if: "barred && round == 1" },
      { id: "e", at: "turnEnd", text: "E", if: "gold > vp" },
      { id: "f", at: "roundEnd", text: "F" },
      // House decision #174: read only on its actor types.
      { id: "g", at: "turnStart", text: "G", if: "vp >= 0", entities: ["pc"] },
    ],
  },
];

function reminderVectors() {
  const out: unknown[] = [];
  REMINDER_MANIFESTS.forEach((manifest, index) => {
    const r = compileRuleset(manifest);
    if (!r.ok) throw new Error(`reminder fixture ${index}: ${JSON.stringify(r.problems)}`);
    const conditions = Object.keys(r.compiled.conditions);
    for (let i = 0; i < 300; i++) {
      const ids = ["a", "b", "c", "d"].slice(0, 1 + rnd(4));
      const actors: Record<
        string,
        {
          fields: Record<string, number> | null;
          entity: string;
          conditions: string[];
          held: boolean;
          barred: boolean;
        }
      > = {};
      const built: Record<string, ReminderActor> = {};
      for (const id of ids) {
        const fields: Record<string, number> = {};
        for (const key of ["vp", "gold", "level"]) if (rnd(6) !== 0) fields[key] = rnd(7) - 1;
        const isNull = rnd(8) === 0;
        const held = rnd(3) === 0;
        const barred = rnd(3) === 0;
        const has = conditions.filter(() => rnd(3) === 0);
        const entity = pick(["pc", "character", "creature", "nope"]);
        actors[id] = { fields: isNull ? null : fields, entity, conditions: has, held, barred };
        built[id] = { scope: isNull ? null : actorScope({ fields }), entity, conditions: has, held, barred };
      }
      const order = [...ids, ...(rnd(5) === 0 ? ["gone"] : [])];
      const at = pick(["turnStart", "turnEnd", "roundEnd"] as const);
      const round = rnd(4);
      out.push({
        manifest: index,
        at,
        actors,
        order,
        round,
        lines: remindersOf({ ruleset: r.compiled, at, actors: built, order, round }),
      });
    }
  });
  return out;
}

// SAMPLE_HARM with its horn granted only to a hero without one: contains() (house decision #89) over a held list field
// (#88), which reads as empty where it is unset.
const lesser = SAMPLE_HARM.tables!.lesser!;
const HELD_CONTAINS = {
  ...SAMPLE_HARM,
  tables: {
    ...SAMPLE_HARM.tables,
    lesser: {
      ...lesser,
      entries: lesser.entries.map((x) =>
        x.id === "horn" ? { ...x, apply: x.apply?.map((a) => ({ ...a, when: '!contains(growths, "horn")' })) } : x,
      ),
    },
  },
};

/** The lookup manifests lookupVectors reads (house decision #87). */
const LOOKUP_MANIFESTS: unknown[] = [
  SAMPLE_HARM,
  LOOKUP_MANIFEST,
  HELD_CONTAINS,
  // House decision #174: an immunity read only on its actor types.
  {
    ...LOOKUP_MANIFEST,
    conditions: LOOKUP_MANIFEST.conditions.map((c) =>
      "immune" in c && typeof c.immune === "string" ? { ...c, immune: { if: c.immune, entities: ["pc"] } } : c,
    ),
  },
];

/** Typed results applied to targets of random values (house decision #87): the line, the total and the steps, or why not. */
function lookupVectors() {
  const out: unknown[] = [];
  LOOKUP_MANIFESTS.forEach((manifest, index) => {
    const r = compileRuleset(manifest);
    if (!r.ok) throw new Error(`lookup fixture ${index}: ${JSON.stringify(r.problems)}`);
    const tables = Object.keys(r.compiled.lookups);
    for (let i = 0; i < 400; i++) {
      const tableId = rnd(20) === 0 ? "nope" : pick(tables);
      const d66 = 10 * (1 + rnd(6)) + 1 + rnd(6);
      const result = pick([d66, d66, d66, 2 + rnd(11), 1 + rnd(6), rnd(80), 2.5]);
      const inputs: Record<string, unknown> = {};
      const odd = rnd(8) === 0; // now and then a value the input does not take, or one the table does not declare
      for (const x of r.compiled.ruleset.tables?.[tableId]?.inputs ?? []) {
        if (rnd(4) === 0) continue;
        const fine =
          x.type === "bool"
            ? rnd(2) === 0
            : (x.min ?? 0) + rnd(1 + (typeof x.max === "number" ? x.max : 3) - (x.min ?? 0));
        inputs[x.id] = odd ? pick([1, "yes", 1.5, 99, true]) : fine;
      }
      if (rnd(20) === 0) inputs.nope = true;
      const fields: Record<string, number | string[]> = {};
      for (const key of ["grit", "hide", "size", "attr.str", "attr.dex"]) if (rnd(12) !== 0) fields[key] = rnd(7);
      if (rnd(3) !== 0) fields.growths = ["horn", "wings", "scales"].filter(() => rnd(2) === 0);
      const derived: Record<string, number> = {};
      for (const key of ["limit", "strainCap"]) if (rnd(12) !== 0) derived[key] = rnd(5);
      const resources: Record<string, number> = { wounds: rnd(4) };
      for (const key of ["luck", "hp"]) if (rnd(3) !== 0) resources[key] = rnd(5);
      const scope = actorScope({ fields, derived, resources });
      const entity = pick(["pc", "hero", "brute", "nope", undefined]);
      // The shared pools a stepper's max may read (house decision #192); now and then none.
      const pools: Record<string, number> = {};
      if (rnd(6) !== 0) for (const key of ["dread", "luck"]) pools[key] = rnd(4);
      out.push({
        manifest: index,
        tableId,
        result,
        inputs,
        fields,
        derived,
        resources,
        entity,
        pools,
        plan: planLookup({ compiled: r.compiled, tableId, result, inputs, scope, entity, pools }),
      });
    }
  });
  return out;
}

/** A condition row's starting count (house decision #81), every combination. */
function armedVectors() {
  return ConditionDuration.options.flatMap((duration) =>
    [undefined, "nextOwnTurn" as const].flatMap((from) =>
      [true, false].flatMap((holderActing) =>
        [null, 1, 3].map((typed) => ({
          duration,
          from: from ?? null,
          holderActing,
          typed,
          ticks: armedTicks({ def: { duration, from }, holderActing, typed }),
        })),
      ),
    ),
  );
}

function viewVectors() {
  const out: unknown[] = [];
  MANIFESTS.forEach((manifest, index) => {
    const r = compileRuleset(manifest);
    if (!r.ok) throw new Error(`fixture ${index} does not compile`);
    const c = r.compiled;
    const entityIds = Object.keys(c.entities);
    for (let i = 0; i < 300; i++) {
      const actors: ActorView[] = Array.from({ length: 1 + rnd(3) }, (_, n) => {
        const entity = rnd(8) === 0 ? "unknown" : pick(entityIds);
        const ce = Object.hasOwn(c.entities, entity) ? c.entities[entity] : undefined;
        const fieldIds = [...Object.keys(ce?.def.fields ?? {}), "undeclared", "constructor"];
        const resourceIds = [...Object.keys(c.resources), "undeclared"];
        const derivedIds = [...(ce?.derived.map((d) => d.id) ?? []), "undeclared"];
        const pickSome = (list: readonly string[]) => list.filter(() => rnd(2) === 0);
        return {
          id: `a${n}`,
          entity,
          fields: Object.fromEntries(
            pickSome(fieldIds).map((id) => [id, pick<FieldValue>([1, "x", true, null, ["a"]])]),
          ),
          resources: Object.fromEntries(pickSome(resourceIds).map((id) => [id, rnd(9)])),
          derived: Object.fromEntries(pickSome(derivedIds).map((id) => [id, rnd(9)])),
          conditions: pickSome([...Object.keys(c.conditions), "undeclared"]),
        };
      });
      const viewer = { role: pick(ViewerRole.options), characterIds: ["a0", "a1", "a2"].filter(() => rnd(3) === 0) };
      out.push({ manifest: index, viewer, actors, view: toViewerView({ compiled: c, viewer, actors }).actors });
    }
  });
  return out;
}

const CREATION_MANIFEST = {
  id: "b",
  version: "1.0.0",
  core: "^1.0.0",
  sources: [{ id: "s", title: "T", license: "homebrew" }],
  entities: [
    {
      id: "pc",
      label: "P",
      base: "actor",
      fields: {
        "attr.str": { label: "S", type: "int", min: 1, max: 20 },
        "attr.dex": { label: "D", type: "int" },
        "skill.a": { label: "A", type: "int" },
        "skill.b": { label: "B", type: "int" },
        name: { label: "N", type: "text", maxLength: 8 },
        size: { label: "Z", type: "enum", values: ["small", "big"] },
        brave: { label: "R", type: "bool" },
        tags: { label: "T", type: "list", maxItems: 2 },
        kin: { label: "K", type: "ref", entity: "kin" },
        speed: { label: "V", type: "int" },
        unset: { label: "U", type: "int" },
      },
    },
    {
      id: "kin",
      label: "K",
      base: "item",
      fields: { speed: { label: "V", type: "int" }, title: { label: "T", type: "text" } },
    },
    { id: "npc", label: "N", base: "actor" },
  ],
  initiative: { strategy: "seated", firstPlayer: "fixed" },
  creation: [
    {
      id: "origin",
      actor: "pc",
      label: "O",
      kind: "choose",
      pick: "kin",
      copy: [
        { from: "speed", to: "speed" },
        { from: "title", to: "name" },
      ],
    },
    { id: "extra", actor: "pc", label: "E", kind: "choose", pick: "kin", count: 2, optional: true },
    {
      id: "table",
      actor: "pc",
      label: "T",
      kind: "assign",
      fields: ["attr.str", "attr.dex"],
      method: { kind: "table", values: [3, 3] },
    },
    {
      id: "buy",
      actor: "pc",
      label: "B",
      kind: "assign",
      optional: true,
      fields: ["skill.a", "skill.b"],
      method: { kind: "pointBuy", budget: 5, min: 0, max: 3, costs: { "0": 0, "1": 1, "2": 3, "3": 5, "4": 1 } },
    },
    { id: "free", actor: "pc", label: "F", kind: "fields", fields: ["size", "brave", "tags", "kin"] },
  ],
};
const CREATION_ENTRIES = [
  { key: "elf", type: "kin", name: "E", tags: [], visibility: "public", body: { speed: 7, title: "ok" } },
  {
    key: "orc",
    type: "kin",
    name: "O",
    tags: [],
    visibility: "public",
    body: { speed: "fast", title: "much too long" },
  },
  { key: "imp", type: "kin", name: "I", tags: [], visibility: "public", body: {} },
];

function creationVectors() {
  const r = compileRuleset(CREATION_MANIFEST);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  const lookup: EntryLookup = ({ type, key }) =>
    CREATION_ENTRIES.find((e) => e.type === type && e.key === key) as PackEntry | undefined;
  const score = () => pick([3, 3, 3, 3, 3, 3, 3, 9, 0, 21]);
  const genAnswers = () => ({
    origin: [pick(["elf", "elf", "elf", "imp", "imp", "orc", "nope"])],
    ...(rnd(2) === 0 ? { extra: pick([["elf", "orc"], ["elf", "elf"], ["elf"], []]) } : {}),
    table: { "attr.str": score(), "attr.dex": score(), ...(rnd(8) === 0 ? { "skill.a": 3 } : {}) },
    ...(rnd(2) === 0
      ? { buy: { "skill.a": pick([0, 1, 2, 3, 4]), ...(rnd(4) === 0 ? {} : { "skill.b": pick([0, 1, 2, 3]) }) } }
      : {}),
    free: {
      size: pick(["small", "big", "small", "big", "odd"]),
      brave: pick<unknown>([true, false, true, false, "yes"]),
      tags: pick<unknown>([["a"], ["a", "b"], [], ["a"], ["a", "b", "c"], [1]]),
      kin: pick<unknown>(["elf", "elf", "elf", "elf", "", 1]),
      ...(rnd(8) === 0 ? { name: "x" } : {}),
    },
    ...(rnd(10) === 0 ? { nope: 1 } : {}),
  });
  const out: unknown[] = [];
  for (let i = 0; i < 3000; i++) {
    const clean = genAnswers();
    const answers = sortDeep(rnd(3) === 0 ? breakInput(clean) : clean);
    if (typeof answers !== "object" || answers === null || Array.isArray(answers)) continue;
    const actor = rnd(30) === 0 ? pick(["npc", "kin", "nope"]) : "pc";
    const result = runCreation({
      ruleset: r.compiled.ruleset,
      actor,
      answers: answers as Record<string, unknown>,
      lookup,
    });
    out.push({ actor, answers, ...result });
  }
  return out;
}

const PACK_RULESET = {
  ...CREATION_MANIFEST,
  id: "pk",
  initiative: { strategy: "seated", firstPlayer: "fixed", cite: "p1" },
  sources: [{ id: "s", title: "T", license: "srd" }],
  creation: [],
  entities: [
    {
      id: "kin",
      label: "K",
      base: "actor",
      fields: {
        speed: { label: "V", type: "int", min: 0, max: 9 },
        note: { label: "N", type: "text" },
        size: { label: "Z", type: "enum", values: ["big"] },
        "a.b": { label: "A", type: "bool" },
      },
    },
  ],
};
const packEntry = { key: "elf", type: "kin", name: "Elf", cite: "p1" };
const packBase = {
  id: "my-pack",
  version: "1.0.0",
  ruleset: { id: "pk", range: "^1.0.0" },
  license: "private",
  entries: [packEntry],
};
// prettier-ignore
const CRAFTED_PACKS: object[] = [
  {},
  { license: "original", entries: [{ key: "elf", type: "kin", name: "E" }] },
  { entries: [{ key: "elf", type: "kin", name: "E" }] },
  { license: "srd" },
  { license: "cc-by", attribution: "Someone" },
  { ruleset: { id: "other", range: "^1.0.0" } },
  { ruleset: { id: "pk", range: "nope" }, version: "x", id: "Bad" },
  { entries: [packEntry, packEntry] },
  { entries: [{ ...packEntry, type: "nope" }] },
  { entries: [{ ...packEntry, body: { nope: 1, speed: 3 } }] },
  { entries: [{ ...packEntry, body: { speed: 11, size: "small", note: 1, "a.b": "x" } }] },
  { entries: [{ ...packEntry, body: { speed: 1.5 } }] },
  { entries: [{ ...packEntry, body: { speed: 1e10, note: null, size: {} } }] },
  { entries: [{ ...packEntry, body: { "Bad-Key": 1, note: ["x".repeat(1001)] } }] },
  { entries: [{ ...packEntry, body: { note: "x".repeat(280) } }] },
  { entries: [{ ...packEntry, body: { note: "x".repeat(281) } }] },
  { entries: [{ ...packEntry, body: { note: "é".repeat(281) } }] },
  { license: "srd", attribution: "A", entries: [{ ...packEntry, body: { note: "x".repeat(281) } }] },
  { entries: [{ ...packEntry, body: { note: "x".repeat(10000), size: "big" } }, { ...packEntry, key: "b", body: { note: "x".repeat(10001) } }] },
  { entries: [{ ...packEntry, body: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, "x".repeat(2000)])) }] },
  { entries: [{ ...packEntry, tags: ["z", "é", "😀", "￿", "a"], level: 3, visibility: "public" }] },
  { entries: [{ ...packEntry, level: 101, tags: Array.from({ length: 21 }, () => "a"), visibility: "owner", key: "Bad Key" }] },
  { sources: [{ id: "a", title: "T", license: "srd" }, { id: "a", title: "U", license: "orc" }] },
  { attribution: "" },
  { entries: "nope" },
  { entries: Array.from({ length: 5001 }, () => ({})).slice(0, 2) },
  { entries: [{ ...packEntry, body: { note: "x".repeat(6000000) } }] },
];

function packVectors() {
  const out: unknown[] = [];
  const rulesets = [
    SAMPLE_D20,
    PACK_RULESET,
    { ...PACK_RULESET, sources: [{ id: "s", title: "T", license: "homebrew" }] },
    SAMPLE_HARM,
    ITEMS_MANIFEST,
  ];
  const compiled = rulesets.map((m) => {
    const r = compileRuleset(m);
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    return r.compiled.ruleset;
  });
  const one = (rulesetIndex: number, input: unknown) => {
    const r = validatePack({ input, ruleset: compiled[rulesetIndex] as Ruleset });
    const big = (JSON.stringify(input) ?? "").length > 1_000_000;
    out.push({
      ruleset: rulesetIndex,
      input: big ? null : input,
      big,
      ok: r.ok,
      warnings: r.warnings,
      ...(r.ok ? { pack: r.pack, hashes: r.pack.entries.map(contentHash) } : { problems: r.problems }),
    });
  };
  one(0, SAMPLE_PACK);
  const strings = [
    ...MANIFEST_STRINGS,
    ...allStrings(SAMPLE_PACK, []),
    "1.0.0",
    "^2",
    "gm",
    "public",
    "orc",
    "original",
    "private",
  ];
  for (let i = 0; i < 1500; i++) one(0, mutate(SAMPLE_PACK, strings));
  for (const over of CRAFTED_PACKS) {
    one(1, { ...packBase, ...over });
    one(2, { ...packBase, ...over });
  }
  // Entry effects (house decision #61), crafted so the random stream above stays as it was.
  const calling = SAMPLE_PACK_EFFECTS.entries[1] as Record<string, unknown>;
  const withEffects = (effects: unknown, over: Record<string, unknown> = {}) => ({
    ...SAMPLE_PACK_EFFECTS,
    entries: [{ ...calling, ...over, effects }],
  });
  const eff = { path: "derived.defense", mode: "add", value: "1", phase: "derived" };
  one(0, SAMPLE_PACK_EFFECTS);
  one(0, withEffects([]));
  one(0, withEffects([eff, { ...eff, mode: "override", priority: -2, when: "level > 2", cite: "Sample p.1" }]));
  one(0, withEffects([{ ...eff, path: "derived.nope" }]));
  one(0, withEffects([{ ...eff, path: "defense" }]));
  one(0, withEffects([{ path: "attr.dex", mode: "add", value: "derived.defense" }]));
  one(0, withEffects([{ path: "attr.dex", mode: "add", value: "nope + 1" }]));
  one(0, withEffects([{ ...eff, when: "level" }]));
  one(0, withEffects([{ path: "name", mode: "add", value: "1" }]));
  one(0, withEffects([eff], { type: "gear", body: { weight: 1 } }));
  one(0, withEffects([eff], { type: "creature", body: {} }));
  one(0, withEffects(Array.from({ length: 20 }, () => eff)));
  one(0, withEffects(Array.from({ length: 21 }, () => eff)));
  one(0, withEffects({}));
  one(0, withEffects([{ mode: "add" }]));
  // Effects of an entry type a held kind holds (house decision #88), checked against the holders.
  const growths = (entries: unknown[]) => ({
    id: "growths",
    version: "0.1.0",
    ruleset: { id: "sample-harm", range: "^0.1.0" },
    license: "private",
    sources: [{ id: "sample", title: "Sample Harm Rules", license: "private" }],
    entries,
  });
  const growth = SAMPLE_HARM_GROWTHS[0]!;
  one(3, growths(SAMPLE_HARM_GROWTHS));
  one(3, growths([{ ...growth, effects: [{ path: "derived.nope", mode: "add", value: "1", phase: "derived" }] }]));
  one(3, growths([{ ...growth, effects: [{ path: "hide", mode: "add", value: "1" }] }]));
  one(3, growths([{ ...growth, type: "nope" }]));
  // Effects of an entry type an item kind holds (house decision #95), checked against the holders.
  const items = (effects: unknown[]) => ({
    id: "items",
    version: "0.1.0",
    ruleset: { id: "m", range: "^1.0.0" },
    license: "original",
    entries: [{ key: "a", type: "gear", name: "A", tags: ["tool"], effects }],
  });
  one(4, items([{ path: "derived.a", mode: "add", value: "1", phase: "derived" }]));
  one(4, items([{ path: "attr.str", mode: "add", value: "1" }]));
  one(4, items([{ path: "derived.nope", mode: "add", value: "1", phase: "derived" }]));
  one(0, {
    ...SAMPLE_PACK_EFFECTS,
    entries: [
      ...SAMPLE_PACK_EFFECTS.entries,
      { ...calling, key: "other", effects: [{ ...eff, path: "derived.nope" }] },
    ],
  });
  return { rulesets, cases: out };
}

function diffVectors() {
  const keys = ["a", "b", "c", "é", "😀", "￿", "z"];
  const gen = () => new Map(keys.filter(() => rnd(2) === 0).map((k) => [k, pick(["h1", "h2"])]));
  return Array.from({ length: 300 }, () => {
    const prev = gen();
    const next = gen();
    return { prev: Object.fromEntries(prev), next: Object.fromEntries(next), diff: diffHashes({ prev, next }) };
  });
}

// The seat helpers the api's turn plan reads (encounter.plan.ts), over every small order and first player.
function seatVectors() {
  const orders = [[], ["a"], ["a", "b"], ["a", "b", "c"], ["c", "a", "é", "b"]];
  return orders.flatMap((order) =>
    [null, "x", ...order].flatMap((firstId) =>
      (["fixed", "rotate", "manual"] as const).map((firstPlayer) => {
        const first = firstOf({ order, firstId });
        return {
          order,
          firstId,
          firstPlayer,
          sequence: sequence({ order, firstId }),
          firstOf: first,
          nextFirst: nextFirst({ params: { strategy: "seated", firstPlayer } as never, order, first }),
        };
      }),
    ),
  );
}

function poolSizeVectors() {
  return [-120, -5, 0, 3, 99, 100, 150].flatMap((pool) =>
    [-200, -10, -1, 0, 2, 50].map((modifier) => ({ pool, modifier, size: poolSize({ pool, modifier }) })),
  );
}

const vectors = {
  scope: SCOPE,
  expr: exprVectors(),
  canonical: CANONICAL.map((value) => {
    const canonical = canonicalJson(value);
    return { input: JSON.stringify(value), canonical, sha: sha256Hex(canonical) };
  }),
  sha: ["", "abc", "é", "😀", "a".repeat(55), "a".repeat(56), "a".repeat(64), "é".repeat(1000)].map((text) => ({
    text,
    sha: sha256Hex(text),
  })),
  entries: [...SAMPLE_PACK.entries, ...SAMPLE_PACK_EFFECTS.entries].map((e) => {
    const entry = { tags: [], effects: [], ...e };
    return { entry, hash: contentHash(entry as never) };
  }),
  dice: diceVectors(),
  ops: opVectors(),
  charge: chargeVectors(),
  spends: spendVectors(),
  strikes: strikeVectors(),
  acquire: acquireVectors(),
  fittings: fittingVectors(),
  kept: keptVectors(),
  spawns: spawnVectors(),
  opInputKeys: opKeyVectors(),
  deltaChecks: deltaCheckVectors(),
  typeScope,
  checks: checkVectors(exprSources),
  manifests: MANIFESTS,
  manifestCases: manifestVectors(),
  derive: deriveVectors(),
  entryDerive: entryDeriveVectors(),
  fieldValues: fieldValueVectors(),
  fitRows: fitRowsVectors(),
  campaignValueChecks: campaignValueVectors(),
  scoringManifests: SCORING_MANIFESTS,
  scoring: scoringVectors(),
  reminderManifests: REMINDER_MANIFESTS,
  reminders: reminderVectors(),
  armed: armedVectors(),
  lookupManifests: LOOKUP_MANIFESTS,
  lookups: lookupVectors(),
  generatorManifests: GENERATOR_MANIFESTS,
  generatorRuns: generatorRunVectors(),
  views: viewVectors(),
  creationManifest: CREATION_MANIFEST,
  creationEntries: CREATION_ENTRIES,
  creation: creationVectors(),
  packs: packVectors(),
  ledgerPacks: ledgerPackVectors(),
  diffs: diffVectors(),
  seats: seatVectors(),
  poolSizes: poolSizeVectors(),
  worlds: worldVectors(),
  modules: moduleVectors(),
  // The widget list without the importer's descriptions, which only the TypeScript side carries.
  widgets: {
    list: WIDGETS.map(({ about: _about, slots, ...w }) => ({ ...w, slots: slots.map(({ about: _a, ...x }) => x) })),
    targets: LAYOUT_TARGETS,
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(vectors));
console.log(
  `vectors: ${vectors.expr.length} expr, ${vectors.canonical.length} canonical, ${vectors.dice.parse.length} dice,` +
    ` ${vectors.dice.roll.length} rolls, ${vectors.ops.cases.length} op cases`,
);
