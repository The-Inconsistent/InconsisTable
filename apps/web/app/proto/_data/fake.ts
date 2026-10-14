// PROTOTYPE fake table: invented names and numbers, no book text. Real components render this.
import type { Actor, Combatant, LiveState, TestCall } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_D20 } from "../../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";

// The fixture's layout only shows three scores; widen it so the sheet has vitals, defence and notes to dress.
export const RULESET = Ruleset.parse({
  ...SAMPLE_D20,
  layout: {
    sheet: {
      sections: [
        { id: "vitals", label: "Vitals", show: ["res.hp", "res.tempHp", "res.focus", "res.luck"] },
        { id: "defence", label: "Defence", show: ["derived.defense", "derived.maxHp", "derived.initBonus", "guard"] },
        { id: "abilities", label: "Abilities", show: ["attr.str", "attr.dex", "attr.con", "level", "size"] },
      ],
    },
  },
});

export const send: Send = async () => ({ ok: true });
export const requestPage: RequestPage = async () => ({ ok: false, error: "No book in the prototype" });
export const BOOKS: readonly string[] = [];

type PcInput = { id: string; name: string; str: number; dex: number; con: number; hp: number; temp: number };
function pc({ id, name, str, dex, con, hp, temp }: PcInput): Actor {
  const mod = (n: number) => Math.floor((n - 10) / 2);
  const baseHp = 6 + mod(con);
  const guard = 10;
  return {
    id,
    kind: "pc",
    name,
    status: "active",
    ownerUserId: "u-" + id,
    entity: "character",
    fields: { name, level: 3, "attr.str": str, "attr.dex": dex, "attr.con": con, guard, size: "medium" },
    resources: { hp, tempHp: temp, focus: 1, luck: 2 },
    derived: { baseHp, maxHp: baseHp + 8, initBonus: mod(dex), defense: guard + mod(dex) },
    conditions: id === "pc-bran" ? ["dazed"] : id === "pc-lyra" ? ["braced", "staggered"] : [],
    conditionTimers: id === "pc-lyra" ? [{ id: "staggered", expiresOn: "ownTurnEnd", expiresAfter: 1 }] : [],
  };
}

const creature = (id: string, name: string, hp: number): Actor => ({
  id,
  kind: "creature",
  name,
  status: "active",
  ownerUserId: null,
  entity: "creature",
  fields: { name, level: 2, "attr.str": 14, "attr.dex": 10, "attr.con": 12, guard: 12 },
  resources: { hp, tempHp: 0 },
  derived: { maxHp: 16 },
  conditions: [],
  conditionTimers: [],
});

export const LYRA = pc({ id: "pc-lyra", name: "Lyra Venn", str: 11, dex: 16, con: 14, hp: 17, temp: 3 });
const BRAN = pc({ id: "pc-bran", name: "Bran Ashgrove", str: 17, dex: 10, con: 15, hp: 6, temp: 0 });
const MIREL = pc({ id: "pc-mirel", name: "Mirel of the Hollow", str: 9, dex: 14, con: 12, hp: 14, temp: 0 });
const WARDEN_1 = creature("cr-1", "Hollow Warden 1", 16);
const WARDEN_2 = creature("cr-2", "Hollow Warden 2", 5);
const ACTORS = [LYRA, BRAN, MIREL, WARDEN_1, WARDEN_2];

const defs = RULESET.conditions.map((c) => ({ id: c.id, label: c.label, duration: c.duration }));
const fighter = (a: Actor, ord: number, initiative: number, side: "party" | "foe"): Combatant => ({
  id: "cb-" + a.id,
  actorId: a.id,
  name: a.name,
  side,
  ord,
  initiative,
  visibility: "full",
  keep: false,
  hp: { value: a.resources.hp ?? 0, max: a.derived.maxHp ?? null },
  bar: (a.resources.hp ?? 0) / (a.derived.maxHp ?? 1),
  conditions: a.conditions.map((id) => ({ id, left: id === "staggered" ? 1 : null, expiresOn: "" })),
});

const COMBATANTS: Combatant[] = [
  fighter(LYRA, 0, 19, "party"),
  fighter(WARDEN_1, 1, 15, "foe"),
  fighter(BRAN, 2, 12, "party"),
  fighter(MIREL, 3, 11, "party"),
  fighter(WARDEN_2, 4, 7, "foe"),
];

const call = (over: Partial<TestCall> & Pick<TestCall, "id" | "status" | "targets">): TestCall => ({
  testId: "check",
  dice: "1d20",
  advantage: true,
  createdAt: "2026-10-14T19:00:00.000Z",
  inputs: { ability: "dex", dc: 14 },
  secretInputs: [],
  showTarget: true,
  showModifier: true,
  showOutcome: true,
  revealed: false,
  called: over.targets.length,
  reported: over.targets.filter((t) => t.report).length,
  ...over,
});

const BASE: LiveState = {
  campaign: {
    id: "proto",
    name: "The Hollow Lantern",
    ownerUserId: "gm",
    archived: false,
    nextSessionAt: null,
    nextSessionPlace: "",
  },
  stateVersion: 1,
  session: { id: "s1", number: 4, title: "", startedAt: "", endedAt: null, recap: "", notes: "" },
  actors: ACTORS,
  myDraft: null,
  tests: [],
  testDefs: [
    {
      id: "check",
      dice: "1d20",
      advantage: true,
      inputs: [
        { id: "ability", type: "text" },
        { id: "dc", type: "int" },
      ],
    },
  ],
  encounter: {
    id: "enc",
    round: 2,
    currentId: "cb-pc-lyra",
    paused: false,
    health: { resource: "hp", temp: "tempHp", deathSaves: true },
    conditionDefs: defs,
    combatants: COMBATANTS,
  },
  access: { members: [], invites: [], guests: [], screens: 0, transfer: null },
};

// The phone: this seat holds Lyra, and her Test is waiting for the number off the die.
export const PHONE_PENDING: LiveState = {
  ...BASE,
  tests: [
    call({
      id: "t-open",
      status: "open",
      targets: [{ actorId: LYRA.id, modifier: 3, target: 14, report: null }],
    }),
  ],
};

// The same call after Lyra read her die: the result stays on the card.
export const PHONE_REPORTED: LiveState = {
  ...BASE,
  tests: [
    call({
      id: "t-open",
      status: "open",
      targets: [{ actorId: LYRA.id, modifier: 3, target: 14, report: { natural: 15, total: 18, outcome: "success" } }],
    }),
  ],
};

// The GM's tablet: one Test still open (one waiting, two reported) and an older one closed with its results shown.
export const GM_STATE: LiveState = {
  ...BASE,
  tests: [
    call({
      id: "t-open",
      status: "open",
      targets: [
        { actorId: LYRA.id, modifier: 3, target: 14, report: null },
        { actorId: BRAN.id, modifier: 0, target: 14, report: { natural: 9, total: 9, outcome: "failure" } },
        { actorId: MIREL.id, modifier: 2, target: 14, report: { natural: 20, total: 22, outcome: "critical" } },
      ],
    }),
    call({
      id: "t-old",
      status: "closed",
      revealed: true,
      inputs: { ability: "str", dc: 12 },
      targets: [
        { actorId: LYRA.id, modifier: 0, target: 12, report: { natural: 12, total: 12, outcome: "success" } },
        { actorId: BRAN.id, modifier: 3, target: 12, report: { natural: 5, total: 8, outcome: "failure" } },
      ],
    }),
  ],
};

export const NAMES: ReadonlyMap<string, string> = new Map(ACTORS.map((a) => [a.id, a.name]));
