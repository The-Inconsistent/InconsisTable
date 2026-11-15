import type { RulesetInput } from "@inconsistable/rules-engine";

// RULESET TEMPLATES by family (house decision #46, docs/p2-plan.md decision 4): the engine's structure and nothing of
// any game: which kind of Test, which resources. No game's numbers, outcome names or entry names, so every name is a
// placeholder the user renames. Every `cite` is "" and the source's `license` is "": the validator lists them until the
// user fills them in, so a template never passes for a rule taken from a book (principle 1).
export const TEMPLATE_IDS = ["d20", "bands", "pool", "percentile", "clocks"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

const base = {
  version: "0.1.0",
  core: "^0.1.0",
  sources: [{ id: "book", title: "My book", license: "" }],
  entities: [
    {
      id: "character",
      label: "Character",
      base: "actor",
      fields: { name: { type: "text", label: "Name", visibility: "public", editableBy: "owner" } },
    },
  ],
  // One counter the user renames; no ceiling, so no number of any game.
  resources: [
    { id: "resource1", label: "Resource 1", cite: "", scope: "entity", visibility: "party", editableBy: "gm" },
  ],
} as const;

// A Test the table rolls and works out; the phone only picks what came up (house decision #41).
const outcomes = (n: 2 | 3) =>
  [
    { id: "outcomeA", label: "Outcome A", cite: "" },
    { id: "outcomeB", label: "Outcome B", cite: "" },
    { id: "outcomeC", label: "Outcome C", cite: "" },
  ].slice(0, n);

const manifest = (id: string, tests: RulesetInput["tests"]): RulesetInput => ({
  ...base,
  id,
  // The empty license is the point: it is not one of the engine's, so the validator asks for it.
  sources: [...base.sources] as unknown as RulesetInput["sources"],
  entities: [...base.entities],
  resources: [...base.resources],
  tests,
});

export const TEMPLATES: Record<TemplateId, RulesetInput> = {
  // Dice plus a modifier against a number the GM names when calling it.
  d20: manifest("my-d20-game", {
    check: {
      kind: "sumVsTarget",
      dice: "1d20",
      modifier: "ctx.modifier",
      target: "ctx.dc",
      inputs: { dc: "int", modifier: "int" },
      cite: "",
    },
  }),
  // A reported Test with three results, best first.
  bands: manifest("my-bands-game", { roll: { kind: "reported", outcomes: outcomes(3), cite: "" } }),
  // A pool of dice, the faces that score counted against a number.
  pool: manifest("my-pool-game", {
    check: {
      kind: "poolSuccesses",
      pool: "ctx.pool",
      modifier: "0",
      die: 6,
      bands: [{ id: "hit", from: 6, to: 6, worth: 1 }],
      target: "ctx.target",
      inputs: { pool: "int", target: "int" },
      cite: "",
    },
  }),
  // Roll-under is not an engine primitive: the table reads the dice and reports which result it was.
  percentile: manifest("my-percentile-game", { check: { kind: "reported", outcomes: outcomes(2), cite: "" } }),
  // A reported Test with three results; the story's clocks are run from the room's clocks, not from the ruleset.
  clocks: manifest("my-clocks-game", { roll: { kind: "reported", outcomes: outcomes(3), cite: "" } }),
};

// The skeleton as the text the import box holds.
export const templateText = (id: TemplateId) => JSON.stringify(TEMPLATES[id], null, 2);
