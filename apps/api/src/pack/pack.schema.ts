import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { EntryVisibility, PackLicense } from "@inconsistable/rules-engine";
import { campaign } from "../campaign/campaign.schema.ts";
import { createdAt, pk } from "../core/sql.ts";
import { rulesetVersion, ruleset } from "../ruleset/ruleset.schema.ts";

// Imported content packs (docs/design.md §4.6). InconsisTable ships none: every pack is imported by its owner, who is the
// only one who can read or attach it (grants for sharing are P4). The uploaded file is not kept; the normalized rows are.
export const pack = pgTable(
  "pack",
  {
    id: pk(),
    ownerUserId: text().notNull(),
    slug: text().notNull(), // the pack's own `id`
    rulesetId: uuid()
      .notNull()
      .references(() => ruleset.id, { onDelete: "restrict" }), // the ruleset it is written for; fixed at first import
    // Fixed at first import too: a `private` pack can't be re-imported as `srd` to get out of its rules.
    license: text().$type<PackLicense>().notNull(),
    attribution: text(),
    hiddenAt: timestamp({ withTimezone: true }), // "deleted" by its owner; really removed once no room references it
    disabledAt: timestamp({ withTimezone: true }), // taken down by an admin: served to nobody, attachable nowhere
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.ownerUserId, t.slug)],
);

// One import. Immutable: a fix is a new version, and a room pins the version it attached.
export const packVersion = pgTable(
  "pack_version",
  {
    id: pk(),
    packId: uuid()
      .notNull()
      .references(() => pack.id, { onDelete: "cascade" }),
    version: text().notNull(), // the pack's declared semver
    hash: text().notNull(), // of the content; an import with the same hash as the latest version writes nothing
    rulesetVersionId: uuid()
      .notNull()
      .references(() => rulesetVersion.id, { onDelete: "restrict" }), // the version it was checked against
    rulesetRange: text().notNull(),
    sources: jsonb().notNull(), // a small whole document, kept so the export is the pack that was imported
    entryCount: integer().notNull(),
    bytes: integer().notNull(), // size of the normalized pack, for the owner's quota
    createdAt: createdAt(),
  },
  (t) => [index().on(t.packId, t.createdAt)],
);

// One row per entry: typed columns to filter and list by, `body` (field values) to show. Names are searched with
// pg_trgm (the extension is enabled in runMigrations); there is no GIN on `body`.
export const packEntry = pgTable(
  "pack_entry",
  {
    id: pk(),
    packVersionId: uuid()
      .notNull()
      .references(() => packVersion.id, { onDelete: "cascade" }),
    key: text().notNull(),
    type: text().notNull(),
    name: text().notNull(),
    level: integer(),
    tags: text().array().notNull().default([]),
    visibility: text().$type<EntryVisibility>().notNull(),
    cite: text(),
    contentHash: text().notNull(),
    body: jsonb().notNull(),
  },
  (t) => [
    unique().on(t.packVersionId, t.key),
    index().on(t.packVersionId, t.type),
    index("pack_entry_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

// The pack versions a room has attached. RESTRICT: a version a room uses can't be deleted from under it.
export const campaignPack = pgTable(
  "campaign_pack",
  {
    campaignId: uuid()
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    packVersionId: uuid()
      .notNull()
      .references(() => packVersion.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.packVersionId] })],
);
