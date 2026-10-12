import { and, count, desc, eq, inArray, isNotNull, isNull, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  MAX_PACK_ENTRIES,
  Pack,
  RulesetId,
  diffHashes,
  validatePack,
  validateRuleset,
  type PackDiff,
  type Problem,
} from "@inconsistable/rules-engine";
import { db, type Db } from "../core/db.ts";
import { ImportRefused } from "../core/errors.ts";
import { lockKey } from "../core/sql.ts";
import { ruleset, rulesetVersion } from "../ruleset/ruleset.schema.ts";
import { MAX_PACK_BYTES_PER_USER, MAX_PACKS_PER_USER, normalizePack } from "./pack.normalize.ts";
import { campaignPack, pack, packEntry, packVersion } from "./pack.schema.ts";

const ENTRY_INSERT_CHUNK = 1000; // 1000 rows x 10 columns stays well under Postgres' 65535 parameters

/** Which ruleset a pack names, read before the pack is checked (the check needs that ruleset). */
const RulesetRef = z.object({ ruleset: z.object({ id: RulesetId }) });

export interface PackImported {
  ok: true;
  packId: string;
  versionId: string;
  version: string;
  diff: PackDiff;
  warnings: Problem[];
  /** true: the content equals the latest version, so nothing was written. */
  unchanged: boolean;
}

/**
 * Imports a pack file as the owner's: checks it against the newest version of the owner's ruleset it names, then in one
 * transaction writes a new immutable version with one row per entry and reports what changed against the previous one.
 * The uploaded file itself is not kept. Refusals (problems by path, quota, a taken-down pack) throw `ImportRefused`.
 */
