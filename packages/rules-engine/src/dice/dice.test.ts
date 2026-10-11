import assert from "node:assert/strict";
import { test } from "node:test";

import { cryptoRng, MAX_DICE, MAX_EXPLODE_DEPTH, MAX_SIDES, parseDice, rollDice, seededRng, type Rng } from "./dice.ts";

/** Plays back a fixed list of faces, so a test states exactly what was rolled. */
function scripted(faces: number[]): Rng {
  let i = 0;
  return () => {
    const f = faces[i++];
    if (f === undefined) throw new Error("scripted rng ran out");
    return f;
  };
}

function refused(notation: string, pattern: RegExp) {
  const r = parseDice(notation);
  assert.equal(r.ok, false, `${notation} should be refused`);
  if (!r.ok) assert.match(r.error, pattern);
}

test("grammar: NdX, constants, implicit count", () => {
  const r = parseDice("2d6 + 3 - d4");
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(
    r.dice.terms.map((t) => (t.kind === "const" ? ["const", t.sign, t.value] : ["dice", t.sign, t.count, t.die])),
    [
      ["dice", 1, 2, 6],
      ["const", 1, 3],
      ["dice", -1, 1, 4],
    ],
  );
  assert.equal(rollDice({ notation: "2d6+3-d4", rng: scripted([4, 5, 2]) }).total, 10);
});

test("keep highest / lowest, with spaces allowed", () => {
  const kh = rollDice({ notation: "4d6 kh 3", rng: scripted([2, 6, 2, 5]) });
  assert.equal(kh.total, 13);
  // Equal faces keep roll order: the first 2 is kept, the second dropped.
  assert.deepEqual(kh.terms[0]?.kept, [true, true, false, true]);
  assert.equal(rollDice({ notation: "2d20kl1", rng: scripted([17, 4]) }).total, 4);
  refused("2d6kh3", /keep must be 1–2/);
  refused("2d6kh1kl1", /only one kh\/kl/);
});

test("explode adds a die on the max face, up to the depth cap", () => {
  const r = rollDice({ notation: "2d6!", rng: scripted([6, 6, 2, 3]) });
  assert.deepEqual(r.faces, [6, 6, 2, 3]);
  assert.equal(r.total, 17);
  // An rng stuck on the max stops after MAX_EXPLODE_DEPTH extra dice.
  const stuck = rollDice({ notation: "1d6!", rng: () => 6 });
  assert.equal(stuck.faces.length, 1 + MAX_EXPLODE_DEPTH);
  refused("1d1!", /cannot explode d1/);
  refused("2dF!", /cannot explode dF/);
  refused("d66!", /cannot explode/);
});

test("success counting", () => {
  const r = rollDice({ notation: "5d10>=7", rng: scripted([7, 3, 10, 6, 9]) });
  assert.equal(r.total, 3);
  assert.equal(rollDice({ notation: "3d6kh2>=5", rng: scripted([5, 1, 6]) }).total, 2);
  refused("2dF>=1", /cannot count successes on dF/);
});

test("d66 and Fudge dice", () => {
  assert.equal(rollDice({ notation: "d66", rng: scripted([3, 5]) }).total, 35);
  assert.equal(rollDice({ notation: "4dF", rng: scripted([1, 2, 3, 3]) }).total, 1);
  // d666 is a 666-sided die, not d66 followed by junk.
  const big = parseDice("d666");
  assert.ok(big.ok && big.dice.terms[0]?.kind === "dice" && big.dice.terms[0].die === 666);
});

test("caps", () => {
  assert.ok(parseDice(`${MAX_DICE}d6`).ok);
  refused(`${MAX_DICE + 1}d6`, /dice count must be/);
  assert.ok(parseDice(`1d${MAX_SIDES}`).ok);
  refused(`1d${MAX_SIDES + 1}`, /1–1000 sides/);
  refused("0d6", /dice count must be/);
  refused("1d0", /sides/);
  refused("5", /no dice/);
  refused("1d6 * 2", /unexpected "\*"/);
  refused("1d6+", /expected a number or dice/);
  refused(Array.from({ length: 21 }, () => "1").join("+") + "+d6", /more than 20 terms/);
});

test("rollDice throws on bad notation and on a misbehaving rng", () => {
  assert.throws(() => rollDice({ notation: "1d1001" }), /sides/);
  assert.throws(() => rollDice({ notation: "1d6", rng: () => 7 }), /rng returned 7 for a d6/);
});

test("a seeded rng is deterministic", () => {
  const a = rollDice({ notation: "10d20", rng: seededRng(42) });
  const b = rollDice({ notation: "10d20", rng: seededRng(42) });
  const c = rollDice({ notation: "10d20", rng: seededRng(43) });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.faces, c.faces);
  assert.ok(a.faces.every((f) => f >= 1 && f <= 20));
});

test("the crypto rng stays in range", () => {
  for (let i = 0; i < 2000; i++) {
    const f = cryptoRng(6);
    assert.ok(Number.isInteger(f) && f >= 1 && f <= 6);
  }
  const r = rollDice({ notation: "3d8" });
  assert.equal(r.faces.length, 3);
});
