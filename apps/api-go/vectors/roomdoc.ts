// Writes what packages/core-schema's RoomDocument answers, for internal/coreschema's twin to match, and the documents and
// fixtures the Go import tests apply (house decision #74). Generated on every `bun run test:go`, never committed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { RoomDocument, ROOM_LIMITS } from "../../../packages/core-schema/src/room-document.ts";
import {
  bareDocument,
  d20Document,
  IDS,
  LEDGER_BUILD,
  ledgerDocument,
  ROOM_D20,
  SAMPLE_LEDGER_PACK,
  SAMPLE_LEDGER_RULESET,
  SAMPLE_PACK,
  SAMPLE_WORLD,
  TINY_JPEG,
} from "./room-documents.ts";

const OUT = join(import.meta.dirname, "../internal/coreschema/testdata/roomdoc.json");

const uuid = (n: number) => `00000000-0000-4000-9000-${n.toString().padStart(12, "0")}`;
const times = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
const keyed = <T>(n: number, f: (i: number) => T) => Object.fromEntries(times(n, (i) => [`k${i}`, f(i)]));
const base = { format: "inconsistable-room", version: 1, room: { name: "x" } };
const entry = (i: number) => ({ id: uuid(i), kind: "lore", title: `e${i}` });
const actor = (i: number) => ({ id: uuid(i), kind: "npc", name: `a${i}` });
const image = (i: number) => ({ id: uuid(i), mime: "image/jpeg", base64: TINY_JPEG });

// [label, input]: every one of the documents, then each way one is refused.
const cases: [string, unknown][] = [
  ["d20", d20Document()],
  ["bare", bareDocument()],
  ["ledger", ledgerDocument()],
  ["smallest", base],
  ["format", { ...base, format: "auspex" }],
  ["version", { ...base, version: 2 }],
  ["no room", { format: "inconsistable-room", version: 1 }],
  ["unknown key", { ...base, extra: 1 }],
  ["unknown room key", { ...base, room: { name: "x", owner: "me" } }],
  ["unknown entry key", { ...base, codex: [{ ...entry(1), secret: true }] }],
  ["unknown actor key", { ...base, actors: [{ ...actor(1), hp: 3 }] }],
  ["duplicate actor", { ...base, actors: [actor(1), actor(1)] }],
  ["duplicate entry", { ...base, codex: [entry(1), entry(1)] }],
  ["duplicate picture", { ...base, images: [image(1), image(1)] }],
  ["not a uuid", { ...base, codex: [{ ...entry(1), id: "town" }] }],
  ["two active scenes", { ...base, codex: times(2, (i) => ({ ...entry(i), kind: "scene", status: "active" })) }],
  ["clock overfilled", { ...base, clocks: [{ name: "c", segments: 4, filled: 5 }] }],
  ["clock default overfilled", { ...base, clocks: [{ name: "c", filled: 5 }] }],
  [
    "built with fields it does not write",
    { ...base, actors: [{ ...actor(1), build: LEDGER_BUILD, fields: { xp: 5 } }] },
  ],
  ["built with a type", { ...base, actors: [{ ...actor(1), build: LEDGER_BUILD, entityType: "hero" }] }],
  ["build too large", { ...base, actors: [{ ...actor(1), build: "x".repeat(64 * 1024 + 1) }] }],
  ["picture type", { ...base, images: [{ ...image(1), mime: "image/gif" }] }],
  ["picture too large", { ...base, images: [{ ...image(1), base64: "A".repeat(ROOM_LIMITS.imageBase64 + 1) }] }],
  [
    "bad prep",
    { ...base, codex: [{ ...entry(1), kind: "scene", prep: { exits: [{ id: "e", label: "x", sceneId: "hill" }] } }] },
  ],
  ["unknown prep kind", { ...base, codex: [{ ...entry(1), kind: "scene", prep: { hazards: [] } }] }],
  ["bad datetime", { ...base, room: { name: "x", nextSessionAt: "tomorrow" } }],
  ["bad field value", { ...base, campaignFields: { tier: [1] } }],
  ["too many actors", { ...base, actors: times(ROOM_LIMITS.actors + 1, actor) }],
  ["too many entries", { ...base, codex: times(ROOM_LIMITS.codex + 1, entry) }],
  ["too many sessions", { ...base, sessions: times(ROOM_LIMITS.sessions + 1, () => ({})) }],
  ["too many clocks", { ...base, clocks: times(ROOM_LIMITS.clocks + 1, (i) => ({ name: `c${i}` })) }],
  ["too many pictures", { ...base, images: times(ROOM_LIMITS.images + 1, image) }],
  [
    "too many packs",
    { ...base, expects: { packs: times(ROOM_LIMITS.packs + 1, (i) => ({ slug: `p${i}`, version: "1" })) } },
  ],
  ["too many campaign fields", { ...base, campaignFields: keyed(ROOM_LIMITS.campaignFields + 1, () => 1) }],
  ["too many pools", { ...base, pools: keyed(ROOM_LIMITS.pools + 1, () => 1) }],
  [
    "too many actor fields",
    { ...base, actors: [{ ...actor(1), fields: keyed(ROOM_LIMITS.actorFields + 1, () => 1) }] },
  ],
  [
    "too many resources",
    { ...base, actors: [{ ...actor(1), resources: keyed(ROOM_LIMITS.actorResources + 1, () => 1) }] },
  ],
  ["too many conditions", { ...base, actors: [{ ...actor(1), conditions: times(51, (i) => `c${i}`) }] }],
  ["too many entry fields", { ...base, codex: [{ ...entry(1), fields: keyed(ROOM_LIMITS.entryFields + 1, () => 1) }] }],
  ["too many readers", { ...base, codex: [{ ...entry(1), audience: times(ROOM_LIMITS.audience + 1, uuid) }] }],
  ["too many links", { ...base, codex: [{ ...entry(1), links: times(ROOM_LIMITS.links + 1, uuid) }] }],
  ["too many planned tests", { ...base, codex: [{ ...entry(1), plannedTests: times(11, (i) => `t${i}`) }] }],
  ["amount out of range", { ...base, pools: { luck: 1_000_001 } }],
  ["junk", "a room"],
  ["null", null],
];

const shapes = cases.map(([label, input]) => {
  const r = RoomDocument.safeParse(input);
  return { label, input, ok: r.success, ...(r.success ? { output: r.data } : { pretty: z.prettifyError(r.error) }) };
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({
    shapes,
    documents: { d20: d20Document(), bare: bareDocument(), ledger: ledgerDocument() },
    fixtures: {
      d20Ruleset: ROOM_D20,
      d20Pack: SAMPLE_PACK,
      world: SAMPLE_WORLD,
      ledgerRuleset: SAMPLE_LEDGER_RULESET,
      ledgerPack: SAMPLE_LEDGER_PACK,
    },
    ids: IDS,
  }),
);
console.log(`room document vectors: ${shapes.length} shapes`);
