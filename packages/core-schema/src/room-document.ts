import { z } from "zod";

import { LineRef, NextSessionPlace, SessionTitle } from "./actions.ts";
import { ScenePrep, SpawnOptionIds } from "./prep.ts";
import {
  ActorKind,
  ActorName,
  AudienceMode,
  CampaignName,
  ClockName,
  ClockSegments,
  ClockVisibility,
  CodexFieldValue,
  CodexKind,
  CodexText,
  CodexTitle,
  CodexVisibility,
  EntrySource,
  EntryStatus,
  FieldValue,
  HandoutHeader,
  HandoutLayout,
  ItemSource,
  LedgerBuildText,
  MAX_CLOCKS,
  MAX_PLANNED_TESTS,
  SafetyList,
} from "./state.ts";

// A room as one document (ADR 0012 decision 4, house decision #74): what a room holds, in the platform's own terms. It
// names the ruleset, packs and World it expects by slug, version and hash, never their content. Every id inside it is
// the document's own (a UUID); the import gives every row a new one. Go twin: internal/coreschema/roomdoc.go.

export const ROOM_FORMAT = "inconsistable-room";
export const ROOM_VERSION = 1;

// Each cap is the one the table's actions hold a room to, or, where no action caps a list, the house decision's.
export const ROOM_LIMITS = {
  bytes: 100 * 1024 * 1024, // the request body: the picture total of a room (100 MB) and room to spare
  packs: 50, // a user's pack quota
  campaignFields: 100,
  pools: 100,
  actors: 50, // the room's character cap (an invite's new characters)
  actorFields: 200,
  actorResources: 100,
  actorConditions: 50,
  actorItems: 200, // house decision #95: the largest kind cap
  codex: 1000,
  links: 100,
  audience: 50, // codex.reveal's
  entryFields: 20, // codex.save's
  sessions: 500,
  clocks: MAX_CLOCKS,
  images: 200, // the picture store's count per room
  imageBase64: 1_333_336, // one picture of 1 MB, the store's cap, in base64
} as const;

const LocalId = z.uuid();
const Key = z.string().min(1).max(64);
// An absolute value the import reaches through the resource's own adjust, which takes deltas of this size.
const Amount = z.int().min(-1_000_000).max(1_000_000);

const capped = <S extends z.ZodType<Record<string, unknown>>>(schema: S, max: number, what: string) =>
  schema.refine((o) => Object.keys(o).length <= max, `At most ${max} ${what}`);

// A version the importing user must already hold: slug and version, and the hash it must have when one is given.
export const RoomExpect = z.strictObject({
  slug: z.string().min(1).max(100),
  version: z.string().min(1).max(100),
  hash: z.string().min(1).max(128).optional(),
});
export type RoomExpect = z.infer<typeof RoomExpect>;

// An item a character holds (house decision #95): a pack entry by key or a hand-written name, `fittedTo` another item of
// the same character, `entryId` the codex item a GIVE handed over.
export const RoomItem = z.strictObject({
  id: LocalId,
  kind: Key,
  entry: z.string().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  note: z.string().max(200).optional(),
  quantity: z.int().min(1).max(999).optional(),
  fittedTo: LocalId.optional(),
  // A line of the character's saved build it is fitted to, `<card>/<name>` (house decision #102).
  fittedLine: LineRef.optional(),
  source: ItemSource.optional(),
  entryId: LocalId.optional(),
});
export type RoomItem = z.infer<typeof RoomItem>;

export const RoomActor = z
  .strictObject({
    id: LocalId,
    kind: ActorKind,
    name: ActorName,
    entityType: z.string().min(1).max(64).optional(),
    fields: capped(z.record(z.string().min(1).max(120), FieldValue), ROOM_LIMITS.actorFields, "fields").optional(),
    resources: capped(z.record(Key, Amount), ROOM_LIMITS.actorResources, "resources").optional(),
    build: LedgerBuildText.optional(), // what build.save takes; never a draft. `fields` beside it: what it does not write
    conditions: z.array(Key).max(ROOM_LIMITS.actorConditions).optional(),
    items: z.array(RoomItem).max(ROOM_LIMITS.actorItems).optional(),
    // The spawn options it was spawned with (house decision #92), fixed then: the import does not read their `when`.
    spawnOptions: SpawnOptionIds.optional(),
  })
  .refine(
    (a) => a.build === undefined || a.entityType === undefined,
    "A built character takes its type from its build",
  );
export type RoomActor = z.infer<typeof RoomActor>;

