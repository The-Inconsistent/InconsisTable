import type { RulesetInput } from "../manifest.ts";

/**
 * A placeholder ruleset written for tests of `health.harm` (house decision #66): heroes whose wounds count up until
 * they fall, brutes that never take strain, and swarms that stand for many members. Since 0.1.2 a lookup the GM types
 * a result into (house decision #87): a switch that changes the wounds, surge dice that raise the total, a stacking
 * condition brutes are immune to, applied again for each point of press, an open-ended last line, and a line that
 * sends the GM to a second table. Every name, number and cite is our own invention ("Sample p.N" points at no real
 * book). This is 0.1.2; SAMPLE_HARM, below, adds what a hero holds in play.
 */
export const SAMPLE_HARM_BEFORE_HELD: RulesetInput = {
  id: "sample-harm",
  version: "0.1.2",
  core: "^0.1.0",
  sources: [{ id: "sample", title: "Sample Harm Rules", license: "private", pageOffset: 0 }],
  entities: [
    {
      id: "hero",
      label: "Hero",
      base: "actor",
      fields: {
        grit: { type: "int", label: "Grit", min: 1, max: 10, visibility: "party", editableBy: "owner" },
        scars: { type: "int", label: "Scars", min: 0, visibility: "party" },
        gone: { type: "bool", label: "Gone", visibility: "party" },
      },
      derived: [
        { id: "limit", label: "Wound limit", expr: "grit + 3", visibility: "party", cite: "Sample p.2" },
        { id: "strainCap", label: "Strain limit", expr: "grit", visibility: "party", cite: "Sample p.2" },
      ],
    },
    {
      id: "brute",
      label: "Brute",
      base: "actor",
      fields: { hide: { type: "int", label: "Hide", min: 1 }, gone: { type: "bool", label: "Gone" } },
      derived: [
        { id: "limit", label: "Wound limit", expr: "hide", cite: "Sample p.5" },
        { id: "strainCap", label: "Strain limit", expr: "0", cite: "Sample p.5" },
      ],
    },
    {
      id: "swarm",
      label: "Swarm",
      base: "actor",
      fields: { size: { type: "int", label: "Size", min: 1, max: 500, visibility: "party" } },
      derived: [
        { id: "limit", label: "Wound limit", expr: "1", cite: "Sample p.6" },
        { id: "strainCap", label: "Strain limit", expr: "2", cite: "Sample p.6" },
      ],
    },
  ],
  resources: [
    {
      id: "wounds",
      label: "Wounds",
      cite: "Sample p.3",
      scope: "entity",
      max: "derived.limit",
      capped: false,
      start: "0",
      visibility: "party",
    },
    {
      id: "strain",
      label: "Strain",
      cite: "Sample p.3",
      scope: "entity",
      max: "derived.strainCap",
      capped: false,
      start: "0",
      visibility: "party",
      resetOn: [{ event: "longRest", to: "0" }],
    },
    {
      id: "resolve",
      label: "Resolve",
      cite: "Sample p.8",
      scope: "entity",
      entities: ["hero"],
      max: "3",
      start: "2",
      visibility: "party",
    },
    {
      id: "members",
      label: "Members",
      cite: "Sample p.6",
      scope: "entity",
      entities: ["swarm"],
      max: "size",
      visibility: "party",
    },
  ],
  conditions: [
    { id: "down", label: "Down", cite: "Sample p.4", duration: "manual", visibility: "party" },
    { id: "winded", label: "Winded", cite: "Sample p.4", duration: "manual", visibility: "party" },
    {
      id: "dazed",
      label: "Dazed",
      cite: "Sample p.4",
      duration: "manual",
      stacking: "stack",
      maxStacks: 3,
      visibility: "party",
      immune: "derived.strainCap == 0",
    },
  ],
  tables: {
    blow: {
      title: "Telling Blow",
      die: "d66",
      visibility: "gm",
      cite: "Sample p.8",
      typedOnly: true,
      entities: ["hero", "brute"],
      inputs: [
        { id: "past", label: "Past the hide", type: "bool", cite: "Sample p.8" },
        { id: "surge", label: "Surge dice", type: "int", min: 0, max: 4, cite: "Sample p.8" },
        { id: "press", label: "Press", type: "int", min: 0, max: 3, cite: "Sample p.9" },
      ],
      modifier: "ctx.surge * 10",
      entries: [
        { id: "graze", label: "Graze", range: [11, 36], apply: [{ kind: "harm", wounds: "ctx.past ? 2 : 1" }] },
        {
          id: "reel",
          label: "Reel",
          range: [41, 56],
          apply: [
            { kind: "harm", wounds: "2", when: "ctx.past" },
            { kind: "harm", wounds: "1", when: "!ctx.past" },
            { kind: "condition", condition: "dazed", when: "ctx.past" },
            { kind: "condition", condition: "dazed", when: "ctx.past", times: "ctx.press" },
          ],
          note: "The foe staggers back a step",
          cite: "Sample p.9",
        },
        {
          id: "ruin",
          label: "Ruin",
          range: [61],
          apply: [{ kind: "harm", wounds: "ctx.past ? 4 : 1" }],
          cite: "Sample p.9",
          next: "aftermath",
        },
      ],
    },
    aftermath: {
      title: "Aftermath",
      die: "d6",
      visibility: "gm",
      cite: "Sample p.10",
      entries: [
        { id: "limp", label: "Limp", range: [1, 3] },
        { id: "scar", label: "Scar", range: [4, 6] },
      ],
    },
  },
  initiative: { strategy: "seated", firstPlayer: "fixed", cite: "Sample p.7" },
  health: {
    states: [
      { id: "hurt", label: "Hurt", when: "res.wounds > 0 && res.wounds <= derived.limit", entities: ["hero", "brute"] },
      { id: "fallen", label: "Fallen", when: "res.wounds > derived.limit", entities: ["hero", "brute"] },
      { id: "routing", label: "Routing", when: "res.members * 2 <= size && res.members > 0", entities: ["swarm"] },
    ],
    harm: {
      cite: "Sample p.3",
      wounds: "wounds",
      shock: "strain",
      mob: { members: "members", start: "size" },
      profiles: [
        {
          entities: ["hero"],
          spent: { when: "res.strain > derived.strainCap", conditions: ["winded"] },
          felled: { when: "res.wounds > derived.limit", injuries: "scars", condition: "down", healTo: "derived.limit" },
          destroyed: { over: "derived.limit * 2", field: "gone" },
          convert: true,
        },
        {
          entities: ["brute"],
          shockless: "derived.strainCap == 0",
          destroyed: { over: "derived.limit * 2", field: "gone" },
        },
        { entities: ["swarm"] },
      ],
    },
  },
  // House decision #84: a costed spend with no effect, one that pays a personal resource and heals by an expression,
  // and a free one that converts harm by a number the player reports.
  spends: [
    {
      id: "retry",
      label: "Try again",
      cite: "Sample p.8",
      entities: ["hero"],
      cost: [{ resource: "resolve", amount: "1" }],
    },
    {
      id: "steady",
      label: "Steady yourself",
      cite: "Sample p.8",
      entities: ["hero"],
      cost: [{ resource: "resolve", amount: "1" }],
      if: "res.strain > 0 && res.wounds <= derived.limit",
      run: [{ primitive: "health.harm", op: "hit", input: { actorId: "ctx.self", shock: "-grit" } }],
    },
    {
      id: "endure",
      label: "Endure",
      cite: "Sample p.9",
      entities: ["hero"],
      cost: [],
      inputs: { marks: { label: "Marks rolled", min: 1, max: "grit * 2" } },
      run: [{ primitive: "health.harm", op: "convert", input: { actorId: "ctx.self", amount: "ctx.marks" } }],
      clearOn: ["encounterEnd"],
    },
  ],
};

