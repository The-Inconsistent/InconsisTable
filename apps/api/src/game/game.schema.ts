import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { GameOutcome } from "@inconsistable/rules-engine";
import { actor } from "../actor/actor.schema.ts";
import { owned, session } from "../campaign/campaign.schema.ts";
import { encounter } from "../encounter/encounter.schema.ts";

// One line of an ended game (house decisions #38-#39). Columns, not a document: the campaign's standings count and
// filter them across sessions. `name` is the actor's name at the end, so history survives a deleted creature or a seat
// that left.
export const sessionResult = pgTable(
  "session_result",
  {
    ...owned(),
    sessionId: uuid().references(() => session.id, { onDelete: "set null" }),
    encounterId: uuid()
      .notNull()
      .references(() => encounter.id, { onDelete: "cascade" }),
    actorId: uuid().references(() => actor.id, { onDelete: "set null" }),
    name: text().notNull(),
    score: integer().notNull(),
    tiebreaks: integer()
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    place: integer(), // null for a cooperative game
    outcome: text().$type<GameOutcome>(), // win or lose, a cooperative game only
    endedEarly: boolean().notNull(),
  },
  (t) => [index().on(t.campaignId, t.createdAt)],
);
