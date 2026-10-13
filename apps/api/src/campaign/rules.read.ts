import { and, asc, count, eq, ilike, inArray } from "drizzle-orm";
import { seatRole, type Ctx } from "@inconsistable/core-schema";
import { validateRuleset } from "@inconsistable/rules-engine";
import { db } from "../core/db.ts";
import { servedPacks } from "../pack/pack.lookup.ts";
import { campaignPack, pack, packEntry, packVersion } from "../pack/pack.schema.ts";
import { ruleset, rulesetVersion } from "../ruleset/ruleset.schema.ts";
import { manifestForSeat } from "../ruleset/ruleset.view.ts";
import { campaign } from "./campaign.schema.ts";

export const MAX_RULES_PAGE = 500;
export const DEFAULT_RULES_PAGE = 200;

export interface RulesQuery {
  type?: string;
  q?: string;
  limit: number;
  offset: number;
}

// `%` and `_` in a search are text, not wildcards.
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

/**
 * What a seat may read of the room's rules: the pinned ruleset's manifest and the entries of the attached packs, both
 * filtered for the seat. The only door to pack content (CLAUDE.md, principle 4):
 * - the caller is a seat of this room (resolved by the controller; this takes its Ctx);
 * - a `gm` entry goes to GM-side seats only, `party` and `public` to every seat;
 * - a pack taken down by an admin is served to nobody;
 * - a `private` pack is served only while its owner is a GM of this room.
 */
export async function readRules({ ctx, query }: { ctx: Ctx; query: RulesQuery }) {
  const gm = ["gm", "cogm"].includes(seatRole(ctx.seat));
  const cid = ctx.campaignId;

  const [pinned] = await db
    .select({
      id: rulesetVersion.id,
      slug: ruleset.slug,
      version: rulesetVersion.version,
      manifest: rulesetVersion.manifest,
    })
    .from(campaign)
    .innerJoin(rulesetVersion, eq(rulesetVersion.id, campaign.rulesetVersionId))
    .innerJoin(ruleset, eq(ruleset.id, rulesetVersion.rulesetId))
    .where(eq(campaign.id, cid));
  const checked = pinned && validateRuleset(pinned.manifest);
  if (checked && !checked.ok) throw new Error(`pinned ruleset ${pinned?.id} no longer validates`);

  const packs = await db
    .select({
      versionId: packVersion.id,
      slug: pack.slug,
      version: packVersion.version,
      license: pack.license,
      attribution: pack.attribution,
    })
    .from(campaignPack)
    .innerJoin(packVersion, eq(packVersion.id, campaignPack.packVersionId))
    .innerJoin(pack, eq(pack.id, packVersion.packId))
    .where(servedPacks(db, cid))
    .orderBy(asc(pack.slug));

  const where = and(
    inArray(
      packEntry.packVersionId,
      packs.map((p) => p.versionId),
    ),
    gm ? undefined : inArray(packEntry.visibility, ["public", "party"]),
    query.type ? eq(packEntry.type, query.type) : undefined,
    query.q ? ilike(packEntry.name, likePattern(query.q)) : undefined,
  );
  const [entries, [total]] = packs.length
    ? await Promise.all([
        db
          .select({
            versionId: packEntry.packVersionId,
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
          .where(where)
          .orderBy(asc(packEntry.type), asc(packEntry.name), asc(packEntry.key))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ n: count() }).from(packEntry).where(where),
      ])
    : [[], [{ n: 0 }]];

  const slugOf = new Map(packs.map((p) => [p.versionId, p.slug]));
  return {
    ruleset:
      pinned && checked?.ok
        ? {
            versionId: pinned.id,
            slug: pinned.slug,
            version: pinned.version,
            manifest: manifestForSeat({ ruleset: checked.ruleset, gm }),
          }
        : null,
    packs: packs.map(({ versionId, ...p }) => ({ id: versionId, ...p })),
    entries: entries.map(({ versionId, ...e }) => ({ pack: slugOf.get(versionId) ?? "", ...e })),
    total: total?.n ?? 0,
  };
}
