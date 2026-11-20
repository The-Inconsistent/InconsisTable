// Room documents of our own invention (house decision #74), for the vectors, the Go import tests and the smoke suite: one
// on the d20 fixture using every part of the document, one for a room with no ruleset, one with a ledger-built
// character. Every name and number is made up; the second game rule of ADR 0012 is why there are three.
import type { RoomDocumentInput } from "../../../packages/core-schema/src/room-document.ts";
import type { RulesetInput } from "../../../packages/rules-engine/src/manifest.ts";
import { SAMPLE_D20 } from "../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_PACK } from "../../../packages/rules-engine/src/fixtures/sample-pack.ts";
import { SAMPLE_WORLD } from "../../../packages/rules-engine/src/fixtures/sample-world.ts";
import { SAMPLE_LEDGER_PACK } from "../../../packages/rules-engine/src/fixtures/sample-ledger-pack.ts";
import { SAMPLE_LEDGER_RULESET } from "../../../packages/rules-engine/src/fixtures/sample-ledger-ruleset.ts";

// The d20 fixture with a place field, so the nested place can carry one (as the smoke suite's codex test does).
export const ROOM_D20: RulesetInput = (() => {
  const ruleset = structuredClone(SAMPLE_D20);
  ruleset.version = "0.1.3-room";
  ruleset.codex!.kinds.location = {
    fields: { district: { type: "text", label: "District", maxLength: 40, visibility: "party", cite: "Sample p.17" } },
  };
  return ruleset;
})();
export { SAMPLE_LEDGER_PACK, SAMPLE_LEDGER_RULESET, SAMPLE_PACK, SAMPLE_WORLD };

// A JPEG as the picture store sniffs one: its first bytes, nothing more.
export const TINY_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 7]).toString("base64");

// The document's own ids: any UUID will do, and these read as what they are.
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
export const IDS = {
  mara: id(1),
  harbourmaster: id(2),
  town: id(10),
  quay: id(11),
  npc: id(12),
  notice: id(13),
  quest: id(14),
  road: id(15),
  quayScene: id(16),
  hill: id(17),
  tides: id(18),
  guild: id(19),
  picture: id(30),
  wren: id(40),
} as const;

export const d20Document = (): RoomDocumentInput => ({
  format: "inconsistable-room",
  version: 1,
  exportedAt: "2026-11-20T12:00:00.000Z",
  room: {
    name: "Harbour Watch",
    nextSessionAt: "2026-12-01T18:00:00.000Z",
    nextSessionPlace: "The back room",
    safety: { lines: ["Drowning"], veils: ["Spiders"], xCard: true },
  },
  expects: {
    ruleset: { slug: "sample-d20", version: "0.1.3-room" },
    packs: [{ slug: "sample-bestiary", version: "0.1.0" }],
    world: { slug: "sample-tidewater", version: "0.1.0" },
  },
  pools: { luck: 2 },
  actors: [
    {
      id: IDS.mara,
      kind: "pc",
      name: "Mara",
      entityType: "character",
      fields: { name: "Mara", level: 2, "attr.str": 10, "attr.dex": 14, "attr.con": 12, guard: 11, size: "medium" },
      resources: { hp: 8, tempHp: 2 },
      conditions: ["marked"],
    },
    {
      id: IDS.harbourmaster,
      kind: "npc",
      name: "Harbourmaster Oyle",
      entityType: "creature",
      fields: { level: 1, "attr.con": 10, guard: 12 },
    },
  ],
  codex: [
    { id: IDS.town, kind: "location", title: "Harbour town", visibility: "party" },
    {
      id: IDS.quay,
      kind: "location",
      title: "Quay",
      body: "Wet stones below @[Harbour town](" + IDS.town + ").",
      parentId: IDS.town,
      position: 0,
      fields: { district: "Docks" },
      imageId: IDS.picture,
      imageRevealed: true,
      visibility: "party",
    },
    {
      id: IDS.npc,
      kind: "npc",
      title: "Harbourmaster Oyle",
      body: "Counts every crate twice.",
      gmNotes: "Owes the guild; see @[The Salt Guild](" + IDS.guild + ").",
      fields: { mood: "wary", disposition: 1 },
      visibility: "party",
    },
    {
      id: IDS.notice,
      kind: "handout",
      title: "Notice",
      body: "By order of the harbour, @[Quay](" + IDS.quay + ") is closed at dusk.",
      layout: "proclamation",
      header: "By order",
      visibility: "party",
      audienceMode: "listed",
      audience: [IDS.mara],
    },
    { id: IDS.quest, kind: "quest", title: "Find the lost ledger", status: "open", visibility: "party" },
    { id: IDS.road, kind: "adventure", title: "The Salt Road" },
    {
      id: IDS.quayScene,
      kind: "scene",
      title: "Trouble on the quay",
      parentId: IDS.road,
      position: 0,
      status: "active",
      links: [IDS.quay, IDS.npc],
      plannedTests: ["check"],
      prep: {
        roster: [{ id: "r1", pack: "sample-bestiary", key: "ember-wisp", count: 2, label: "Wisps" }],
        tests: [
          { id: "t1", testId: "check", inputs: { ability: "dex", dc: 12 }, takers: "listed", actorIds: [IDS.mara] },
        ],
        pools: [{ id: "p1", pool: "luck", amount: 1, text: "For the crate" }],
        exits: [{ id: "e1", label: "Up the hill", sceneId: IDS.hill }],
        reveals: [{ id: "v1", entryId: IDS.notice }],
      },
    },
    { id: IDS.hill, kind: "scene", title: "The hill road", parentId: IDS.road, position: 1, status: "planned" },
    {
      id: IDS.tides,
      kind: "lore",
      title: "Old tides",
      body: "Twice a day.",
      gmNotes: "Not on the night of the storm.",
    },
    { id: IDS.guild, kind: "faction", title: "The Salt Guild", fields: { standing: "rival" } },
  ],
  sessions: [
    { title: "Arrival", recap: "The crew came ashore at @[Harbour town](" + IDS.town + ").", notes: "Slow start." },
    { title: "The crates", recap: "A crate went missing.", notes: "" },
  ],
  clocks: [{ name: "The tide rises", segments: 6, filled: 2, visibility: "party", entryId: IDS.quay }],
  images: [{ id: IDS.picture, mime: "image/jpeg", base64: TINY_JPEG }],
});

