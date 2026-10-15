import assert from "node:assert/strict";
import { test } from "node:test";

import { amountOf, barPercent, leftOf, pressKey, stateKey } from "./track.ts";

test("the keypad types a whole number of at most four digits", () => {
  const type = (keys: string[]) => keys.reduce((entry, key) => pressKey({ entry, key }), "");
  assert.equal(type(["0", "0", "7"]), "7");
  assert.equal(type(["1", "2", "3", "4", "5"]), "1234");
  assert.equal(type(["1", "2", "back"]), "1");
  assert.equal(type(["9", "clear"]), "");
  assert.equal(type(["x", "-"]), "");
  assert.equal(amountOf(""), 0);
  assert.equal(amountOf("42"), 42);
});

test("a combatant's state is a word", () => {
  assert.equal(stateKey({ current: true, healthState: "ok" }), "acting");
  assert.equal(stateKey({ current: true, healthState: "dying" }), "down");
  assert.equal(stateKey({ current: false, healthState: "dead" }), "dead");
  assert.equal(stateKey({ current: false, healthState: undefined }), null);
});

test("a condition's time left, and a bar's width", () => {
  assert.deepEqual(leftOf({ left: 1, expiresOn: "ownTurnEnd" }), { count: 1, unit: "turn" });
  assert.deepEqual(leftOf({ left: 3, expiresOn: "roundEnd" }), { count: 3, unit: "round" });
  assert.equal(leftOf({ left: null, expiresOn: "manual" }), null);
  assert.equal(barPercent({ bar: 4 / 7 }), 57);
  assert.equal(barPercent({ bar: null }), null);
});
