import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import type { ActorKind, ActorLinkKind, ActorStatus, ConditionExpiry } from "@inconsistable/core-schema";
import { owned } from "../campaign/campaign.schema.ts";
import { pk } from "../core/sql.ts";

// Everything with stats at a table is an actor (docs/design.md §5.4). The manifest says which fields, resources and
// conditions exist; their values are typed rows keyed by actor, never a JSON document, so a counter changes by one
// atomic UPDATE and a new ruleset needs no schema migration.
export const actor = pgTable(
  "actor",
  {
    ...owned(),
    kind: text().$type<ActorKind>().notNull(),
    entityType: text().notNull().default(""), // the ruleset's entity type ("creature"); empty until a ruleset is pinned
    subtype: text().notNull().default(""), // "familiar", "hireling"… as the ruleset names them
    name: text().notNull(),
    status: text().$type<ActorStatus>().notNull().default("active"),
    temporary: boolean().notNull().default(false), // creatures and summons cleared at encounter end unless kept
    ownerUserId: text(), // who may export it to their library; editing goes by seat (canInCampaign)
    rulesetVersionId: uuid(),
    memberCount: integer(), // groups only
  },
  (t) => [index().on(t.campaignId, t.kind)],
);

export const actorLink = pgTable(
  "actor_link",
  {
    actorId: uuid()
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
    relatedActorId: uuid()
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
    kind: text().$type<ActorLinkKind>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.relatedActorId, t.kind] })],
);

// A declared field's value. Exactly one value column is set; `ordinal` orders the rows of a list field.
export const actorField = pgTable(
  "actor_field",
  {
    actorId: uuid()
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
    fieldId: text().notNull(),
    ordinal: integer().notNull().default(0),
    intValue: integer(),
    textValue: text(),
    refKey: text(),
  },
  (t) => [
    primaryKey({ columns: [t.actorId, t.fieldId, t.ordinal] }),
    check("actor_field_one_value", sql`num_nonnulls(${t.intValue}, ${t.textValue}, ${t.refKey}) = 1`),
  ],
);

export const actorResource = pgTable(
  "actor_resource",
  {
    actorId: uuid()
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
    resourceId: text().notNull(),
    value: integer().notNull(),
    maxOverride: integer(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.resourceId] })],
);

export const actorCondition = pgTable("actor_condition", {
  id: pk(),
  actorId: uuid()
    .notNull()
    .references(() => actor.id, { onDelete: "cascade" }),
  conditionId: text().notNull(),
  stacks: integer().notNull().default(1),
  source: text().notNull().default(""),
  expiresOn: text().$type<ConditionExpiry>().notNull().default("manual"),
  expiresAfter: integer(), // turns or rounds left, for the expiries that count
});

// A creation choice: which option the builder picked at a step.
export const actorChoice = pgTable(
  "actor_choice",
  {
    actorId: uuid()
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
    stepId: text().notNull(),
    ordinal: integer().notNull().default(0),
    optionKey: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.stepId, t.ordinal] })],
);
