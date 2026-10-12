import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { SeatRole, TestCallStatus, TestInputs } from "@inconsistable/core-schema";
import type { AdvantageMode, TestOutcome } from "@inconsistable/rules-engine";
import { actor } from "../actor/actor.schema.ts";
import { owned, session } from "../campaign/campaign.schema.ts";

// A Test the GM called (docs/design.md §5.4, §6.3). The roll itself is physical: a report is what a seat typed from the
// dice, and `outcome` is what the server resolved from it, so a hidden target number never has to reach a phone.
export const testCall = pgTable(
  "test_call",
  {
    ...owned(),
    sessionId: uuid().references(() => session.id, { onDelete: "set null" }),
    testId: text().notNull(), // the pinned ruleset's `tests` key
    // What the GM filled in for the Test's `inputs` (`ctx.dc`, `ctx.ability`): one small document, read whole.
    inputs: jsonb().$type<TestInputs>().notNull(),
    hideTarget: boolean().notNull(),
    showOutcome: boolean().notNull(), // with a hidden target: the called players are told success or failure
    revealed: boolean().notNull().default(false), // closed with every result shown to the called characters
    status: text().$type<TestCallStatus>().notNull().default("open"),
    createdByUserId: text(), // null for a guest seat or the admin key
    closedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.campaignId, t.status, t.createdAt)],
);

// Who was called, with the two numbers computed for them when the call was made, so a condition applied meanwhile
// doesn't change what the phone was told. `target` is never sent to a seat while the call hides it.
export const testCallTarget = pgTable(
  "test_call_target",
  {
    callId: uuid()
      .notNull()
      .references(() => testCall.id, { onDelete: "cascade" }),
    actorId: uuid()
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
    modifier: integer().notNull(),
    target: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.callId, t.actorId] })],
);

// One report per called character: the physical roll as typed, and the outcome the server resolved. A player's first
// report stands; only the GM side replaces one (docs/house-decisions.md #20).
export const testReport = pgTable(
  "test_report",
  {
    callId: uuid().notNull(),
    actorId: uuid().notNull(),
    advantage: text().$type<AdvantageMode>().notNull(),
    faces: integer().array(), // the dice as read off the table; null when only a total was reported
    natural: integer(), // the kept dice before the modifier; null when only a total was reported without it
    total: integer().notNull(),
    outcome: text().$type<TestOutcome>().notNull(),
    reportedByUserId: text(),
    reportedByRole: text().$type<SeatRole>().notNull(),
    reportedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.callId, t.actorId] }),
    foreignKey({
      columns: [t.callId, t.actorId],
      foreignColumns: [testCallTarget.callId, testCallTarget.actorId],
    }).onDelete("cascade"),
  ],
);