export async function importPack({ userId, input }: { userId: string; input: unknown }): Promise<PackImported> {
  const ref = RulesetRef.safeParse(input);
  if (!ref.success)
    throw new ImportRefused([{ path: "ruleset.id", message: "name the ruleset the pack is written for" }]);
  const [rs] = await db
    .select({ rulesetId: ruleset.id, versionId: rulesetVersion.id, manifest: rulesetVersion.manifest })
    .from(ruleset)
    .innerJoin(rulesetVersion, eq(rulesetVersion.rulesetId, ruleset.id))
    .where(and(eq(ruleset.ownerUserId, userId), eq(ruleset.slug, ref.data.ruleset.id)))
    .orderBy(desc(rulesetVersion.createdAt), desc(rulesetVersion.id))
    .limit(1);
  if (!rs)
    throw new ImportRefused([
      { path: "ruleset.id", message: `import the ruleset "${ref.data.ruleset.id}" first (My rulesets)` },
    ]);
  const manifest = validateRuleset(rs.manifest);
  if (!manifest.ok) throw new Error(`stored ruleset ${rs.versionId} no longer validates`); // ours, not the owner's

  const checked = validatePack({ input, ruleset: manifest.ruleset });
  if (!checked.ok) throw new ImportRefused(checked.problems, checked.warnings);
  const p = checked.pack;
  const next = normalizePack({ pack: p, rulesetVersionId: rs.versionId });

  return db.transaction(async (tx) => {
    await lockKey(tx, `import:${userId}`);

    let [row] = await tx
      .select()
      .from(pack)
      .where(and(eq(pack.ownerUserId, userId), eq(pack.slug, p.id)));
    if (row) {
      const why: Problem[] = [];
      if (row.disabledAt) why.push({ path: "id", message: "this pack was taken down by an admin" });
      if (row.license !== p.license)
        why.push({ path: "license", message: `fixed at first import (${row.license}); import under another id` });
      if (row.rulesetId !== rs.rulesetId)
        why.push({ path: "ruleset.id", message: "fixed at first import; import under another id" });
      if (why.length) throw new ImportRefused(why, checked.warnings);
    } else {
      const [mine] = await tx.select({ n: count() }).from(pack).where(eq(pack.ownerUserId, userId));
      if ((mine?.n ?? 0) >= MAX_PACKS_PER_USER)
        throw new ImportRefused(
          [{ path: "(quota)", message: `at most ${MAX_PACKS_PER_USER} packs` }],
          checked.warnings,
        );
      [row] = await tx
        .insert(pack)
        .values({
          ownerUserId: userId,
          slug: p.id,
          rulesetId: rs.rulesetId,
          license: p.license,
          attribution: p.attribution ?? null,
        })
        .returning();
    }
    const packRow = row!; // found or just inserted
    // Importing again brings back a pack its owner had hidden; its attribution follows the latest file.
    await tx
      .update(pack)
      .set({ hiddenAt: null, attribution: p.attribution ?? null })
      .where(eq(pack.id, packRow.id));

    const [prev] = await tx
      .select({ id: packVersion.id, hash: packVersion.hash })
      .from(packVersion)
      .where(eq(packVersion.packId, packRow.id))
      .orderBy(desc(packVersion.createdAt), desc(packVersion.id))
      .limit(1);
    const before = prev
      ? await tx
          .select({ key: packEntry.key, hash: packEntry.contentHash })
          .from(packEntry)
          .where(eq(packEntry.packVersionId, prev.id))
      : [];
    const diff = diffHashes({
      prev: new Map(before.map((b) => [b.key, b.hash])),
      next: new Map(next.entries.map((e) => [e.entry.key, e.contentHash])),
    });
    const base = { ok: true as const, packId: packRow.id, version: p.version, diff, warnings: checked.warnings };
    if (prev && prev.hash === next.hash) return { ...base, versionId: prev.id, unchanged: true };

    const [created] = await tx
      .insert(packVersion)
      .values({
        packId: packRow.id,
        version: p.version,
        hash: next.hash,
        rulesetVersionId: rs.versionId,
        rulesetRange: p.ruleset.range,
        sources: p.sources,
        entryCount: p.entries.length,
        bytes: next.bytes,
      })
      .returning({ id: packVersion.id });
    const versionId = created!.id; // the row was just inserted
    for (let i = 0; i < next.entries.length; i += ENTRY_INSERT_CHUNK)
      await tx.insert(packEntry).values(
        next.entries.slice(i, i + ENTRY_INSERT_CHUNK).map(({ entry, contentHash: h }) => ({
          packVersionId: versionId,
          key: entry.key,
          type: entry.type,
          name: entry.name,
          level: entry.level ?? null,
          tags: entry.tags,
          visibility: entry.visibility,
          cite: entry.cite ?? null,
          contentHash: h,
          body: entry.body,
        })),
      );

    // Older versions no room has attached are no longer needed: the new one is the diff base from now on.
    await tx
      .delete(packVersion)
      .where(
        and(
          eq(packVersion.packId, packRow.id),
          ne(packVersion.id, versionId),
          notInArray(packVersion.id, tx.select({ id: campaignPack.packVersionId }).from(campaignPack)),
        ),
      );
    const used = await storageOf(tx, userId);
    if (used.bytes > MAX_PACK_BYTES_PER_USER)
      throw new ImportRefused(
        [{ path: "(quota)", message: `over ${MAX_PACK_BYTES_PER_USER / (1024 * 1024)} MB of stored packs` }],
        checked.warnings,
      );
    return { ...base, versionId, unchanged: false };
  });
}

/** What the owner has stored: packs (hidden ones included) and the bytes of every version. */
async function storageOf(conn: Db, userId: string) {
  const [r] = await conn
    .select({
      packs: sql<number>`count(distinct ${pack.id})::int`,
      bytes: sql<number>`coalesce(sum(${packVersion.bytes}), 0)::int`,
    })
    .from(pack)
    .leftJoin(packVersion, eq(packVersion.packId, pack.id))
    .where(eq(pack.ownerUserId, userId));
  return { packs: r?.packs ?? 0, bytes: r?.bytes ?? 0 };
}

