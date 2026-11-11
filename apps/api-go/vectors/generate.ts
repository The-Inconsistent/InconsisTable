// Writes what the TypeScript engine answers, for the Go engine's tests to match (docs/adr/0008-go-api.md).
// The output is generated on every run and never committed, so Go always faces the TypeScript of this commit. Only the
// inputs written here are compared: a new dice suffix or primitive needs vectors added here too.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { FIXTURE_RULESET } from "../../smoke/test/fixture.ts";
import { compileRuleset, type CompiledRuleset } from "../../../packages/rules-engine/src/compile.ts";
import {
  applyBaseEffects,
  actorScope,
  deriveValues,
  healthStatesOf,
  instantDeathAt,
  resetValues,
  resourceBounds,
} from "../../../packages/rules-engine/src/derived.ts";
import type { ExprScope, ExprType } from "../../../packages/rules-engine/src/expr/expr.ast.ts";
import { typeName } from "../../../packages/rules-engine/src/expr/expr.check.ts";
import { compileExpr, type CompiledExpr } from "../../../packages/rules-engine/src/expr/expr.ts";
import { SAMPLE_D20 } from "../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_HARVEST } from "../../../packages/rules-engine/src/fixtures/sample-harvest.ts";
import { SAMPLE_POOL } from "../../../packages/rules-engine/src/fixtures/sample-pool.ts";
import type { FieldDef, Ruleset } from "../../../packages/rules-engine/src/manifest.ts";
import { runCreation, type EntryLookup } from "../../../packages/rules-engine/src/creation.ts";
import { checkFieldValue } from "../../../packages/rules-engine/src/field-value.ts";
import { validatePack, type PackEntry } from "../../../packages/rules-engine/src/pack.ts";
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
import { SAMPLE_PACK } from "../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { plainDice } from "../../../packages/rules-engine/src/manifest.ts";
import { canonicalJson, contentHash, diffHashes, sha256Hex } from "../../../packages/rules-engine/src/pack-hash.ts";
import type {
  ActorState,
  ConditionState,
  RuleState,
  ResourceState,
} from "../../../packages/rules-engine/src/primitives/primitive.ts";
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

// Plain fixtures of our own writing: valid params, some leaving defaults out, so Go has to apply them too.
const OP_PARAMS: Record<string, unknown[]> = {
  "dice.sumVsTarget": [
    { kind: "sumVsTarget", target: "10", dice: "1d20" },
    { kind: "sumVsTarget", target: "10", dice: "1d20", ties: "beat", advantage: true, critOn: [1, 20] },
    { kind: "sumVsTarget", target: "10", dice: "2d6", ties: "meetOrBeat", critOn: [12] },
    { kind: "sumVsTarget", target: "10", dice: "2d6+1" },
    { kind: "sumVsTarget", target: "10", dice: "1dF", advantage: true },
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

const STATES: RuleState[] = [{ actors: {}, turn: null }, UNSORTED, DYING, ...Array.from({ length: 60 }, genState)];

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
      return { id: id() };
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
      for (let i = 0; i < (primitive === "health.tracks" ? 6000 : 1500); i++) {
        const state = rnd(STATES.length);
        const valid = genInput(primitive, op, STATES[state] as RuleState);
        run({ primitive, op, p: pick(list), state, input: rnd(4) === 0 ? breakInput(valid) : valid });
      }
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
  return {
    // Arrays, because the order of actors and resources decides the order of deltas and decoded JSON would lose it.
    states: STATES.map((s) => ({
      turn: s.turn,
      actors: Object.values(s.actors).map((a) => ({
        ...a,
        resources: Object.entries(a.resources).map(([name, state]) => ({ name, state })),
      })),
    })),
    params,
    cases,
  };
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

const MANIFESTS: unknown[] = [SAMPLE_D20, SAMPLE_HARVEST, SAMPLE_POOL, FIXTURE_RULESET];

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
  "fields", "table", "pointBuy", "faces", "poolSuccesses", "sumVsTarget",
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
        conditionId: x.conditionId,
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
    })),
    tests: mapValues(c.tests, (t) => ({
      modifier: exprView(t.modifier),
      target: exprView(t.target),
      pool: exprView(t.pool),
      modifierVisibility: t.modifierVisibility,
      targetVisibility: t.targetVisibility,
    })),
    initiative: { score: exprView(c.initiative.score), tiebreak: c.initiative.tiebreak.map(exprView) },
    scoring:
      c.scoring === null
        ? null
        : {
            score: exprView(c.scoring.score),
            tiebreaks: c.scoring.tiebreaks.map(exprView),
            endWhen: c.scoring.endWhen.map(exprView),
          },
    healthStates: c.healthStates.map((s) => ({ id: s.id, label: s.label ?? null, when: exprView(s.when) })),
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
const CRAFTED: object[] = [
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
];

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
  return cases;
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
        const values = { fields, resources, conditions, party: { characters } };
        const base = attempt(() => applyBaseEffects({ compiled: c, entity, values }));
        const derived = attempt(() => deriveValues({ compiled: c, entity, values }));
        const scope = actorScope({
          fields,
          derived: "value" in derived ? derived.value : {},
          resources,
          party: { characters },
        });
        out.push({
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
            death: attempt(() => instantDeathAt({ compiled: c, resource, scope })),
          })),
          states: attempt(() => healthStatesOf({ compiled: c, scope })),
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
  entries: SAMPLE_PACK.entries.map((e) => {
    const entry = { tags: [], ...e };
    return { entry, hash: contentHash(entry as never) };
  }),
  dice: diceVectors(),
  ops: opVectors(),
  typeScope,
  checks: checkVectors(exprSources),
  manifests: MANIFESTS,
  manifestCases: manifestVectors(),
  derive: deriveVectors(),
  fieldValues: fieldValueVectors(),
  scoringManifests: SCORING_MANIFESTS,
  scoring: scoringVectors(),
  views: viewVectors(),
  creationManifest: CREATION_MANIFEST,
  creationEntries: CREATION_ENTRIES,
  creation: creationVectors(),
  packs: packVectors(),
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
