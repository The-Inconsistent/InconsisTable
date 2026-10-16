import { and, eq } from "drizzle-orm";
import { canInCampaign, type Action, type ActionResult, type Ctx } from "@inconsistable/core-schema";
import { actor } from "../actor/actor.schema.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { codexEntry, codexReveal } from "./codex.schema.ts";

export type CodexAction = Extract<Action, { type: "codex.save" | "codex.reveal" | "codex.delete" }>;

const ownEntry = async (tx: Tx, { campaignId, id }: { campaignId: string; id: string }) =>
  (
    await tx
      .select({ id: codexEntry.id })
      .from(codexEntry)
      .where(and(eq(codexEntry.id, id), eq(codexEntry.campaignId, campaignId)))
  )[0] ?? fail("entryNotFound");

export async function applyCodexAction(
  tx: Tx,
  { ctx, action: a }: { ctx: Ctx; action: CodexAction },
): Promise<ActionResult> {
  const cid = ctx.campaignId;
  switch (a.type) {
    case "codex.save": {
      // A patch: only the fields sent are written. GM notes need the secrets scope too, so a co-GM who was never
      // shown them can't blank or overwrite them (docs/design.md §3.6).
      if (a.gmNotes !== undefined && !canInCampaign({ ctx, perm: "codex:read_secret" })) fail("needSecretsScope");
      const patch = {
        ...(a.title !== undefined && { title: a.title }),
        ...(a.body !== undefined && { body: a.body }),
        ...(a.gmNotes !== undefined && { gmNotes: a.gmNotes }),
      };
      if (!a.id) {
        const [row] = await tx
          .insert(codexEntry)
          .values({ campaignId: cid, kind: a.kind, title: a.title ?? fail("giveTitle"), ...patch })
          .returning({ id: codexEntry.id });
        return { ok: true, id: row!.id }; // the row was just inserted
      }
      await ownEntry(tx, { campaignId: cid, id: a.id });
      if (Object.keys(patch).length) await tx.update(codexEntry).set(patch).where(eq(codexEntry.id, a.id));
      return { ok: true, id: a.id };
    }

    case "codex.reveal": {
      await ownEntry(tx, { campaignId: cid, id: a.id });
      const listed = a.audienceMode === "listed";
      const audience = [...new Set(a.audience)]; // a reader listed twice is one row
      if (listed && a.visibility !== "gm" && !audience.length) fail("pickAudience");
      if (listed) {
        // Only this campaign's characters can be readers.
        const held = await tx.select({ id: actor.id }).from(actor).where(eq(actor.campaignId, cid));
        const ids = new Set(held.map((r) => r.id));
        if (audience.some((x) => !ids.has(x))) fail("characterNotFound");
      }
      await tx
        .update(codexEntry)
        .set({ visibility: a.visibility, audienceMode: a.audienceMode })
        .where(eq(codexEntry.id, a.id));
      await tx.delete(codexReveal).where(eq(codexReveal.entryId, a.id));
      if (listed && audience.length)
        await tx.insert(codexReveal).values(audience.map((actorId) => ({ entryId: a.id, actorId })));
      return { ok: true };
    }

    case "codex.delete": {
      await ownEntry(tx, { campaignId: cid, id: a.id });
      await tx.delete(codexEntry).where(eq(codexEntry.id, a.id));
      return { ok: true };
    }
  }
}
