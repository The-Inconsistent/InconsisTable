import { and, asc, eq, exists, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { PackEntry, type EntryLookup, type EntryVisibility } from "@inconsistable/rules-engine";
import { membership } from "../auth/auth.schema.ts";
import type { Db } from "../core/db.ts";
import { campaignPack, pack, packEntry, packVersion } from "./pack.schema.ts";

/**
 * The pack versions of a room that may be served to anyone: attached, not taken down by an admin, and a `private` pack
 * only while its owner is a GM of the room (CLAUDE.md, principle 4). The one place this is decided.
 */
export function servedPacks(conn: Db, campaignId: string): SQL {
  return and(
    eq(campaignPack.campaignId, campaignId),
    isNull(pack.disabledAt),
    or(
      ne(pack.license, "private"),
      exists(
        conn
          .select({ one: sql`1` })
          .from(membership)
          .where(
            and(
              eq(membership.campaignId, campaignId),
              eq(membership.userId, pack.ownerUserId),
              eq(membership.role, "gm"),
            ),
          ),
      ),
    ),
  )!;
}

/** What a seat may read of an entry: a `gm` entry is for GM-side seats only. */
export const seesEntry = ({ visibility, gm }: { visibility: EntryVisibility; gm: boolean }) =>
  gm || visibility === "public" || visibility === "party";

export interface StoredEntry {
  packVersionId: string;
  key: string;
  type: string;
  name: string;
  level: number | null;
  tags: string[];
  cite: string | null;
  visibility: EntryVisibility;
  body: unknown;
}

/**
 * The lookup `runCreation` picks from, over entries already loaded: only what this seat may see (a player must never
 * pick a `gm` entry). Pure, so the filter is unit tested. The first entry per (type, key) wins, in load order.
 */
export function entryLookup({ entries, gm }: { entries: readonly StoredEntry[]; gm: boolean }): EntryLookup {
  return ({ type, key }) => {
    const e = entries.find((x) => x.type === type && x.key === key && seesEntry({ visibility: x.visibility, gm }));
    if (!e) return undefined;
    const parsed = PackEntry.safeParse({
      key: e.key,
      type: e.type,
      name: e.name,
      ...(e.level === null ? {} : { level: e.level }),
      tags: e.tags,
      ...(e.cite === null ? {} : { cite: e.cite }),
      visibility: e.visibility,
      body: e.body,
    });
    return parsed.success ? parsed.data : undefined;
  };
}

/** Entries of the room's served packs (of these types, of one pack version, when given), in a stable order. */
export async function loadServedEntries(
  conn: Db,
  { campaignId, types, packVersionId }: { campaignId: string; types?: readonly string[]; packVersionId?: string },
): Promise<StoredEntry[]> {
  if (types?.length === 0) return [];
  const rows = await conn
    .select({
      packVersionId: packEntry.packVersionId,
      key: packEntry.key,
      type: packEntry.type,
      name: packEntry.name,
      level: packEntry.level,
      tags: packEntry.tags,
      cite: packEntry.cite,
      visibility: packEntry.visibility,
      body: packEntry.body,
    })
    .from(packEntry)
    .innerJoin(campaignPack, eq(campaignPack.packVersionId, packEntry.packVersionId))
    .innerJoin(packVersion, eq(packVersion.id, packEntry.packVersionId))
    .innerJoin(pack, eq(pack.id, packVersion.packId))
    .where(
      and(
        servedPacks(conn, campaignId),
        types === undefined ? undefined : inArray(packEntry.type, [...types]),
        packVersionId === undefined ? undefined : eq(packEntry.packVersionId, packVersionId),
      ),
    )
    .orderBy(asc(pack.slug), asc(packEntry.key));
  return rows;
}
