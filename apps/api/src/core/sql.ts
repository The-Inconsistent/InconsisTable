import { sql, type AnyColumn } from "drizzle-orm";
import { text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Tx } from "./db.ts";

// Every id is a Postgres 18 uuidv7: time-ordered, so B-tree inserts stay at the right edge of the index.
export const pk = () =>
  uuid()
    .primaryKey()
    .default(sql`uuidv7()`);

// A counter that never drops below 0. Capped resources clamp both ends in the rules engine's resource SQL instead.
export const bump = (col: AnyColumn, d: number | undefined) =>
  d === undefined ? undefined : sql`greatest(0, ${col} + ${d})`;

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
export const body = () => text().notNull().default("");

// Serialises one key's writers for the rest of the transaction (one user's imports: the quota and the "latest version"
// they read stay true until commit). Released at commit or rollback.
export const lockKey = (tx: Tx, key: string) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
