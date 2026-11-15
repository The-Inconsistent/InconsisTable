import type { RulesetInput } from "@inconsistable/rules-engine";

// FREEFORM: a homebrew ruleset with only the engine's structure, for made-up games and one-page games. It carries no
// game's numbers or outcome names (house decision #45, ADR 0001), and the api does not serve it: this constant is
// imported into the user's own library, once, through the ordinary owner-scoped import.
export const FREEFORM_SLUG = "freeform";

export const FREEFORM: RulesetInput = {
  id: FREEFORM_SLUG,
  version: "0.1.0",
  core: "^0.1.0",
  sources: [{ id: "freeform", title: "Freeform", license: "homebrew" }],
  entities: [
    {
      id: "character",
      label: "Character",
      base: "actor",
      fields: {
        name: { type: "text", label: "Name", visibility: "public", editableBy: "owner" },
        notes: { type: "text", label: "Notes", visibility: "owner", editableBy: "owner", maxLength: 2000 },
      },
    },
  ],
  resources: [
    {
      id: "health",
      label: "Health",
      scope: "entity",
      // ponytail: a field cannot carry a default (a missing int blocks the sheet), so the 10 is the ceiling and the GM
      // raises one character's Health past it by hand (uncapped); a per-character max once fields can default.
      max: "10",
      capped: false,
      resetOn: [{ event: "longRest", to: "max" }],
      visibility: "party",
      editableBy: "gm",
    },
  ],
  tests: {
    check: {
      kind: "reported",
      outcomes: [
        { id: "success", label: "Success" },
        { id: "partial", label: "Partial" },
        { id: "failure", label: "Failure" },
      ],
    },
  },
  // Round the table, so a made-up game can still run a fight (house decision #45).
  initiative: { strategy: "seated", firstPlayer: "rotate" },
  health: { tracks: [{ resource: "health" }], states: [] },
  game: { title: "Freeform", players: { min: 1, max: 12 }, modes: ["gm", "gmless", "solo"], genres: [] },
};
