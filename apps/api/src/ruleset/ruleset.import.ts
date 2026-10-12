import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../core/db.ts";
import { ImportRefused } from "../core/errors.ts";
import { lockKey } from "../core/sql.ts";
import { checkRuleset } from "./ruleset.check.ts";
import { ruleset, rulesetVersion } from "./ruleset.schema.ts";

// ponytail: a flat cap per owner on stored versions, never pruned (a pinned version can't go); a quota in bytes and a
// way to delete unpinned versions once people import often
export const MAX_RULESET_VERSIONS = 100;

export interface RulesetImported {
  ok: true;
  rulesetId: string;
  versionId: string;
  slug: string;
  version: string;
  /** true: this exact version was already imported, nothing was written. */
  unchanged: boolean;
}

/**
 * Stores a manifest as an immutable version of the owner's ruleset. The same version number with the same content is a
 * no-op; with different content it is refused (fix it by raising the version, which is what makes it immutable).
 */
export function importRuleset({ userId, input }: { userId: string; input: unknown }): Promise<RulesetImported> {
  const checked = checkRuleset(input);
  if (!checked.ok) throw new ImportRefused(checked.problems);
  const { ruleset: manifest, hash } = checked;
  return db.transaction(async (tx) => {
    await lockKey(tx, `import:${userId}`);
    await tx
      .insert(ruleset)
      .values({ ownerUserId: userId, slug: manifest.id, title: manifest.sources[0]?.title ?? manifest.id })
      .onConflictDoNothing();
    const [row] = await tx
      .select({ id: ruleset.id })
      .from(ruleset)
      .where(and(eq(ruleset.ownerUserId, userId), eq(ruleset.slug, manifest.id)));
    const rulesetId = row!.id; // inserted above or already there
    const base = { ok: true as const, rulesetId, slug: manifest.id, version: manifest.version };

    const [same] = await tx
      .select({ id: rulesetVersion.id, hash: rulesetVersion.hash })
      .from(rulesetVersion)
      .where(and(eq(rulesetVersion.rulesetId, rulesetId), eq(rulesetVersion.version, manifest.version)));
    if (same) {
      if (same.hash === hash) return { ...base, versionId: same.id, unchanged: true };
      throw new ImportRefused([
        { path: "version", message: `${manifest.version} is already imported with other content: raise the version` },
      ]);
    }

    const [used] = await tx
      .select({ n: count() })
      .from(rulesetVersion)
      .innerJoin(ruleset, eq(ruleset.id, rulesetVersion.rulesetId))
      .where(eq(ruleset.ownerUserId, userId));
    if ((used?.n ?? 0) >= MAX_RULESET_VERSIONS)
      throw new ImportRefused([{ path: "(quota)", message: `at most ${MAX_RULESET_VERSIONS} ruleset versions` }]);

    // `extends` is recorded as a link to the owner's own version; the engine does not merge the two (the manifest
    // must stand alone), so this only keeps the parent from being deleted while a version extends it.
    let extendsVersionId: string | null = null;
    if (manifest.extends) {
      const [parent] = await tx
        .select({ id: rulesetVersion.id })
        .from(rulesetVersion)
        .innerJoin(ruleset, eq(ruleset.id, rulesetVersion.rulesetId))
        .where(
          and(
            eq(ruleset.ownerUserId, userId),
            eq(ruleset.slug, manifest.extends.id),
            eq(rulesetVersion.version, manifest.extends.version),
          ),
        );
      if (!parent)
        throw new ImportRefused([
          {
            path: "extends",
            message: `import ${manifest.extends.id} ${manifest.extends.version} first`,
          },
        ]);
      extendsVersionId = parent.id;
    }

    const [created] = await tx
      .insert(rulesetVersion)
      .values({ rulesetId, version: manifest.version, hash, extendsVersionId, manifest })
      .returning({ id: rulesetVersion.id });
    return { ...base, versionId: created!.id, unchanged: false }; // the row was just inserted
  });
}

/** The owner's rulesets with their versions, newest first. Manifests stay out of the list. */
export async function listRulesets(userId: string) {
  const rows = await db
    .select({
      id: ruleset.id,
      slug: ruleset.slug,
      title: ruleset.title,
      versionId: rulesetVersion.id,
      version: rulesetVersion.version,
      createdAt: rulesetVersion.createdAt,
    })
    .from(ruleset)
    .innerJoin(rulesetVersion, eq(rulesetVersion.rulesetId, ruleset.id))
    .where(eq(ruleset.ownerUserId, userId))
    .orderBy(desc(rulesetVersion.createdAt), desc(rulesetVersion.id));
  const byRuleset = new Map<string, { id: string; slug: string; title: string; versions: RulesetVersionInfo[] }>();
  for (const r of rows) {
    const entry = byRuleset.get(r.id) ?? { id: r.id, slug: r.slug, title: r.title, versions: [] };
    entry.versions.push({ id: r.versionId, version: r.version, createdAt: r.createdAt.toISOString() });
    byRuleset.set(r.id, entry);
  }
  return [...byRuleset.values()];
}

export interface RulesetVersionInfo {
  id: string;
  version: string;
  createdAt: string;
}
