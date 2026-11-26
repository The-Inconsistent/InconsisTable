// Every sample ruleset the engine's own tests carry, made up and pointing at no real book: what each seat is served of
// each must compile (house decision #101).
import type { RulesetInput } from "../../../../packages/rules-engine/src/manifest.ts";
import { SAMPLE_D20, SAMPLE_D20_BEFORE_WIDGETS } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_DUEL } from "../../../../packages/rules-engine/src/fixtures/sample-duel.ts";
import { SAMPLE_HARM, SAMPLE_HARM_BEFORE_HELD } from "../../../../packages/rules-engine/src/fixtures/sample-harm.ts";
import { SAMPLE_HARVEST } from "../../../../packages/rules-engine/src/fixtures/sample-harvest.ts";
import { SAMPLE_LEDGER_RULESET } from "../../../../packages/rules-engine/src/fixtures/sample-ledger-ruleset.ts";
import { SAMPLE_NO_ORDER } from "../../../../packages/rules-engine/src/fixtures/sample-no-order.ts";
import { SAMPLE_POOL } from "../../../../packages/rules-engine/src/fixtures/sample-pool.ts";
import { SAMPLE_SCOPED } from "../../../../packages/rules-engine/src/fixtures/sample-scoped.ts";
import {
  SAMPLE_SKIRMISH,
  SAMPLE_SKIRMISH_BEFORE_CHECKLIST,
  SAMPLE_SKIRMISH_BEFORE_ONCE_PER_ROUND,
  SAMPLE_SKIRMISH_BEFORE_SPAWN,
} from "../../../../packages/rules-engine/src/fixtures/sample-skirmish.ts";
import { SAMPLE_TIERED } from "../../../../packages/rules-engine/src/fixtures/sample-tiered.ts";

export const SAMPLE_RULESETS: Record<string, RulesetInput> = {
  d20: SAMPLE_D20,
  d20BeforeWidgets: SAMPLE_D20_BEFORE_WIDGETS,
  duel: SAMPLE_DUEL,
  harm: SAMPLE_HARM,
  harmBeforeHeld: SAMPLE_HARM_BEFORE_HELD,
  harvest: SAMPLE_HARVEST,
  ledger: SAMPLE_LEDGER_RULESET,
  noOrder: SAMPLE_NO_ORDER,
  pool: SAMPLE_POOL,
  scoped: SAMPLE_SCOPED,
  skirmish: SAMPLE_SKIRMISH,
  skirmishBeforeChecklist: SAMPLE_SKIRMISH_BEFORE_CHECKLIST,
  skirmishBeforeOncePerRound: SAMPLE_SKIRMISH_BEFORE_ONCE_PER_ROUND,
  skirmishBeforeSpawn: SAMPLE_SKIRMISH_BEFORE_SPAWN,
  tiered: SAMPLE_TIERED,
};

const duelist = SAMPLE_DUEL.entities[0]!;
const lunge = SAMPLE_DUEL.strikes![0]!;
const d20Site = SAMPLE_D20.entities.find((e) => e.id === "site")!;
const harmIncoming = SAMPLE_HARM.panels![0]!;

/**
 * Made up to reach the cuts the stack's blocks need for a seat (house decision #101): a `gm` nerve and a `gm` list of
 * blades a duel's strike reads in a means, a further number and a note (each goes alone) and a feint's number to beat
 * (the feint goes whole); and the d20 sample with a site's peril `gm`, which a codex kind's `from` maps (the mapping
 * goes) and, through a creature's level, a generator's pick filter (the generator goes).
 */
export const CRAFTED_SEAT_CUTS: Record<string, RulesetInput> = {
  duelCuts: {
    ...SAMPLE_DUEL,
    entities: [
      {
        ...duelist,
        fields: {
          ...duelist.fields,
          nerve: { type: "int", label: "Nerve", min: 0, max: 5, visibility: "gm" },
          hidden: { type: "list", label: "Hidden blades", visibility: "gm" },
        },
      },
      ...SAMPLE_DUEL.entities.slice(1),
    ],
    strikes: [
      {
        ...lunge,
        means: [...lunge.means!, { from: "list", field: "hidden", entry: "blade" }],
        shows: [{ id: "flair", label: "Flair", expr: "nerve", cite: "Sample p.5" }],
        notes: [
          { text: "Steady hand", when: "nerve > 2", cite: "Sample p.5" },
          { text: "A clean line", cite: "Sample p.5" },
        ],
      },
      {
        ...lunge,
        id: "feint",
        label: "Feint",
        beat: { label: "Parry", expr: "ctx.target.parry", adds: [{ label: "Nerve", by: "ctx.target.nerve" }] },
      },
    ],
  },
  d20Cuts: {
    ...SAMPLE_D20,
    entities: SAMPLE_D20.entities.map((e) =>
      e === d20Site ? { ...e, fields: { ...e.fields, peril: { ...d20Site.fields!.peril!, visibility: "gm" } } } : e,
    ),
  },
  // House decision #114: a hero's `gm` doom and dread. Incoming loses only the line and the figure that read the doom,
  // the dread panel (its `when`) and the shiver panel (its `opensOn`) go whole, and so do their layout rows.
  harmPanelCuts: {
    ...SAMPLE_HARM,
    entities: SAMPLE_HARM.entities.map((e) =>
      e.id === "hero" ? { ...e, fields: { ...e.fields, doom: { type: "int", label: "Doom", visibility: "gm" } } } : e,
    ),
    resources: [
      ...(SAMPLE_HARM.resources ?? []),
      {
        id: "dread",
        label: "Dread",
        cite: "Sample p.30",
        scope: "entity",
        entities: ["hero"],
        max: "5",
        visibility: "gm",
      },
    ],
    layout: {
      hero: {
        ...SAMPLE_HARM.layout!.hero!,
        phoneTurn: [
          ...(SAMPLE_HARM.layout!.hero!.phoneTurn ?? []),
          { widget: "panel", variant: "dread" },
          { widget: "panel", variant: "shiver" },
        ],
      },
    },
    panels: [
      {
        ...harmIncoming,
        lines: [...(harmIncoming.lines ?? []), { text: "Doom draws near", when: "doom > 2", cite: "Sample p.30" }],
        figures: [...(harmIncoming.figures ?? []), { label: "Doom", expr: "doom", cite: "Sample p.30" }],
      },
      ...SAMPLE_HARM.panels!.slice(1),
      {
        id: "dread",
        label: "Dread",
        cite: "Sample p.30",
        entities: ["hero"],
        when: "doom > 0",
        lines: [{ text: "It watches" }],
      },
      {
        id: "shiver",
        label: "Shiver",
        cite: "Sample p.30",
        entities: ["hero"],
        opensOn: { rises: "dread" },
        lines: [{ text: "Cold" }],
      },
    ],
  },
};