const [hero, ...others] = SAMPLE_HARM_BEFORE_HELD.entities ?? [];

/**
 * sample-harm 0.1.3 (house decision #88): a hero gains growths in play, pack entries of the type `growth` kept in its
 * `growths` list, seen by name only by the hero's player and the GM side ("Unseen" to everyone else). The GM steps
 * through a chain of tables with one hero: the Omen's d6 picks the Lesser or the Greater table; the Lesser's d66 adds
 * 10 for each growth the hero holds already, and its top line sends the GM on to the Greater; a line of either grants
 * its growth. Nothing is granted until the last step is applied.
 */
export const SAMPLE_HARM_BEFORE_STRIKES: RulesetInput = {
  ...SAMPLE_HARM_BEFORE_HELD,
  version: "0.1.3",
  entities: [
    {
      ...hero!,
      fields: { ...hero!.fields, growths: { type: "list", label: "Growths", visibility: "owner" } },
    },
    ...others,
    { id: "growth", label: "Growth", base: "ability", fields: {} },
  ],
  layout: {
    hero: {
      sections: [
        { id: "body", label: "Body", show: ["grit", "derived.limit", "res.wounds", "res.strain"] },
        { id: "growths", label: "Growths", show: [{ widget: "held" }] },
      ],
    },
  },
  held: {
    growth: {
      label: "Growths",
      entry: "growth",
      field: "growths",
      entities: ["hero"],
      unseen: "Unseen",
      max: 5,
      cite: "Sample p.11",
    },
  },
  tables: {
    ...SAMPLE_HARM_BEFORE_HELD.tables,
    omen: {
      title: "Omen",
      die: "d6",
      visibility: "gm",
      cite: "Sample p.11",
      entries: [
        { id: "faint", label: "Faint", range: [1, 3], next: "lesser" },
        { id: "stark", label: "Stark", range: [4, 6], next: "greater" },
      ],
    },
    lesser: {
      title: "Lesser Growths",
      die: "d66",
      visibility: "gm",
      cite: "Sample p.12",
      entities: ["hero"],
      modifier: "count(growths) * 10",
      entries: [
        { id: "horn", label: "Horn", range: [11, 36], apply: [{ kind: "grant", held: "growth", entry: "horn" }] },
        { id: "scales", label: "Scales", range: [41, 56], apply: [{ kind: "grant", held: "growth", entry: "scales" }] },
        { id: "worse", label: "Worse", range: [61], next: "greater", note: "Roll again on the Greater table" },
      ],
    },
    greater: {
      title: "Greater Growths",
      die: "d6",
      visibility: "gm",
      cite: "Sample p.13",
      entities: ["hero"],
      entries: [
        { id: "wings", label: "Wings", range: [1, 3], apply: [{ kind: "grant", held: "growth", entry: "wings" }] },
        {
          id: "eye",
          label: "Third Eye",
          range: [4, 6],
          apply: [{ kind: "grant", held: "growth", entry: "third-eye" }],
        },
      ],
    },
  },
};

