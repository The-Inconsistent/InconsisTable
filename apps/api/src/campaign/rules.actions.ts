import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { Action, ActionResult, Ctx } from "@inconsistable/core-schema";
import { actor } from "../actor/actor.schema.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { campaignPack, pack, packVersion } from "../pack/pack.schema.ts";
import { ruleset, rulesetVersion } from "../ruleset/ruleset.schema.ts";
import { campaign } from "./campaign.schema.ts";

export type RulesAction = Extract<
  Action,
  { type: "campaign.setRuleset" | "campaign.attachPack" | "campaign.detachPack" }
>;

// The caller's own pack version with the pack's state, or a refusal. A pack that is someone else's reads as missing.
async function ownPackVersion(tx: Tx, { ctx, packVersionId }: { ctx: Ctx; packVersionId: string }) {
  const [row] = await tx
    .select({ pack })
    .from(packVersion)
    .innerJoin(pack, eq(pack.id, packVersion.packId))
    .where(and(eq(packVersion.id, packVersionId), eq(pack.ownerUserId, ctx.userId ?? "")));
  return row?.pack ?? fail("Pack not found");
}

// ponytail: a room pins its ruleset version once. Moving a room that already has characters to another version needs
// the migration with a dry-run diff (docs/p1-plan.md "Không làm ở P1"); until then it is refused.
export async function applyRulesAction(
  tx: Tx,
  { ctx, action: a }: { ctx: Ctx; action: RulesAction },
): Promise<ActionResult> {
  const cid = ctx.campaignId;
  switch (a.type) {
    case "campaign.setRuleset": {
      // Only a version the caller imported: a ruleset is its owner's until sharing exists.
      const [version] = await tx
        .select({ id: rulesetVersion.id, rulesetId: rulesetVersion.rulesetId })
        .from(rulesetVersion)
        .innerJoin(ruleset, eq(ruleset.id, rulesetVersion.rulesetId))
        .where(and(eq(rulesetVersion.id, a.rulesetVersionId), eq(ruleset.ownerUserId, ctx.userId ?? "")));
      if (!version) fail("Ruleset not found");
      const [room] = await tx.select({ current: campaign.rulesetVersionId }).from(campaign).where(eq(campaign.id, cid));
      if (room?.current === version.id) return { ok: true };

      // Characters carry the version their values were built under; a different one would orphan them.
      const used = await tx
        .select({ id: actor.id })
        .from(actor)
        .where(
          and(
            eq(actor.campaignId, cid),
            or(isNotNull(actor.rulesetVersionId), ne(actor.entityType, "")),
            sql`${actor.rulesetVersionId} is distinct from ${version.id}`,
          ),
        )
        .limit(1);
      if (used.length) fail("Characters here already use another version of the ruleset");

      // Packs are written for one ruleset; keep only ones that fit the new version's.
      const attached = await tx
        .select({ rulesetId: pack.rulesetId })
        .from(campaignPack)
        .innerJoin(packVersion, eq(packVersion.id, campaignPack.packVersionId))
        .innerJoin(pack, eq(pack.id, packVersion.packId))
        .where(and(eq(campaignPack.campaignId, cid), ne(pack.rulesetId, version.rulesetId)));
      if (attached.length) fail("Detach the packs written for the other ruleset first");

      await tx.update(campaign).set({ rulesetVersionId: version.id }).where(eq(campaign.id, cid));
      return { ok: true };
    }

    case "campaign.attachPack": {
      const p = await ownPackVersion(tx, { ctx, packVersionId: a.packVersionId });
      if (p.disabledAt) fail("This pack was taken down by an admin");
      if (p.hiddenAt) fail("This pack is deleted: import it again to use it");
      // A `private` pack (copied from a book) never leaves the rooms its owner runs as GM (CLAUDE.md, principle 4).
      if (p.license === "private" && !(ctx.seat.kind === "member" && ctx.seat.role === "gm"))
        fail("A private pack can only be used in a room you run as GM");

      const [room] = await tx
        .select({ rulesetId: rulesetVersion.rulesetId })
        .from(campaign)
        .innerJoin(rulesetVersion, eq(rulesetVersion.id, campaign.rulesetVersionId))
        .where(eq(campaign.id, cid));
      if (!room) fail("Pick the room's ruleset first");
      if (room.rulesetId !== p.rulesetId) fail("This pack is written for another ruleset");

      // One version of a pack at a time: attaching a newer one replaces the older.
      await tx.delete(campaignPack).where(
        and(
          eq(campaignPack.campaignId, cid),
          inArray(
            campaignPack.packVersionId,
            tx
              .select({ id: packVersion.id })
              .from(packVersion)
              .where(and(eq(packVersion.packId, p.id), ne(packVersion.id, a.packVersionId))),
          ),
        ),
      );
      await tx.insert(campaignPack).values({ campaignId: cid, packVersionId: a.packVersionId }).onConflictDoNothing();
      return { ok: true };
    }

    case "campaign.detachPack": {
      // Scoped to this room's own rows, so another room's pin is never touched by an id from the client.
      const gone = await tx
        .delete(campaignPack)
        .where(and(eq(campaignPack.campaignId, cid), eq(campaignPack.packVersionId, a.packVersionId)))
        .returning({ id: campaignPack.packVersionId });
      return gone.length ? { ok: true } : fail("That pack isn't attached");
    }
  }
}
