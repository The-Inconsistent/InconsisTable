import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_EXPR_LENGTH, MAX_EXPR_NODES, type ExprRecord, type ExprScope } from "./expr.ast.ts";
import { parseExpr } from "./expr.parser.ts";
import { compileExpr, evaluateExpr, type CompiledExpr } from "./expr.ts";

const SCOPE: ExprScope = {
  attr: { record: { str: "int", dex: "int", con: "int" } },
  skill: { record: { attr: "text", rank: "int" } },
  derived: { record: { maxHp: "int" } },
  res: { record: { hp: "int", tempHp: "int" } },
  party: { record: { characters: "int" } },
  tags: { list: "text" },
  rolls: { list: "int" },
  name: "text",
  ready: "bool",
};

const VALUES: ExprRecord = {
  attr: { str: 15, dex: 8, con: 12 },
  skill: { attr: "str", rank: 2 },
  derived: { maxHp: 20 },
  res: { hp: 7 },
  party: { characters: 4 },
  tags: ["brave", "loud"],
  rolls: [3, 9, 4],
  name: "Ash",
  ready: true,
};

function compiled(source: string): CompiledExpr {
  const r = compileExpr({ source, scope: SCOPE });
  if (!r.ok) throw new Error(`${source}: ${r.error}`);
  return r.expr;
}

function run(source: string) {
  return evaluateExpr({ expr: compiled(source), scope: VALUES });
}

function refused(source: string, pattern: RegExp, scope: ExprScope = SCOPE) {
  const r = compileExpr({ source, scope });
  assert.equal(r.ok, false, `${source} should be refused`);
  if (!r.ok) assert.match(r.error, pattern);
}

test("arithmetic follows precedence and associativity", () => {
  assert.equal(run("1 + 2 * 3"), 7);
  assert.equal(run("(1 + 2) * 3"), 9);
  assert.equal(run("10 - 4 - 3"), 3);
  assert.equal(run("-2 * 3"), -6);
  assert.equal(run("2 * -attr.dex"), -16);
});

test("division floors and modulo is floored", () => {
  assert.equal(run("7 / 2"), 3);
  assert.equal(run("-7 / 2"), -4);
  assert.equal(run("7 / -2"), -4);
  assert.equal(run("-7 % 3"), 2);
  assert.equal(run("7 % 3"), 1);
  assert.throws(() => run("1 / 0"), /division by zero/);
  assert.throws(() => run("1 % 0"), /modulo by zero/);
});

test("division and modulo stay exact up to the largest safe integer", () => {
  const MAX = 2 ** 53 - 1;
  const magnitudes = [1, 2, 3, 7, 2 ** 52 - 1, 2 ** 52, 2 ** 52 + 1, MAX - 2, MAX - 1, MAX];
  let seed = 53;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 30; i++) magnitudes.push((next() % 2 ** 21) * 2 ** 32 + next(), next() % 1000);
  const write = (n: number) => (n < 0 ? `-${-n}` : `${n}`);
  for (const x of [0, ...magnitudes])
    for (const y of magnitudes)
      for (const a of [x, -x])
        for (const b of [y, -y]) {
          if (b === 0) continue;
          const big = { a: BigInt(a), b: BigInt(b) };
          let q = big.a / big.b;
          if (big.a % big.b !== 0n && big.a < 0n !== big.b < 0n) q -= 1n;
          const m = big.a - big.b * q;
          const src = `${write(a)} / ${write(b)}`;
          if (q > BigInt(MAX) || q < -BigInt(MAX)) assert.throws(() => run(src), /integer overflow/, src);
          // + 0 folds negative zero, which JSON prints as 0 anyway.
          else assert.equal((run(src) as number) + 0, Number(q), src);
          assert.equal((run(`${write(a)} % ${write(b)}`) as number) + 0, Number(m), `${src} remainder`);
        }
  assert.equal(run("9007199254740990 % 9007199254740991"), 9007199254740990);
  assert.equal(run("9007199254740990 / 9007199254740991"), 0);
  assert.equal(run("ceil(9007199254740990, 9007199254740991)"), 1);
});

test("comparisons, logic and right-associative ternary", () => {
  assert.equal(run("attr.str >= 15 && !(attr.dex > 10)"), true);
  assert.equal(run('attr.str < 10 || name == "Ash"'), true);
  assert.equal(run("attr.str > 20 ? 1 : attr.str > 10 ? 2 : 3"), 2);
  assert.equal(run('skill.attr != "dex"'), true);
});

