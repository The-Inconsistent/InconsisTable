import { z } from "zod";
import { bigint, index, integer, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { appUser } from "../auth/auth.schema.ts";
import { body, createdAt, pk } from "../core/sql.ts";
import { rulesetVersion } from "../ruleset/ruleset.schema.ts";

export const campaign = pgTable("campaign", {
  id: pk(),
  name: text().notNull(),
  // The room owner (docs/design.md §3.6): the only source, so there can never be two. A deleted owner account leaves
  // the room owner-less until an admin hands it on or archives it.
  ownerUserId: text().references(() => appUser.id, { onDelete: "set null" }),
  // Null until a ruleset is pinned (P1). A pinned version can't be deleted from under a room.
  rulesetVersionId: uuid().references(() => rulesetVersion.id, { onDelete: "restrict" }),
  // When and where the table meets next; session.start clears the date, the place stays for next time.
  nextSessionAt: timestamp({ withTimezone: true }),
  nextSessionPlace: text().notNull().default(""),
  // Increments in every action's transaction, so clients can drop a snapshot that arrives out of order.
  stateVersion: bigint({ mode: "number" }).notNull().default(0),
  archivedAt: timestamp({ withTimezone: true }), // read-only until unarchived
  createdAt: createdAt(),
});

// Columns of every row a campaign owns. A function declaration, hoisted: the schema files import each other, and
// actor.schema calls this while this file may still be loading.
export function owned() {
  return {
    id: pk(),
    campaignId: uuid()
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  };
}

export const session = pgTable("session", {
  ...owned(),
  number: integer().notNull(),
  title: text().notNull().default(""),
  startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp({ withTimezone: true }),
  recap: body(),
  notes: body(), // the GM's own, never sent to a phone
});

// What a session_event row is: a `delta` is one write, an `undo` takes one action back, the `test.*` rows tell a called
// Test (never undoable: undo reads only `delta` rows).
export const SessionEventType = z.enum(["delta", "undo", "test.call", "test.report", "test.close"]);
export type SessionEventType = z.infer<typeof SessionEventType>;

// The session log: deltas with their before and after values (Postgres 18 RETURNING OLD/NEW), rolls, reveals. It is
// the basis of server-side undo and of the recap draft. Append-only apart from `undone_by`, which marks a delta row
// once an `undo` event has reversed it. A `delta` row is one write (payload: target, kind, before, after); the rows of
// one action share `action_id`, and an undo is itself an event (type `undo`) that never becomes undoable.
// ponytail: unbounded per campaign; partition by month and compact into the recap at session end when it grows
export const sessionEvent = pgTable(
  "session_event",
  {
    ...owned(),
    sessionId: uuid().references(() => session.id, { onDelete: "set null" }),
    type: text().$type<SessionEventType>().notNull(),
    actionId: uuid(), // groups the deltas of one action
    seatUserId: text(), // who acted; null for a guest, a screen, the admin key and the system
    undoneBy: uuid().references((): AnyPgColumn => sessionEvent.id, { onDelete: "set null" }),
    payload: jsonb().notNull(),
  },
  (t) => [
    index().on(t.campaignId, t.createdAt),
    index().on(t.campaignId, t.undoneBy, t.createdAt),
    index().on(t.actionId),
  ],
);