const arms = { type: "list", label: "Arms", visibility: "party" } as const;
const strikeNumbers = (
  might: string,
  guard: string,
  toughness: string,
  cite: string,
  visibility: "party" | "gm" = "party",
) =>
  [
    { id: "might", label: "Might", expr: might, visibility, cite },
    { id: "guard", label: "Guard", expr: guard, visibility, cite },
    { id: "toughness", label: "Toughness", expr: toughness, visibility, cite },
  ] as const;
const [hero13, brute13, swarm13, ...rest13] = SAMPLE_HARM_BEFORE_STRIKES.entities ?? [];

/**
 * sample-harm 0.1.4 (house decision #99): a blow struck with one of the attacker's arms, pack entries of the type `arm`
 * kept in its `arms` list (a hero's picked, a brute's or a swarm's copied from its pack entry). The dice are the
 * attacker's might, one more when aiming and half a swarm's members more; the number to beat is the target's guard,
 * one more while the attacker is hurt and the far shots called for an arm that is not close; the target's toughness,
 * less the arm's pierce, soaks the total. A swarm loses a member to a total over its soak; anyone else takes the total
 * over the soak as wounds, or 1 strain on a total equal to it (none for a brute, which takes no strain). Two notes, and
 * the Telling Blow table at hand. A hero lays the guide out for its phone's turn.
 */
