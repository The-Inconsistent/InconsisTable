import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import type { AudienceMode, CodexKind, CodexVisibility } from "@inconsistable/core-schema";
import { actor } from "../actor/actor.schema.ts";
import { owned } from "../campaign/campaign.schema.ts";
import { body } from "../core/sql.ts";

// The parent row of every codex entry (docs/design.md §5.4). Each kind's own columns arrive with its screens (P1, P2),
// in a table keyed by this id.
export const codexEntry = pgTable(
  "codex_entry",
  {
    ...owned(),
    kind: text().$type<CodexKind>().notNull(),
    title: text().notNull(),
    body: body(),
    gmNotes: body(),
    visibility: text().$type<CodexVisibility>().notNull().default("gm"),
    audienceMode: text().$type<AudienceMode>().notNull().default("all"),
  },
  (t) => [index().on(t.campaignId, t.kind)],
);

// Who a `listed` entry reaches. Deleting the last listed character hides the entry (actor.actions,
// hideOrphanedEntries), so a private handout never falls back to the whole table.
export const codexReveal = pgTable(
  "codex_reveal",
  {
    entryId: uuid()
      .notNull()
      .references(() => codexEntry.id, { onDelete: "cascade" }),
    actorId: uuid()
      .notNull()
      .references(() => actor.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.actorId] })],
);
