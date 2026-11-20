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
import { SAMPLE_HARVEST } from "../../../packages/rules-engine/src/fixtures/sample-harvest.ts";
import { SAMPLE_POOL } from "../../../packages/rules-engine/src/fixtures/sample-pool.ts";
import { SAMPLE_SCOPED } from "../../../packages/rules-engine/src/fixtures/sample-scoped.ts";
import { SAMPLE_SKIRMISH } from "../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import { SAMPLE_TIERED } from "../../../packages/rules-engine/src/fixtures/sample-tiered.ts";
import { SAMPLE_NO_ORDER } from "../../../packages/rules-engine/src/fixtures/sample-no-order.ts";
import { FREEFORM } from "../../web/lib/freeform/freeform.ts";
import type { CampaignField, FieldDef, Ruleset } from "../../../packages/rules-engine/src/manifest.ts";
import { runCreation, type EntryLookup } from "../../../packages/rules-engine/src/creation.ts";
import { checkCampaignValue, checkFieldValue } from "../../../packages/rules-engine/src/field-value.ts";
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
import { toViewerView, type ActorView } from "../../../packages/rules-engine/src/view.ts";
import { parseDice, rollDice, seededRng } from "../../../packages/rules-engine/src/dice/dice.ts";
import type { FieldValue } from "../../../packages/rules-engine/src/derived.ts";
import {
  AdvantageMode,
  ConditionDuration,
  DeathSaveResult,
  ResetEvent,
  ViewerRole,
} from "../../../packages/rules-engine/src/enums.ts";
import { FnName } from "../../../packages/rules-engine/src/expr/expr.ast.ts";
import { evaluate } from "../../../packages/rules-engine/src/expr/expr.eval.ts";
import { parseExpr } from "../../../packages/rules-engine/src/expr/expr.parser.ts";
import { SAMPLE_PACK, SAMPLE_PACK_EFFECTS } from "../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { plainDice } from "../../../packages/rules-engine/src/manifest.ts";
import { canonicalJson, contentHash, diffHashes, sha256Hex } from "../../../packages/rules-engine/src/pack-hash.ts";
import type {
  ActorState,
  ConditionState,
  RuleState,
  ResourceState,
  TurnState,
} from "../../../packages/rules-engine/src/primitives/primitive.ts";
import { charge } from "../../../packages/rules-engine/src/primitives/primitive.ts";
import { PRIMITIVES, runOp } from "../../../packages/rules-engine/src/primitives/registry.ts";
import { firstOf, nextFirst, sequence } from "../../../packages/rules-engine/src/primitives/initiative-seated.ts";
import { poolSize } from "../../../packages/rules-engine/src/primitives/dice-pool-successes.ts";

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
      return { id: id(), barred: rnd(2) === 0 };
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
        const state =
          primitive === "initiative.sides" ? BASE_STATES + rnd(STATES.length - BASE_STATES) : rnd(BASE_STATES);
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
  "has(nope)", "has(attr[name])", "has(1,2)", "has(rolls[0])", "attr[name] + 1", "attr.str + attr[name]", "res.hp + res.gone + res.hp", "attr.str > 1 && has(res.hp)",
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
      modifier: exprView(t.modifier),
      target: exprView(t.target),
      pool: exprView(t.pool),
      modifierVisibility: t.modifierVisibility,
      targetVisibility: t.targetVisibility,
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

// House decision #55: campaign fields, the `campaign` root and at().
const cInt = { type: "int", label: "D", min: 1, max: 5, default: 1, cite: "p1" };
const cEnum = { type: "enum", label: "M", values: ["calm", "tense"], default: "calm", cite: "p1" };
const cBool = { type: "bool", label: "B", default: false, cite: "p1" };
const withCampaign = (campaignFields: object) => ({ campaignFields });
const withForm = (fields: object, expr: string) =>
  withPc({ fields: { ...pcBase.fields, ...fields }, derived: [{ id: "a", label: "A", expr }] });
const intField = { label: "F", type: "int" };

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

const CRAFTED: object[] = [
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
];

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
  (m) => (m.build.params.startingXp.perTier = -1),
  (m) => (m.build.params.tiers = { min: 3, max: 2 }),
  (m) => (m.build.params.vocabulary.mods = [{ key: "guard" }]),
  (m) => (m.build.strategy = "steps"),
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
    (p) => {
      const wardens = at(p, "factions.wardens");
      p.entries.push({ ...wardens, key: "talents.wardens", type: "talent", record: { ...wardens.record, xp: 1 } });
    },
    (p) => (at(p, "factions.wardens").record.summary = "x".repeat(MAX_ENTRY_RECORD_BYTES)),
    (p) => (at(p, "factions.wardens").record.summary = "é".repeat(MAX_ENTRY_RECORD_BYTES / 2)),
    (p) => (at(p, "wargear.lantern-staff").record.weapon.range = "far"),
    (p) => (p.entries = p.entries.filter((e: Mutable) => e.type === "talent")),
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
        const characters = rnd(7);
        const declared = Object.keys(c.ruleset.campaignFields ?? {}).length > 0;
        const stored = declared ? genStored(c) : undefined;
        const campaign = stored === undefined ? undefined : campaignValues({ compiled: c, stored });
        const values = {
          fields,
          resources,
          conditions,
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
  const defs: FieldDef[] = [
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
  ];
  // prettier-ignore
  const values: unknown[] = [
    null, true, false, 0, 1, -2, -3, 5, 6, 1.5, 1e300, 2147483647, 2147483648, -2147483648, -2147483649, "", "a", "b", "abc", "abcd", "é😀", "😀😀", "x".repeat(120), "x".repeat(121),
    "x".repeat(10000), "x".repeat(10001), "é".repeat(10001), [], ["a"], ["a", "b"], ["a", "b", "c"], [1], ["a", 1], ["x".repeat(1000)], ["x".repeat(1001)], ["😀".repeat(501)],
    Array.from({ length: 500 }, () => "a"), Array.from({ length: 501 }, () => "a"), {}, { a: 1 },
  ];
  return defs.flatMap((def) => values.map((value) => ({ def, value, why: checkFieldValue({ def, value }) })));
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
  typeScope,
  checks: checkVectors(exprSources),
  manifests: MANIFESTS,
  manifestCases: manifestVectors(),
  derive: deriveVectors(),
  entryDerive: entryDeriveVectors(),
  fieldValues: fieldValueVectors(),
  campaignValueChecks: campaignValueVectors(),
  scoringManifests: SCORING_MANIFESTS,
  scoring: scoringVectors(),
  views: viewVectors(),
  creationManifest: CREATION_MANIFEST,
  creationEntries: CREATION_ENTRIES,
  creation: creationVectors(),
  packs: packVectors(),
  ledgerPacks: ledgerPackVectors(),
  diffs: diffVectors(),
  seats: seatVectors(),
  poolSizes: poolSizeVectors(),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(vectors));
console.log(
  `vectors: ${vectors.expr.length} expr, ${vectors.canonical.length} canonical, ${vectors.dice.parse.length} dice,` +
    ` ${vectors.dice.roll.length} rolls, ${vectors.ops.cases.length} op cases`,
);
