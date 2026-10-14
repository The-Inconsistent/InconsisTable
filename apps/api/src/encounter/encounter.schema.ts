import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { CombatSide, CombatVisibility } from "@inconsistable/core-schema";
import { actor } from "../actor/actor.schema.ts";
import { owned, session } from "../campaign/campaign.schema.ts";
import { pk } from "../core/sql.ts";

// The combat tracker (docs/p1-plan.md, F). No stat snapshot: a creature actor already holds the values copied when it
// was spawned. The initiative order is `combatant.ord`; the GM types every score (the app never rolls).
export const encounter = pgTable(
  "encounter",
  {
    ...owned(),
    sessionId: uuid().references(() => session.id, { onDelete: "set null" }),
    round: integer().notNull().default(1),
    active: boolean().notNull().default(true),
    currentCombatantId: uuid().references((): AnyPgColumn => combatant.id, { onDelete: "set null" }),
  },
  (t) => [
    // At most one running encounter per campaign; ended ones stay as history.
    uniqueIndex()
      .on(t.campaignId)
      .where(sql`${t.active}`),
  ],
);

export const combatant = pgTable(
  "combatant",
  {
    id: pk(),
    encounterId: uuid()
      .notNull()
      .references(() => encounter.id, { onDelete: "cascade" }),
    // A deleted actor leaves the fight with it.
    actorId: uuid()
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
    side: text().$type<CombatSide>().notNull(),
    ord: integer().notNull(),
    initiativeScore: integer(),
    visibility: text().$type<CombatVisibility>().notNull().default("bar"),
    keep: boolean().notNull().default(false), // a temporary creature kept at encounter end
  },
  (t) => [uniqueIndex().on(t.encounterId, t.actorId), index().on(t.encounterId, t.ord)],
);