test("member paths and computed index", () => {
  assert.equal(run("attr[skill.attr] + skill.rank"), 17);
  assert.equal(run('attr["con"]'), 12);
  assert.equal(run("rolls[1]"), 9);
  assert.equal(run("derived.maxHp - res.hp"), 13);
  assert.deepEqual(compiled("attr[skill.attr] + derived.maxHp").refs, ["attr.*", "derived.maxHp", "skill.attr"]);
});

test("whitelisted functions", () => {
  assert.equal(run("mod(attr.str)"), 2);
  assert.equal(run("mod(attr.dex)"), -1);
  assert.equal(run("min(3, attr.dex, 5)"), 3);
  assert.equal(run("max(rolls)"), 9);
  assert.equal(run("min(rolls)"), 3);
  assert.equal(run("clamp(attr.str, 0, 10)"), 10);
  // A max below the min collapses to the min.
  assert.equal(run("clamp(5, 8, 2)"), 8);
  assert.equal(run("abs(-4)"), 4);
  assert.equal(run("floor(7, 2)"), 3);
  assert.equal(run("ceil(7, 2)"), 4);
  assert.equal(run("ceil(-7, 2)"), -3);
  assert.equal(run("floor(5)"), 5);
  assert.equal(run("count(tags)"), 2);
  assert.equal(run("sum(rolls)"), 16);
  assert.equal(run("party.characters + 2"), 6);
});

test("has() tolerates a missing value and && short-circuits past it", () => {
  assert.equal(run("has(res.tempHp)"), false);
  assert.equal(run("has(res.hp)"), true);
  assert.equal(run("has(res.tempHp) && res.tempHp > 0"), false);
  assert.throws(() => run("res.tempHp + 1"), /missing value "res.tempHp"/);
});

test("unknown identifiers are refused at compile time", () => {
  refused("attr.wis + 1", /unknown identifier "attr.wis"/);
  refused("strength + 1", /unknown identifier "strength"/);
  refused('attr["wis"]', /unknown identifier "attr.wis"/);
  // Object.prototype members are not scope entries.
  refused("constructor", /unknown identifier "constructor"/);
  refused("attr.toString", /unknown identifier "attr.toString"/);
});

test("only whitelisted functions may be called", () => {
  refused("eval(1)", /unknown function "eval"/);
  refused("pow(2, 3)", /unknown function "pow"/);
  refused("attr.str(1)", /unexpected/);
  refused("min()", /min\(\) takes at least 1/);
  refused("clamp(1, 2)", /clamp\(\) takes 3/);
  refused("has(1 + 2)", /has\(\) takes a path/);
});

test("types are checked", () => {
  refused("name + 1", /left of "\+" must be int, got text/);
  refused("ready ? 1 : name", /else branch must be int/);
  refused("attr.str && ready", /must be bool/);
  refused("attr == 1", /compares values/);
  refused("count(attr.str)", /count\(\) takes a list/);
  refused('rolls["x"]', /list index must be int/);
  // A record of mixed types cannot be indexed with a computed key.
  refused("mixed[skill.attr]", /mixes value types/, { ...SCOPE, mixed: { record: { a: "int", b: "text" } } });
  assert.deepEqual(compileExpr({ source: "attr.str > 1", scope: SCOPE, expect: "int" }), {
    ok: false,
    error: "must be int, got bool",
  });
});

test("syntax errors", () => {
  refused("1 +", /unexpected end/);
  refused("1.5", /integers only/);
  refused("(1", /expected "\)"/);
  refused("1 2", /unexpected "2"/);
  refused("a = 1", /unexpected character "="/);
  refused('"open', /unterminated string/);
  refused("99999999999999999999", /too large/);
});

test("node and length caps", () => {
  // n literals joined by "+" make 2n - 1 nodes.
  const atCap = Array.from({ length: (MAX_EXPR_NODES + 1) / 2 }, () => "1").join("+");
  assert.equal(parseExpr(atCap).k, "binary");
  const overCap = `${atCap}+1`;
  refused(overCap, new RegExp(`more than ${MAX_EXPR_NODES} nodes`));
  refused("1".padEnd(MAX_EXPR_LENGTH + 1, " "), /longer than/);
});

test("overflow is an error, not a silent float", () => {
  assert.throws(() => run("9007199254740991 + 1"), /overflow/);
});

test("the AST is plain JSON", () => {
  const ast = parseExpr("mod(attr[skill.attr]) > 0 ? 1 : 0");
  assert.deepEqual(JSON.parse(JSON.stringify(ast)), ast);
});