export const SAMPLE_HARM_BEFORE_SHOWS: RulesetInput = {
  ...SAMPLE_HARM_BEFORE_STRIKES,
  version: "0.1.4",
  entities: [
    {
      ...hero13!,
      fields: { ...hero13!.fields, arms },
      derived: [...(hero13!.derived ?? []), ...strikeNumbers("grit", "grit / 2 + 1", "grit + 1", "Sample p.15")],
    },
    {
      ...brute13!,
      fields: { ...brute13!.fields, arms },
      derived: [...(brute13!.derived ?? []), ...strikeNumbers("hide", "2", "hide", "Sample p.16", "gm")],
    },
    {
      ...swarm13!,
      fields: { ...swarm13!.fields, arms },
      derived: [...(swarm13!.derived ?? []), ...strikeNumbers("1", "1", "1", "Sample p.16")],
    },
    ...rest13,
    {
      id: "arm",
      label: "Arm",
      base: "item",
      fields: {
        damage: { type: "int", label: "Damage", min: 0, max: 20 },
        edge: { type: "int", label: "Edge", min: 0, max: 5 },
        pierce: { type: "int", label: "Pierce", min: -5, max: 0 },
        close: { type: "bool", label: "Close" },
      },
    },
  ],
  layout: {
    hero: {
      sections: SAMPLE_HARM_BEFORE_STRIKES.layout?.hero?.sections ?? [],
      phoneTurn: [{ widget: "strike", variant: "blow" }],
    },
  },
  strikes: [
    {
      id: "blow",
      label: "Blow",
      cite: "Sample p.15",
      means: [{ from: "list", field: "arms", entry: "arm" }],
      values: {
        damage: { key: "damage", type: "int" },
        edge: { key: "edge", type: "int" },
        pierce: { key: "pierce", type: "int" },
        close: { key: "close", type: "bool" },
      },
      inputs: [
        { id: "aim", label: "Aim", type: "bool", cite: "Sample p.15" },
        { id: "far", label: "Far shots", type: "int", min: 0, max: 3, cite: "Sample p.15" },
      ],
      pool: {
        label: "Might",
        expr: "derived.might",
        cite: "Sample p.15",
        adds: [
          { label: "Aim", when: "ctx.aim", by: "1", cite: "Sample p.15" },
          { label: "Swarm", when: "ctx.attackerMob > 0", by: "(ctx.attackerMob + 1) / 2", cite: "Sample p.16" },
        ],
      },
      beat: {
        label: "Guard",
        expr: "ctx.target.derived.guard",
        cite: "Sample p.15",
        adds: [
          { label: "Hurt", when: "res.wounds > 0", by: "1", cite: "Sample p.15" },
          { label: "Far", when: "!ctx.means.close", by: "ctx.far", cite: "Sample p.15" },
        ],
      },
      soak: {
        label: "Toughness",
        expr: "ctx.target.derived.toughness",
        cite: "Sample p.16",
        adds: [{ label: "Pierce", by: "ctx.means.pierce", cite: "Sample p.16" }],
      },
      outcomes: [
        {
          id: "thinned",
          label: "Thinned",
          when: "ctx.targetMob > 0 && ctx.total > ctx.soak",
          wounds: "1",
          cite: "Sample p.16",
        },
        {
          id: "wounded",
          label: "Wounded",
          when: "ctx.targetMob == 0 && ctx.total > ctx.soak",
          wounds: "ctx.total - ctx.soak",
          cite: "Sample p.16",
        },
        {
          id: "strained",
          label: "Strained",
          when: "ctx.targetMob == 0 && ctx.total == ctx.soak",
          shock: "ctx.target.derived.strainCap > 0 ? 1 : 0",
          cite: "Sample p.16",
        },
      ],
      notes: [
        { text: "A six on the edge die: read the Telling Blow table", cite: "Sample p.16" },
        { text: "A brute shrugs off strain", when: "ctx.target.derived.strainCap == 0", cite: "Sample p.16" },
      ],
      then: { table: "blow", inputs: { past: "aim" } },
    },
  ],
};

const [hero14, ...rest14] = SAMPLE_HARM_BEFORE_SHOWS.entities ?? [];
const blow14 = SAMPLE_HARM_BEFORE_SHOWS.strikes![0]!;

