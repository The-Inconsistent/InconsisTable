import type { RulesetInput } from "../manifest.ts";
import { SAMPLE_D20_0_1_8 } from "./sample-d20.ts";

/**
 * A placeholder ruleset written for tests: sample-d20 plus one campaign field, a danger tier read by a character value
 * and by a creature's pick among five numbered forms. Every name and number is our own invention.
 */
export const SAMPLE_TIERED: RulesetInput = {
  ...SAMPLE_D20_0_1_8,
  id: "sample-tiered",
  version: "0.1.0",
  campaignFields: { danger: { type: "int", label: "Danger", min: 1, max: 5, default: 1, cite: "Sample p.14" } },
  entities: SAMPLE_D20_0_1_8.entities.map((e) => {
    if (e.id === "character") {
      return {
        ...e,
        derived: [
          ...(e.derived ?? []),
          { id: "dangerHp", label: "Danger Vigour", expr: "derived.maxHp + campaign.danger", visibility: "party" },
        ],
      };
    }
    if (e.id !== "creature") return e;
    return {
      ...e,
      fields: {
        ...e.fields,
        "form.f1": { type: "int", label: "Form 1" },
        "form.f2": { type: "int", label: "Form 2" },
        "form.f3": { type: "int", label: "Form 3" },
        "form.f4": { type: "int", label: "Form 4" },
        "form.f5": { type: "int", label: "Form 5" },
      },
      derived: [...(e.derived ?? []), { id: "formNow", label: "Form now", expr: "at(form, campaign.danger)" }],
    };
  }),
};
