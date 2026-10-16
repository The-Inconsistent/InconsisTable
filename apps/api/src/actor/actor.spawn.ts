import { and, eq, sql } from "drizzle-orm";
import type { Action, ActionResult, Ctx } from "@inconsistable/core-schema";
import type { FieldValue } from "@inconsistable/rules-engine";
import { campaign } from "../campaign/campaign.schema.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { addCombatants } from "../encounter/encounter.combatants.ts";
import { activeEncounter } from "../encounter/encounter.turn.ts";
import { entryLookup, loadServedEntries } from "../pack/pack.lookup.ts";
import { loadCompiled } from "../ruleset/ruleset.compiled.ts";
import { actor } from "./actor.schema.ts";
import { writeStart } from "./actor.start.ts";

export type SpawnAction = Extract<Action, { type: "actor.spawn" }>;

const MAX_NAME = 100;
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "<base> 1".."<base> N", continuing after the highest number already used with that base name. */
export function spawnNames({ existing, base, count }: { existing: readonly string[]; base: string; count: number }) {
  const stem = base.slice(0, MAX_NAME - 4);
  const pattern = new RegExp(`^${escapeRegExp(stem)} (\\d+)$`);
  const last = existing.reduce((max, name) => Math.max(max, Number(pattern.exec(name)?.[1] ?? 0)), 0);
  return Array.from({ length: count }, (_, i) => `${stem} ${last + i + 1}`);
}

// actor.spawn: N creatures from one entry of a pack attached to this room. A pack version never changes, so the rows
// copied from its body are the snapshot (no stat block column); later edits to the creature are its own.
export async function spawnActors(
  tx: Tx,
  { ctx, action: a }: { ctx: Ctx; action: SpawnAction },
): Promise<ActionResult> {
  const cid = ctx.campaignId;
  const compiled = (await loadCompiled(tx, cid)) ?? fail("noRuleset");
  const entries = await loadServedEntries(tx, { campaignId: cid, packVersionId: a.packVersionId });
  const stored = entries.find((e) => e.key === a.key) ?? fail("entryNotInPack");
  const entry =
    entryLookup({ entries: [stored], gm: true })({ type: stored.type, key: stored.key }) ?? fail("entryUnreadable");
  const ce = Object.hasOwn(compiled.entities, entry.type) ? compiled.entities[entry.type] : undefined;
  if (!ce || ce.def.base !== "actor") fail("notPlaceable", { name: entry.name });

  const [taken, [room]] = await Promise.all([
    tx
      .select({ name: actor.name })
      .from(actor)
      .where(
        and(eq(actor.campaignId, cid), sql`starts_with(${actor.name}, ${entry.name.slice(0, MAX_NAME - 4) + " "})`),
      ),
    tx.select({ version: campaign.rulesetVersionId }).from(campaign).where(eq(campaign.id, cid)),
  ]);
  const names = spawnNames({ existing: taken.map((t) => t.name), base: entry.name, count: a.count });
  const made = await tx
    .insert(actor)
    .values(
      names.map((name) => ({
        campaignId: cid,
        kind: "creature" as const,
        entityType: entry.type,
        name,
        temporary: a.temporary,
        rulesetVersionId: room?.version ?? null,
      })),
    )
    .returning({ id: actor.id });
  const fields = entry.body as Record<string, FieldValue>;
  const id = await writeStart(tx, { ctx, compiled, targets: made.map((m) => ({ actorId: m.id, fields })) });
  // A fight is on: the creatures join it, unseen by the table until the GM shows them.
  const fight = await activeEncounter(tx, cid);
  if (fight)
    await addCombatants(tx, {
      campaignId: cid,
      encounterId: fight.id,
      actorIds: made.map((m) => m.id),
      side: "foe",
      visibility: "hidden",
    });
  return { ok: true, id: id ?? undefined };
}