/**
 * sample-harm 0.1.5 (house decision #99): a hero carries arms as items too (house decision #95), and a blow may be
 * struck with one it carries. The guide shows the damage to roll: the arm's damage, its edge dice more, and the
 * attacker's might more for a close arm; and the arm's traits, a text beside it, which one note reads.
 */
export const SAMPLE_HARM_BEFORE_GENERATORS: RulesetInput = {
  ...SAMPLE_HARM_BEFORE_SHOWS,
  version: "0.1.5",
  entities: [
    hero14!,
    ...rest14.map((e) =>
      e.id === "arm" ? { ...e, fields: { ...e.fields, traits: { type: "text", label: "Traits", maxLength: 80 } } } : e,
    ),
  ] as RulesetInput["entities"],
  items: {
    kinds: [
      { id: "carried", label: "Carried arms", entry: "arm", entities: ["hero"], card: "weapons", cite: "Sample p.17" },
    ],
  },
  strikes: [
    {
      ...blow14,
      means: [...(blow14.means ?? []), { from: "items", kind: "carried" }],
      values: { ...blow14.values, traits: { key: "traits", type: "text" } },
      shows: [
        {
          id: "damage",
          label: "Damage",
          expr: "ctx.means.damage",
          cite: "Sample p.16",
          adds: [
            { label: "Edge dice", by: "ctx.means.edge", cite: "Sample p.16" },
            { label: "Might", when: "ctx.means.close", by: "derived.might", cite: "Sample p.16" },
          ],
        },
      ],
      notes: [
        ...(blow14.notes ?? []),
        { text: "A brutal arm: the target is knocked down", when: 'ctx.means.traits == "Brutal"', cite: "Sample p.16" },
      ],
    },
  ],
};

/**
 * sample-harm 0.1.6 (house decision #98), the second shape of a generator: one roll on a table of signs, made into one
 * lore entry with no codex block at all. Invented like the rest.
 */
export const SAMPLE_HARM_BEFORE_OWNER: RulesetInput = {
  ...SAMPLE_HARM_BEFORE_GENERATORS,
  version: "0.1.6",
  tables: {
    ...SAMPLE_HARM_BEFORE_GENERATORS.tables,
    sign: {
      title: "Signs",
      die: "d6",
      visibility: "gm",
      cite: "Sample p.15",
      entries: [
        { id: "crow", label: "A crow at dusk", range: [1, 3] },
        { id: "moon", label: "A red moon", range: [4, 6] },
      ],
    },
  },
  generators: [
    {
      id: "portent",
      label: "A portent",
      cite: "Sample p.15",
      steps: [{ id: "sign", label: "The sign", kind: "roll", table: "sign" }],
      make: { kind: "lore", title: "sign" },
    },
  ],
};

/**
 * sample-harm 0.1.7 (house decision #113): a sweep a hero's own phone may send, once a round, at a swarm, reading only
 * what every seat reads (the hero's might, the swarm's guard), so a player's copy keeps it where the blow, which reads a
 * brute's GM-only numbers, is cut. The force put in is a choice: more dice, more members thinned, and as much strain
 * to pay, a further number the guide shows. Invented like the rest.
 */
