// Writes what the TypeScript engine answers, for the Go engine's tests to match (docs/adr/0008-go-api.md).
// The output is generated on every run and never committed, so Go always faces the TypeScript of this commit. Only the
// inputs written here are compared: a new dice suffix or primitive needs vectors added here too.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseDice, rollDice, seededRng } from "../../../packages/rules-engine/src/dice/dice.ts";
import { AdvantageMode, TieRule } from "../../../packages/rules-engine/src/enums.ts";
import { FnName } from "../../../packages/rules-engine/src/expr/expr.ast.ts";
import { evaluate } from "../../../packages/rules-engine/src/expr/expr.eval.ts";
import { parseExpr } from "../../../packages/rules-engine/src/expr/expr.parser.ts";
import { SAMPLE_PACK } from "../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { plainDice } from "../../../packages/rules-engine/src/manifest.ts";
import { canonicalJson, contentHash, sha256Hex } from "../../../packages/rules-engine/src/pack-hash.ts";
import { diceSumVsTarget, ResolveInput } from "../../../packages/rules-engine/src/primitives/dice-sum-vs-target.ts";

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

function mutate(s: string): string {
  const i = rnd(s.length + 1);
  return rnd(2) === 0 ? s.slice(0, i) + pick(JUNK) + s.slice(i) : s.slice(0, i) + s.slice(i + 1 + rnd(3));
}

// prettier-ignore
const FIXED_EXPR = [
  "", " ", "1 + 2 * 3", "(1 + 2) * 3", "10 - 4 - 3", "-2 * 3", "2 * -attr.dex", "7 / 2", "-7 / 2", "7 / -2", "-7 % 3", "7 % -3",
  "1/0", "1%0", "attr == attr", "tags == tags", "tags == rolls", "nested.a == nested.a", "nested.a.b == nested.a.b",
  'name == "Ash"', '1 == "1"', "true == 1", "0 == -0", "-zero == zero", "big + 1", "big * big", "-big - 2",
  "3037000500*3037000500", "94906267*94906267", "94906265*94906265", "floor(7,2)", "ceil(7,2)", "ceil(-7,2)", "floor()", "ceil()",
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

function exprVectors() {
  const sources = [...FIXED_EXPR];
  for (let i = 0; i < 6000; i++) sources.push(genExpr(1 + rnd(4)));
  for (let i = 0; i < 6000; i++) sources.push(genNumeric());
  for (let i = 0; i < 4000; i++) sources.push(mutate(genExpr(1 + rnd(3))));
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

function sumVsTargetVectors() {
  const op = diceSumVsTarget.ops.resolve;
  if (!op) throw new Error("dice.sumVsTarget has no resolve op");
  const out = [];
  for (const dice of ["1d20", "2d6", "1dF", "2d6+1"])
    for (const ties of TieRule.options)
      for (const critOn of [undefined, [20], [1, 20], [12]])
        for (const allowed of [false, true])
          for (const advantage of AdvantageMode.options)
            for (const target of [10, 15, 12])
              for (const modifier of [0, 5, -3])
                for (const roll of ROLLS) {
                  const params = { dice, ties, critOn, advantage: allowed };
                  const input = ResolveInput.parse({ target, modifier, advantage, roll });
                  const ctx = { ctx: { params }, input } as never;
                  const refusal = op.validate?.(ctx);
                  out.push({ params, input, refusal: refusal ?? null, deltas: refusal ? null : op.apply(ctx) });
                }
  return out;
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
  sumVsTarget: sumVsTargetVectors(),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(vectors));
console.log(
  `vectors: ${vectors.expr.length} expr, ${vectors.canonical.length} canonical, ${vectors.dice.parse.length} dice,` +
    ` ${vectors.dice.roll.length} rolls, ${vectors.sumVsTarget.length} sumVsTarget`,
);