/** The owner's visible packs with their versions (newest first), and how much of the quota is used. */
export async function listMyPacks(userId: string) {
  const packs = await db
    .select({
      id: pack.id,
      slug: pack.slug,
      license: pack.license,
      attribution: pack.attribution,
      disabled: isNotNull(pack.disabledAt),
      rulesetSlug: ruleset.slug,
      createdAt: pack.createdAt,
    })
    .from(pack)
    .innerJoin(ruleset, eq(ruleset.id, pack.rulesetId))
    .where(and(eq(pack.ownerUserId, userId), isNull(pack.hiddenAt)))
    .orderBy(desc(pack.createdAt), desc(pack.id));
  const versions = packs.length
    ? await db
        .select({
          id: packVersion.id,
          packId: packVersion.packId,
          version: packVersion.version,
          entryCount: packVersion.entryCount,
          bytes: packVersion.bytes,
          createdAt: packVersion.createdAt,
        })
        .from(packVersion)
        .where(
          inArray(
            packVersion.packId,
            packs.map((x) => x.id),
          ),
        )
        .orderBy(desc(packVersion.createdAt), desc(packVersion.id))
    : [];
  const usage = await storageOf(db, userId);
  return {
    packs: packs.map(({ createdAt, ...x }) => ({
      ...x,
      createdAt: createdAt.toISOString(),
      versions: versions
        .filter((v) => v.packId === x.id)
        .map(({ packId: _p, createdAt: at, ...v }) => ({ ...v, createdAt: at.toISOString() })),
    })),
    usage: { ...usage, maxPacks: MAX_PACKS_PER_USER, maxBytes: MAX_PACK_BYTES_PER_USER, maxEntries: MAX_PACK_ENTRIES },
  };
}

/**
 * The owner's own pack as JSON, in the form `importPack` takes (the latest version). Null when it isn't theirs (the
 * same answer as a pack that doesn't exist); "disabled" after a takedown, which stops serving it to anyone.
 */
export async function exportPack({ userId, packId }: { userId: string; packId: string }) {
  const [row] = await db
    .select({ pack, rulesetSlug: ruleset.slug })
    .from(pack)
    .innerJoin(ruleset, eq(ruleset.id, pack.rulesetId))
    .where(and(eq(pack.id, packId), eq(pack.ownerUserId, userId)));
  if (!row) return null;
  if (row.pack.disabledAt) return "disabled" as const;
  const [version] = await db
    .select()
    .from(packVersion)
    .where(eq(packVersion.packId, packId))
    .orderBy(desc(packVersion.createdAt), desc(packVersion.id))
    .limit(1);
  if (!version) return null;
  const entries = await db
    .select()
    .from(packEntry)
    .where(eq(packEntry.packVersionId, version.id))
    .orderBy(packEntry.type, packEntry.key);
  return Pack.parse({
    id: row.pack.slug,
    version: version.version,
    ruleset: { id: row.rulesetSlug, range: version.rulesetRange },
    license: row.pack.license,
    attribution: row.pack.attribution ?? undefined,
    sources: version.sources,
    entries: entries.map((e) => ({
      key: e.key,
      type: e.type,
      name: e.name,
      level: e.level ?? undefined,
      tags: e.tags,
      cite: e.cite ?? undefined,
      visibility: e.visibility,
      body: e.body,
    })),
  });
}

/**
 * "Delete" for the owner: the pack leaves their list at once, and is really removed when no room references any
 * version of it (a referenced one stays so the room's table doesn't change). Null when it isn't theirs.
 */
export async function hidePack({ userId, packId }: { userId: string; packId: string }) {
  return db.transaction(async (tx) => {
    const [hidden] = await tx
      .update(pack)
      .set({ hiddenAt: new Date() })
      .where(and(eq(pack.id, packId), eq(pack.ownerUserId, userId)))
      .returning({ id: pack.id });
    if (!hidden) return null;
    const [used] = await tx
      .select({ n: count() })
      .from(campaignPack)
      .innerJoin(packVersion, eq(packVersion.id, campaignPack.packVersionId))
      .where(eq(packVersion.packId, packId));
    if (used?.n) return { deleted: false };
    await tx.delete(pack).where(eq(pack.id, packId));
    return { deleted: true };
  });
}
