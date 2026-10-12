import { integer, jsonb, pgTable, primaryKey, text, unique, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { ResourceScope } from "@inconsistable/rules-engine";
import { campaign } from "../campaign/campaign.schema.ts";
import { createdAt, pk } from "../core/sql.ts";

// Imported rulesets (docs/design.md §4). InconsisTable ships none: every one is imported by its owner, private by
// default. A version is immutable; fixing one publishes a new version.
export const ruleset = pgTable(
  "ruleset",
  {
    id: pk(),
    ownerUserId: text().notNull(),
    slug: text().notNull(),
    title: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.ownerUserId, t.slug)],
);

export const rulesetVersion = pgTable(
  "ruleset_version",
  {
    id: pk(),
    rulesetId: uuid()
      .notNull()
      .references(() => ruleset.id, { onDelete: "cascade" }),
    version: text().notNull(),
    hash: text().notNull(), // the compiled cache key
    // A parent can't be deleted while a version extends it. NO ACTION (checked at statement end), so deleting a whole
    // ruleset still cascades through its versions that extend each other.
    extendsVersionId: uuid().references((): AnyPgColumn => rulesetVersion.id, { onDelete: "no action" }),
    manifest: jsonb().notNull(), // a whole document, read once and compiled (CLAUDE.md, "Data rules")
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.rulesetId, t.version)],
);

// Party, GM and campaign pools (Glory, Ruin, Inspiration…): the resources a manifest scopes above one actor.
export const resourcePool = pgTable(
  "resource_pool",
  {
    campaignId: uuid()
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    scope: text().$type<ResourceScope>().notNull(),
    resourceId: text().notNull(),
    value: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.scope, t.resourceId] })],
);
