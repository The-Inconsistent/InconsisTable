import assert from "node:assert/strict";
import { test } from "node:test";

import { amountOf, barPercent, leftText, pressKey, stateWord } from "./track.ts";

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
  assert.equal(stateWord({ current: true, healthState: "ok" }), "ACTING");
  assert.equal(stateWord({ current: true, healthState: "dying" }), "DOWN");
  assert.equal(stateWord({ current: false, healthState: "dead" }), "DEAD");
  assert.equal(stateWord({ current: false, healthState: undefined }), "");
});

test("a condition's time left, and a bar's width", () => {
  assert.equal(leftText({ left: 1, expiresOn: "ownTurnEnd" }), "1 turn");
  assert.equal(leftText({ left: 3, expiresOn: "roundEnd" }), "3 rounds");
  assert.equal(leftText({ left: null, expiresOn: "manual" }), "");
  assert.equal(barPercent({ bar: 4 / 7 }), 57);
  assert.equal(barPercent({ bar: null }), null);
});
