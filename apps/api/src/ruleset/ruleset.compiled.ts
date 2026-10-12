import { eq } from "drizzle-orm";
import { compileRuleset, type CompiledRuleset } from "@inconsistable/rules-engine";
import { campaign } from "../campaign/campaign.schema.ts";
import type { Db } from "../core/db.ts";
import { rulesetVersion } from "./ruleset.schema.ts";

// A manifest is an immutable document, so its compiled form is cached under the version's `hash` (docs/design.md §5.4).
// ponytail: in-process, the oldest entry goes at 64 versions; a shared cache once more than one api node runs
const MAX_COMPILED = 64;
const cache = new Map<string, CompiledRuleset>();

/** The compiled ruleset a campaign has pinned, or null before one is. */
export async function loadCompiled(conn: Db, campaignId: string): Promise<CompiledRuleset | null> {
  const [row] = await conn
    .select({ hash: rulesetVersion.hash, manifest: rulesetVersion.manifest })
    .from(campaign)
    .innerJoin(rulesetVersion, eq(rulesetVersion.id, campaign.rulesetVersionId))
    .where(eq(campaign.id, campaignId));
  if (!row) return null;
  const hit = cache.get(row.hash);
  if (hit) return hit;
  const result = compileRuleset(row.manifest);
  // The importer validates before it stores, so this means a stored manifest the engine no longer accepts.
  if (!result.ok) throw new Error(`ruleset ${row.hash} does not compile: ${JSON.stringify(result.problems[0])}`);
  if (cache.size >= MAX_COMPILED) cache.delete(cache.keys().next().value ?? "");
  cache.set(row.hash, result.compiled);
  return result.compiled;
}
