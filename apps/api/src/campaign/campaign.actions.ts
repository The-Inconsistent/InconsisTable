import { and, desc, eq, isNull } from "drizzle-orm";
import { canInCampaign, type Action, type ActionResult, type Ctx } from "@inconsistable/core-schema";
import { invite, ownershipTransfer } from "../auth/auth.schema.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { restActors } from "../ruleset/ruleset.actions.ts";
import { campaign, session } from "./campaign.schema.ts";

export type CampaignAction = Extract<
  Action,
  {
    type:
      | "campaign.update"
      | "campaign.archive"
      | "campaign.unarchive"
      | "campaign.delete"
      | "session.start"
      | "session.end"
      | "session.edit";
  }
>;

const running = (campaignId: string) => and(eq(session.campaignId, campaignId), isNull(session.endedAt));

// Starting and ending a session apply the ruleset's resetOn: sessionStart / sessionEnd to every actor.
export async function applyCampaignAction(
  tx: Tx,
  { ctx, action: a }: { ctx: Ctx; action: CampaignAction },
): Promise<ActionResult> {
  const cid = ctx.campaignId;
  switch (a.type) {
    case "campaign.update": {
      const { type: _type, nextSessionAt, ...patch } = a;
      await tx
        .update(campaign)
        .set({
          ...patch,
          ...(nextSessionAt !== undefined && {
            nextSessionAt: nextSessionAt === null ? null : new Date(nextSessionAt),
          }),
        })
        .where(eq(campaign.id, cid));
      return { ok: true };
    }

    case "campaign.archive": {
      // Read-only until unarchived: the running session ends, open invites and a pending transfer stop working.
      await tx.update(session).set({ endedAt: new Date() }).where(running(cid));
      await tx
        .update(invite)
        .set({ revokedAt: new Date() })
        .where(and(eq(invite.campaignId, cid), isNull(invite.revokedAt)));
      await tx.delete(ownershipTransfer).where(eq(ownershipTransfer.campaignId, cid));
      await tx.update(campaign).set({ archivedAt: new Date() }).where(eq(campaign.id, cid));
      return { ok: true };
    }

    case "campaign.unarchive":
      await tx.update(campaign).set({ archivedAt: null }).where(eq(campaign.id, cid));
      return { ok: true };

    case "campaign.delete": {
      // Kept from Auspex (#178): only an archived game, and only after typing its name.
      const [c] = await tx
        .select({ name: campaign.name, archivedAt: campaign.archivedAt })
        .from(campaign)
        .where(eq(campaign.id, cid));
      if (!c?.archivedAt) fail("Archive the game before deleting it");
      if (a.name.trim() !== c.name) fail("Type the game's name to delete it");
      await tx.delete(campaign).where(eq(campaign.id, cid)); // everything it owns cascades
      return { ok: true };
    }

    case "session.start": {
      if ((await tx.select({ id: session.id }).from(session).where(running(cid))).length)
        fail("A session is already running");
      const [last] = await tx
        .select({ number: session.number })
        .from(session)
        .where(eq(session.campaignId, cid))
        .orderBy(desc(session.number))
        .limit(1);
      const [row] = await tx
        .insert(session)
        .values({ campaignId: cid, number: (last?.number ?? 0) + 1, title: a.title })
        .returning({ id: session.id });
      await tx.update(campaign).set({ nextSessionAt: null }).where(eq(campaign.id, cid));
      await restActors(tx, { ctx, event: "sessionStart" }); // logged in the session just opened
      return { ok: true, id: row!.id }; // the row was just inserted
    }

    case "session.end": {
      // Before the session ends, so the reset is logged in it. With no session running the refusal below rolls it back.
      await restActors(tx, { ctx, event: "sessionEnd" });
      const r = await tx
        .update(session)
        .set({ endedAt: new Date(), recap: a.recap })
        .where(running(cid))
        .returning({ id: session.id });
      return r.length ? { ok: true } : fail("No session is running");
    }

    case "session.edit": {
      // Session notes are the GM's secrets: a co-GM who was never shown them can't overwrite them (as in codex.save).
      if (a.notes !== undefined && !canInCampaign({ ctx, perm: "codex:read_secret" }))
        fail("Session notes need the secrets scope");
      const { type: _type, sessionId, ...patch } = a;
      const r = await tx
        .update(session)
        .set(patch)
        .where(and(eq(session.id, sessionId), eq(session.campaignId, cid)))
        .returning({ id: session.id });
      return r.length ? { ok: true } : fail("Session not found");
    }
  }
}
