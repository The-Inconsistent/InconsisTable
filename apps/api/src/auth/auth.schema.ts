import { boolean, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { CogmScope, MemberRole, PlatformRole, TokenRole, InviteMode } from "@inconsistable/core-schema";
import { actor } from "../actor/actor.schema.ts";
import { campaign } from "../campaign/campaign.schema.ts";
import { createdAt, pk } from "../core/sql.ts";

// Token seats: a guest's character (one QR per character) or the table's TV (docs/design.md §3.6). Only a SHA-256 of
// each token is stored; the token itself lives in the guest cookie or the QR code.
export const accessToken = pgTable("access_token", {
  tokenHash: text().primaryKey(),
  campaignId: uuid()
    .notNull()
    .references(() => campaign.id, { onDelete: "cascade" }),
  role: text().$type<TokenRole>().notNull(),
  actorId: uuid().references(() => actor.id, { onDelete: "cascade" }), // null for a screen
  revokedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
});

// Clerk users we've seen. The name is refreshed from the session token; `role` is a display copy of the Clerk role
// (Clerk stays the only source, and the app never writes it there); `lockedAt` is the moderators' lock, checked on
// every connect and REST call.
export const appUser = pgTable("app_user", {
  id: text().primaryKey(),
  name: text().notNull(),
  role: text().$type<PlatformRole>(),
  lockedAt: timestamp({ withTimezone: true }),
  lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A signed-in user's seat at one table. The owner is campaign.owner_user_id and also holds a `gm` membership.
export const membership = pgTable(
  "membership",
  {
    id: pk(),
    campaignId: uuid()
      .notNull()
      .references(() => campaign.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    role: text().$type<MemberRole>().notNull(),
    scopes: text().array().$type<CogmScope[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.campaignId, t.userId)],
);

// The characters a seat holds: a main character, a companion, a funnel of four.
export const membershipCharacter = pgTable(
  "membership_character",
  {
    membershipId: uuid()
      .notNull()
      .references(() => membership.id, { onDelete: "cascade" }),
    actorId: uuid()
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.actorId] })],
);

// Invite links. Like tokens, only the code's hash is stored, so a lost QR is replaced, not recovered.
export const invite = pgTable("invite", {
  id: pk(),
  codeHash: text().notNull().unique(),
  campaignId: uuid()
    .notNull()
    .references(() => campaign.id, { onDelete: "cascade" }),
  mode: text().$type<InviteMode>().notNull(),
  role: text().$type<MemberRole>().notNull().default("player"),
  actorId: uuid().references(() => actor.id, { onDelete: "cascade" }),
  allowGuests: boolean().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  maxUses: integer(), // null = until it expires
  uses: integer().notNull().default(0),
  revokedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
});

// The owner offered the room to someone; it moves only when they accept. One open offer per room.
export const ownershipTransfer = pgTable("ownership_transfer", {
  campaignId: uuid()
    .primaryKey()
    .references(() => campaign.id, { onDelete: "cascade" }),
  toUserId: text()
    .notNull()
    .references(() => appUser.id, { onDelete: "cascade" }),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: createdAt(),
});
