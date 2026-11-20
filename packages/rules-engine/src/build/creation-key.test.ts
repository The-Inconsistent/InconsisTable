import assert from "node:assert/strict";
import { test } from "node:test";

import { creationKey } from "./creation-key.ts";
import { SAMPLE_PARAMS } from "./fixtures/sample-ledger.ts";
import { buildSchemas } from "./schemas.ts";

const { CharacterBuild } = buildSchemas(SAMPLE_PARAMS);
const key = (b: unknown) => creationKey(CharacterBuild.parse(b));

const made = {
  tier: 1,
  archetypeId: "lamplighter",
  skills: { Lore: 3, Brawl: 1 },
  choices: { "talent/a": ["x"] },
  wealth: 1,
};

test("creationKey ignores key order, the advancement, advance/ choices and the GM's part", () => {
  const k = key(made);
  assert.equal(
    key({
      wealth: 1,
      choices: { "talent/a": ["x"] },
      skills: { Brawl: 1, Lore: 3 },
      archetypeId: "lamplighter",
      tier: 1,
    }),
    k,
  );
  assert.equal(key({ ...made, choices: { ...made.choices, "advance/talent/b": [0] } }), k);
  assert.equal(key({ ...made, advancement: { skills: { Lore: 4 }, boughtIn: { x: 1 } }, gm: { approved: ["p"] } }), k);
});

test("creationKey changes with a creation choice", () => {
  const k = key(made);
  assert.notEqual(key({ ...made, wealth: 2 }), k);
  assert.notEqual(key({ ...made, skills: { Lore: 2, Brawl: 1 } }), k);
  assert.notEqual(key({ ...made, choices: { "talent/a": ["y"] } }), k);
});