// A room with no ruleset: the codex, sessions, clocks and pictures only.
export const bareDocument = (): RoomDocumentInput => ({
  format: "inconsistable-room",
  version: 1,
  room: { name: "Kitchen Table" },
  codex: [
    { id: IDS.town, kind: "location", title: "The village", imageId: IDS.picture, visibility: "party" },
    {
      id: IDS.quay,
      kind: "location",
      title: "The mill",
      parentId: IDS.town,
      body: "Near @[The village](" + IDS.town + ").",
    },
    { id: IDS.notice, kind: "handout", title: "A letter", layout: "form", header: "To whom it may concern" },
    { id: IDS.tides, kind: "lore", title: "The old road" },
  ],
  sessions: [{ title: "One", recap: "We met." }, { recap: "We left." }],
  clocks: [{ name: "Winter comes", filled: 1, entryId: IDS.town }],
  images: [{ id: IDS.picture, mime: "image/jpeg", base64: TINY_JPEG }],
});

// A ready build of the ledger fixture's catalogue, keys in an order of their own.
export const LEDGER_BUILD = JSON.stringify({
  skills: { Lore: 3, Brawl: 1 },
  tier: 1,
  archetypeId: "lamplighter",
  fills: { "[GUILD]": { id: "ironhand" } },
  background: {
    tableId: "warden-roots",
    roots: "Lowland",
    deed: "Held the Gate",
    dream: "A Quiet Hearth",
    bonus: "dream",
  },
  languages: { picks: ["trade-tongue"] },
  wealth: 1,
});

// A room of the ledger fixture: its Tier, and one character built by the ledger builder.
export const ledgerDocument = (): RoomDocumentInput => ({
  format: "inconsistable-room",
  version: 1,
  room: { name: "Lamplight" },
  expects: {
    ruleset: { slug: "sample-ledger", version: "0.1.0" },
    packs: [{ slug: "sample-ledger-catalogue", version: "0.1.0" }],
  },
  campaignFields: { tier: 1 },
  actors: [{ id: IDS.wren, kind: "pc", name: "Wren", build: LEDGER_BUILD }],
  codex: [{ id: IDS.npc, kind: "npc", title: "The lamplighter", visibility: "party" }],
});