export const SAMPLE_HARM_BEFORE_PANELS: RulesetInput = {
  ...SAMPLE_HARM_BEFORE_OWNER,
  version: "0.1.7",
  layout: {
    hero: {
      sections: SAMPLE_HARM_BEFORE_OWNER.layout?.hero?.sections ?? [],
      phoneTurn: [
        { widget: "strike", variant: "blow" },
        { widget: "strike", variant: "sweep" },
      ],
    },
  },
  strikes: [
    ...(SAMPLE_HARM_BEFORE_OWNER.strikes ?? []),
    {
      id: "sweep",
      label: "Sweep",
      cite: "Sample p.18",
      entities: ["hero"],
      targets: ["swarm"],
      byOwner: true,
      limit: { per: "round", max: 1 },
      inputs: [
        {
          id: "force",
          label: "Force",
          type: "choice",
          options: [
            { label: "Light", value: 0 },
            { label: "Hard", value: 1 },
            { label: "All in", value: 2 },
          ],
          cite: "Sample p.18",
        },
      ],
      pool: {
        label: "Might",
        expr: "derived.might",
        cite: "Sample p.18",
        adds: [{ label: "Force", by: "ctx.force", cite: "Sample p.18" }],
      },
      beat: { label: "Guard", expr: "ctx.target.derived.guard", cite: "Sample p.18" },
      shows: [{ id: "strain", label: "Strain to pay", expr: "ctx.force", cite: "Sample p.18" }],
      outcomes: [
        {
          id: "thinned",
          label: "Thinned",
          when: "ctx.total > ctx.beat",
          wounds: "1 + ctx.force",
          cite: "Sample p.18",
        },
      ],
    },
  ],
};

/**
 * sample-harm 0.1.8 (house decisions #114, #115): a hero's phone shows its wounds against its limit and its grit and
 * resolve on every tab; while a foe acts, what the hero meets the blow with; when its wounds rise, a sheet that asks to
 * endure; while it has fallen, what it may still do; and on its turn the stances it may take (pack entries of a type of
 * their own, ungrouped), hidden once fallen. Invented like the rest.
 */
export const SAMPLE_HARM_BEFORE_LISTS: RulesetInput = {
  ...SAMPLE_HARM_BEFORE_PANELS,
  version: "0.1.8",
  entities: [
    ...(SAMPLE_HARM_BEFORE_PANELS.entities ?? []),
    {
      id: "stance",
      label: "Stance",
      base: "ability",
      fields: { gist: { type: "text", label: "Gist", visibility: "party" } },
    },
  ],
  layout: {
    hero: {
      sections: SAMPLE_HARM_BEFORE_PANELS.layout?.hero?.sections ?? [],
      phoneStrip: [
        { widget: "track", bind: { value: "res.wounds", max: "derived.limit" } },
        { widget: "frames", bind: { values: ["grit", "res.resolve"] } },
      ],
      phoneTurn: [
        { widget: "panel", variant: "incoming" },
        { widget: "panel", variant: "hit" },
        { widget: "panel", variant: "fallen" },
        { widget: "panel", variant: "stances" },
        ...(SAMPLE_HARM_BEFORE_PANELS.layout?.hero?.phoneTurn ?? []),
      ],
    },
  },
  panels: [
    {
      id: "incoming",
      label: "Incoming",
      cite: "Sample p.19",
      entities: ["hero"],
      when: "ctx.fight.foeActing",
      lines: [
        { text: "Say how you meet the blow before the dice land", cite: "Sample p.19" },
        { text: "Resolve left: you may try again", when: "res.resolve > 0", cite: "Sample p.8" },
      ],
      figures: [
        { label: "Grit", expr: "grit", cite: "Sample p.19" },
        { label: "Wounds before you fall", expr: "max(0, derived.limit - res.wounds)", cite: "Sample p.19" },
      ],
    },
    {
      id: "hit",
      label: "You're hit",
      cite: "Sample p.9",
      entities: ["hero"],
      opensOn: { rises: "wounds" },
      lines: [{ text: "Roll your grit; each mark turns a wound into strain", cite: "Sample p.9" }],
      spends: ["endure"],
    },
    {
      id: "fallen",
      label: "Fallen",
      cite: "Sample p.20",
      entities: ["hero"],
      holds: "fallen",
      lines: [
        { text: "Crawl, call out, or hold on", cite: "Sample p.20" },
        { text: "Rise when a friend's healing brings you under your limit", cite: "Sample p.20" },
      ],
      figures: [{ label: "Scars", expr: "scars", cite: "Sample p.20" }],
    },
    {
      id: "stances",
      label: "This turn",
      cite: "Sample p.21",
      entities: ["hero"],
      when: "ctx.fight.acting",
      unless: "fallen",
      lines: [{ text: "One stance a turn", cite: "Sample p.21" }],
      options: { entry: "stance" },
    },
  ],
};