export const RoomEntry = z.strictObject({
  id: LocalId,
  kind: CodexKind,
  title: CodexTitle,
  body: CodexText.optional(), // mentions name entries of this document
  gmNotes: CodexText.optional(),
  visibility: CodexVisibility.optional(), // gm when absent
  audienceMode: AudienceMode.optional(),
  audience: z.array(LocalId).max(ROOM_LIMITS.audience).optional(), // actors of this document
  parentId: LocalId.optional(),
  position: z.int().min(0).max(10_000).optional(), // among its siblings; absent ones follow, in document order
  links: z.array(LocalId).max(ROOM_LIMITS.links).optional(), // a scene's
  plannedTests: z.array(z.string().min(1).max(100)).max(MAX_PLANNED_TESTS).optional(),
  status: EntryStatus.optional(),
  fields: capped(z.record(Key, CodexFieldValue), ROOM_LIMITS.entryFields, "fields").optional(),
  layout: HandoutLayout.optional(),
  header: HandoutHeader.optional(),
  prep: ScenePrep.optional(), // its scenes, entries and actors are this document's
  imageId: LocalId.optional(),
  imageRevealed: z.boolean().optional(),
  // When it was last revealed; kept for a revealed entry, ignored on a sealed one (house decision #86).
  // The pack entry it was made from (house decision #97): checked against the room's packs as a ref is; its page is read again.
  source: EntrySource.optional(),
  revealedAt: z.iso.datetime({ offset: true }).optional(),
});
export type RoomEntry = z.infer<typeof RoomEntry>;

export const RoomSession = z.strictObject({
  title: SessionTitle.optional(),
  recap: z.string().max(10_000).optional(),
  notes: z.string().max(10_000).optional(),
  abandoned: z.boolean().optional(), // ended without its award (session.abandon, house decision #85)
});

export const RoomClock = z
  .strictObject({
    name: ClockName,
    segments: ClockSegments.optional(), // 4 when absent, as clock.create has it
    visibility: ClockVisibility.optional(),
    filled: z.int().min(0).max(12).optional(),
    entryId: LocalId.optional(),
  })
  .refine((c) => (c.filled ?? 0) <= (c.segments ?? 4), "A clock is filled past its segments");

export const RoomImage = z.strictObject({
  id: LocalId,
  mime: z.enum(["image/webp", "image/jpeg"]),
  base64: z.string().min(1).max(ROOM_LIMITS.imageBase64),
});

const repeated = (ids: string[]) => new Set(ids).size !== ids.length;

export const RoomDocument = z
  .strictObject({
    format: z.literal(ROOM_FORMAT),
    version: z.literal(ROOM_VERSION),
    exportedAt: z.iso.datetime({ offset: true }).optional(),
    room: z.strictObject({
      name: CampaignName,
      nextSessionAt: z.iso.datetime({ offset: true }).optional(),
      nextSessionPlace: NextSessionPlace.optional(),
      safety: z.strictObject({ lines: SafetyList, veils: SafetyList, xCard: z.boolean() }).optional(),
    }),
    expects: z
      .strictObject({
        ruleset: RoomExpect.optional(),
        packs: z.array(RoomExpect).max(ROOM_LIMITS.packs).optional(),
        world: RoomExpect.optional(),
      })
      .optional(),
    campaignFields: capped(
      z.record(Key, z.union([z.int().min(-2147483648).max(2147483647), z.string().max(100), z.boolean()])),
      ROOM_LIMITS.campaignFields,
      "campaign fields",
    ).optional(),
    pools: capped(z.record(Key, Amount), ROOM_LIMITS.pools, "pools").optional(),
    actors: z.array(RoomActor).max(ROOM_LIMITS.actors).optional(),
    codex: z.array(RoomEntry).max(ROOM_LIMITS.codex).optional(),
    sessions: z.array(RoomSession).max(ROOM_LIMITS.sessions).optional(),
    clocks: z.array(RoomClock).max(ROOM_LIMITS.clocks).optional(),
    images: z.array(RoomImage).max(ROOM_LIMITS.images).optional(),
  })
  .superRefine((d, ctx) => {
    const say = (message: string) => ctx.addIssue({ code: "custom", message });
    if (repeated((d.actors ?? []).map((a) => a.id))) say("Two actors share an id");
    if (repeated((d.codex ?? []).map((e) => e.id))) say("Two entries share an id");
    if (repeated((d.images ?? []).map((i) => i.id))) say("Two pictures share an id");
    if ((d.codex ?? []).filter((e) => e.kind === "scene" && e.status === "active").length > 1) {
      say("More than one scene is active");
    }
  });
export type RoomDocument = z.infer<typeof RoomDocument>;
export type RoomDocumentInput = z.input<typeof RoomDocument>;

// What POST /api/campaigns/import answers, for the dry run and the real one alike.
export const RoomImportCounts = z.object({
  actors: z.record(z.string(), z.number()),
  entries: z.record(z.string(), z.number()),
  pictures: z.number(),
  sessions: z.number(),
  clocks: z.number(),
});
export const RoomImportExpect = z.object({
  what: z.enum(["ruleset", "pack", "world"]),
  slug: z.string(),
  version: z.string(),
  imported: z.boolean(),
});
export type RoomImportExpect = z.infer<typeof RoomImportExpect>;
export const RoomImportReply = z.object({
  campaignId: z.string().nullable(), // null on a dry run: its room was rolled back
  name: z.string(),
  expects: z.array(RoomImportExpect),
  counts: RoomImportCounts,
});
export type RoomImportReply = z.infer<typeof RoomImportReply>;
// What it answers when it refuses (422): the refusal, the document path of what caused it, and, once the document has
// been read, its name and what it expects.
export const RoomImportRefusal = z.object({
  code: z.string().optional(),
  message: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  path: z.string(),
  name: z.string().optional(),
  expects: z.array(RoomImportExpect).optional(),
});
export type RoomImportRefusal = z.infer<typeof RoomImportRefusal>;
