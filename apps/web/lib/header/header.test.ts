import assert from "node:assert/strict";
import { test } from "node:test";

import { headerItems } from "./header.ts";

const ruleset = {
  campaignFields: {
    peril: { type: "int" as const, label: "Peril", min: 1, max: 5, default: 1 },
    mood: {
      type: "enum" as const,
      label: "Mood",
      values: ["calm", "tense"],
      labels: { tense: "Tense" },
      default: "calm",
    },
    watch: { type: "bool" as const, label: "Watch", default: false },
  },
};
const withHeader = (header: object) => ({ ...ruleset, header }) as Parameters<typeof headerItems>[0]["ruleset"];
const fight = { round: 3 };

test("a ruleset without a header block, or none at all, draws nothing", () => {
  assert.deepEqual(headerItems({ ruleset: ruleset as never, campaign: { peril: 2 }, encounter: fight }), []);
  assert.deepEqual(headerItems({ ruleset: null, campaign: {}, encounter: fight }), []);
});

test("fields come in the declared order with the ruleset's own label and word", () => {
  const items = headerItems({
    ruleset: withHeader({ fields: ["mood", "peril", "watch"] }),
    campaign: { peril: 2, mood: "tense", watch: false },
    encounter: null,
  });
  assert.deepEqual(items, [
    { kind: "field", id: "mood", label: "Mood", value: "Tense" },
    { kind: "field", id: "peril", label: "Peril", value: 2 },
    { kind: "field", id: "watch", label: "Watch", value: false },
  ]);
});

test("an enum value without a label shows as its id", () => {
  const items = headerItems({ ruleset: withHeader({ fields: ["mood"] }), campaign: { mood: "calm" }, encounter: null });
  assert.equal(items[0]?.kind === "field" && items[0].value, "calm");
});

test("the round shows only while a fight runs and the block asks for it", () => {
  const asked = withHeader({ round: true });
  assert.deepEqual(headerItems({ ruleset: asked, campaign: {}, encounter: fight }), [{ kind: "round", round: 3 }]);
  assert.deepEqual(headerItems({ ruleset: asked, campaign: {}, encounter: null }), []);
  assert.deepEqual(
    headerItems({ ruleset: withHeader({ fields: ["peril"] }), campaign: { peril: 1 }, encounter: fight }),
    [{ kind: "field", id: "peril", label: "Peril", value: 1 }],
  );
});

test("an undeclared or empty value draws nothing for that field", () => {
  const items = headerItems({
    ruleset: withHeader({ fields: ["gone", "peril", "mood"], round: true }),
    campaign: { mood: "" },
    encounter: fight,
  });
  assert.deepEqual(items, [{ kind: "round", round: 3 }]);
});