/** Stances for SAMPLE_HARM 0.1.8: the entries its `stances` panel lists (house decision #114). */
export const SAMPLE_HARM_STANCES = [
  { key: "guarded", name: "Guarded", body: { gist: "Strain first, wounds after" } },
  { key: "reckless", name: "Reckless", body: { gist: "One more die, one less guard" } },
].map(({ key, name, body }) => ({
  key,
  type: "stance",
  name,
  tags: [],
  cite: "Sample p.21",
  visibility: "party",
  body,
}));

/**
 * sample-harm 0.1.9 (house decision #159): an arm's traits are a list the guide shows as chips, read from the arm's
 * text split at its commas; the brutal note asks whether the list holds "Brutal".
 */
export const SAMPLE_HARM_BEFORE_LOOKUPS: RulesetInput = {
  ...SAMPLE_HARM_BEFORE_LISTS,
  version: "0.1.9",
  strikes: (SAMPLE_HARM_BEFORE_LISTS.strikes ?? []).map((s) =>
    s.values?.traits === undefined
      ? s
      : {
          ...s,
          values: { ...s.values, traits: { key: "traits", type: "list" as const } },
          notes: (s.notes ?? []).map((n) =>
            n.when === 'ctx.means.traits == "Brutal"' ? { ...n, when: 'contains(ctx.means.traits, "Brutal")' } : n,
          ),
        },
  ),
};

/**
 * sample-harm 0.1.10 (house decisions #163 to #166): a jolt the GM looks up with a die typed beside it (1d3 more
 * wounds), its strain left out on a brute that never takes any, its last line asking whether the target has resolve at
 * all; and a growth that brings the growths its `with` list names.
 */
export const SAMPLE_HARM_0_1_10: RulesetInput = {
  ...SAMPLE_HARM_BEFORE_LOOKUPS,
  version: "0.1.10",
  entities: (SAMPLE_HARM_BEFORE_LOOKUPS.entities ?? []).map((e) =>
    e.id === "growth" ? { ...e, fields: { ...e.fields, with: { type: "list", label: "Brings", maxItems: 4 } } } : e,
  ) as RulesetInput["entities"],
  held: {
    growth: { ...SAMPLE_HARM_BEFORE_LOOKUPS.held!.growth!, includes: "with" },
  },
  tables: {
    ...SAMPLE_HARM_BEFORE_LOOKUPS.tables,
    jolt: {
      title: "Jolt",
      die: "d6",
      visibility: "gm",
      cite: "Sample p.10",
      typedOnly: true,
      entities: ["hero", "brute"],
      inputs: [{ id: "more", label: "More wounds", type: "int", dice: "1d3", cite: "Sample p.10" }],
      entries: [
        { id: "shaken", label: "Shaken", range: [1, 4], apply: [{ kind: "harm", wounds: "ctx.more", shock: "1" }] },
        {
          id: "unnerved",
          label: "Unnerved",
          range: [5, 6],
          apply: [{ kind: "resource", resource: "resolve", by: "-1", when: "has(res.resolve)" }],
          cite: "Sample p.10",
        },
      ],
    },
  },
};

/**
 * sample-harm 0.1.11 (house decision #174): a brute is destroyed outright by one big hit only once it is already
 * wounded; an unhurt one takes the hit as wounds.
 */
export const SAMPLE_HARM_0_1_11: RulesetInput = {
  ...SAMPLE_HARM_0_1_10,
  version: "0.1.11",
  health: {
    ...SAMPLE_HARM_0_1_10.health,
    harm: {
      ...SAMPLE_HARM_0_1_10.health!.harm!,
      profiles: SAMPLE_HARM_0_1_10.health!.harm!.profiles.map((p) =>
        p.entities?.includes("brute") && p.destroyed !== undefined
          ? { ...p, destroyed: { ...p.destroyed, when: "res.wounds >= 1" } }
          : p,
      ),
    },
  },
};

/**
 * 0.1.12 (house decision #180): Incoming reads the acting swarm's size, which every seat reads, and a stance a hero may
 * take only with the maul carried sinks without it. 0.1.11 hashes as it did. Invented.
 */
