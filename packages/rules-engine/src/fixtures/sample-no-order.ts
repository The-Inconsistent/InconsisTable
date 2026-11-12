import type { RulesetInput } from "../manifest.ts";
import { SAMPLE_D20 } from "./sample-d20.ts";

const { initiative: _turnOrder, ...withoutOrder } = SAMPLE_D20;
void _turnOrder;

/**
 * A placeholder homebrew ruleset written for tests: the sample-d20 characters with no turn order and a four-level
 * Test (degrees of success, house decision #42). Every name and number is our own invention; it describes no game.
 */
export const SAMPLE_NO_ORDER: RulesetInput = {
  ...withoutOrder,
  id: "sample-no-order",
  version: "0.1.0",
  sources: [{ id: "sample", title: "Sample table rules", license: "homebrew", pageOffset: 0 }],
  tests: {
    ordeal: {
      kind: "sumVsTarget",
      dice: "1d20",
      modifier: "mod(attr[ctx.ability])",
      target: "ctx.dc",
      degrees: { step: 5, naturalShift: true },
      inputs: { ability: "text", dc: "int" },
      inputOptions: { ability: ["str", "dex", "con"] },
    },
  },
};
