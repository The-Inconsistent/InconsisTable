import { and, eq, inArray, notExists, sql } from "drizzle-orm";
import type { Action, ActionResult, Ctx } from "@inconsistable/core-schema";
import { codexEntry, codexReveal } from "../codex/codex.schema.ts";
import type { Db, Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { actor } from "./actor.schema.ts";

export type ActorAction = Extract<Action, { type: "actor.create" | "actor.rename" | "actor.delete" }>;

// An actor of this campaign, or a refusal. Never trust an id from the client (CLAUDE.md, "Data rules").
export async function ownActor(conn: Db, { campaignId, id }: { campaignId: string; id: string }) {
  const [row] = await conn
    .select({ id: actor.id, kind: actor.kind, name: actor.name, ownerUserId: actor.ownerUserId })
    .from(actor)
    .where(and(eq(actor.id, id), eq(actor.campaignId, campaignId)));
  return row ?? fail("Character not found");
}

export async function createActor(
  tx: Tx,
  {
    campaignId,
    kind,
    name,
    ownerUserId,
  }: Pick<typeof actor.$inferInsert, "campaignId" | "kind" | "name" | "ownerUserId">,
) {
  const [row] = await tx.insert(actor).values({ campaignId, kind, name, ownerUserId }).returning({ id: actor.id });
  return row!.id; // the row was just inserted
}

// Before a character goes, every `listed` entry it was the last reader of turns GM-only, so a private handout never
// falls back to the whole table when its audience empties (docs/design.md §5.4).
async function hideOrphanedEntries(tx: Tx, { campaignId, actorId }: { campaignId: string; actorId: string }) {
  const other = tx
    .select({ one: sql`1` })
    .from(codexReveal)
    .where(and(eq(codexReveal.entryId, codexEntry.id), sql`${codexReveal.actorId} <> ${actorId}`));
  const mine = tx.select({ entryId: codexReveal.entryId }).from(codexReveal).where(eq(codexReveal.actorId, actorId));
  await tx
    .update(codexEntry)
    .set({ visibility: "gm", audienceMode: "all" })
    .where(
      and(
        eq(codexEntry.campaignId, campaignId),
        eq(codexEntry.audienceMode, "listed"),
        inArray(codexEntry.id, mine),
        notExists(other),
      ),
    );
}

export async function applyActorAction(
  tx: Tx,
  { ctx, action: a }: { ctx: Ctx; action: ActorAction },
): Promise<ActionResult> {
  const campaignId = ctx.campaignId;
  switch (a.type) {
    case "actor.create": {
      const id = await createActor(tx, { campaignId, kind: a.kind, name: a.name, ownerUserId: null });
      return { ok: true, id };
    }
    case "actor.rename": {
      await ownActor(tx, { campaignId, id: a.id });
      await tx.update(actor).set({ name: a.name }).where(eq(actor.id, a.id));
      return { ok: true };
    }
    case "actor.delete": {
      await ownActor(tx, { campaignId, id: a.id });
      await hideOrphanedEntries(tx, { campaignId, actorId: a.id });
      await tx.delete(actor).where(eq(actor.id, a.id)); // seats, tokens and reveal rows cascade
      return { ok: true };
    }
  }
}