export const SAMPLE_HARM_0_1_12: RulesetInput = {
  ...SAMPLE_HARM_0_1_11,
  version: "0.1.12",
  panels: SAMPLE_HARM_0_1_11.panels?.map((p) =>
    p.id === "incoming"
      ? {
          ...p,
          foe: "swarm",
          lines: [
            ...(p.lines ?? []),
            { text: "A swarm this big strikes twice", when: "ctx.foe.size > 10", cite: "Sample p.19" },
          ],
        }
      : p.id === "stances"
        ? {
            ...p,
            options: {
              ...p.options!,
              usable: 'entry.gist != "Strain first, wounds after" || contains(ctx.carried.carried, "maul")',
            },
          }
        : p,
  ),
};

/**
 * 0.1.13 (house decision #190): the fight's log warns, in the ruleset's own words, when a hit fells a hero or brute or
 * destroys one outright, and when a blow thins a swarm. 0.1.12 hashes as it did. Invented.
 */
export const SAMPLE_HARM_0_1_13: RulesetInput = {
  ...SAMPLE_HARM_0_1_12,
  version: "0.1.13",
  health: {
    ...SAMPLE_HARM_0_1_12.health,
    states: [
      ...(SAMPLE_HARM_0_1_12.health?.states ?? []).map((s) =>
        s.id === "fallen" ? { ...s, warn: "Falls: each further wound leaves a scar" } : s,
      ),
      {
        id: "gone",
        label: "Gone",
        when: "has(gone) && gone",
        entities: ["hero", "brute"],
        warn: "Destroyed outright",
      },
    ],
  },
  strikes: SAMPLE_HARM_0_1_12.strikes?.map((k) => ({
    ...k,
    outcomes: k.outcomes.map((o) => (o.id === "thinned" ? { ...o, warn: "One of the swarm drops" } : o)),
  })),
};

/**
 * 0.1.14 (house decision #191): a growth may ask for more rolls on its table and bring arms the hero then carries.
 * 0.1.13 hashes as it did. Invented.
 */
export const SAMPLE_HARM: RulesetInput = {
  ...SAMPLE_HARM_0_1_13,
  version: "0.1.14",
  entities: SAMPLE_HARM_0_1_13.entities.map((e) =>
    e.id === "growth"
      ? {
          ...e,
          fields: {
            ...e.fields,
            more: { type: "int", label: "Roll again", min: 0, max: 3 },
            arms: { type: "list", label: "Arms it brings", maxItems: 4 },
          },
        }
      : e,
  ) as RulesetInput["entities"],
  held: {
    growth: { ...SAMPLE_HARM_0_1_13.held!.growth!, extraRolls: "more", gear: { field: "arms", kind: "carried" } },
  },
};

/**
 * Arms for SAMPLE_HARM (house decision #99): what a blow reads of the means it is struck with, and since 0.1.5 its
 * traits.
 */
export const SAMPLE_HARM_ARMS = [
  { key: "maul", name: "Maul", body: { damage: 4, edge: 1, pierce: 0, close: true, traits: "Brutal" } },
  { key: "sling", name: "Sling", body: { damage: 3, edge: 0, pierce: -1, close: false, traits: "Far, Light" } },
  { key: "claw", name: "Claw", body: { damage: 3, edge: 1, pierce: -1, close: true } },
].map(({ key, name, body }) => ({ key, type: "arm", name, tags: [], cite: "Sample p.17", visibility: "gm", body }));

/** Growths for SAMPLE_HARM 0.1.3: each adds to a hero's wound limit, which every seat reads (house decision #88). */
export const SAMPLE_HARM_GROWTHS = [
  { key: "horn", name: "Horn", value: "1" },
  { key: "scales", name: "Scales", value: "2" },
  { key: "wings", name: "Wings", value: "1" },
  { key: "third-eye", name: "Third Eye", value: "1" },
].map(({ key, name, value }) => ({
  key,
  type: "growth",
  name,
  tags: [],
  cite: "Sample p.14",
  visibility: "gm",
  body: {},
  effects: [{ path: "derived.limit", mode: "add", value, phase: "derived" }],
}));
