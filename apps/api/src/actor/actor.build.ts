import { and, eq, sql } from "drizzle-orm";
import { seatRole, type Action, type ActionResult, type Ctx } from "@inconsistable/core-schema";
import { runCreation, type CompiledRuleset } from "@inconsistable/rules-engine";
import { campaign } from "../campaign/campaign.schema.ts";
import type { Tx } from "../core/db.ts";
import { fail } from "../core/errors.ts";
import { entryLookup, loadServedEntries } from "../pack/pack.lookup.ts";
import { loadCompiled } from "../ruleset/ruleset.compiled.ts";
import { actor, actorChoice, actorField, builderDraft } from "./actor.schema.ts";
import { writeStart } from "./actor.start.ts";

export type BuildAction = Extract<Action, { type: "actor.build" }>;

/** The refusal text: the first line says what happened, then one `path: message` line per problem. */
export const problemLines = (problems: readonly { path: string; message: string }[]) =>
  ["Those answers don't build a character", ...problems.map((p) => `${p.path}: ${p.message}`)].join("\n");

/** The entity a character is built as: the one it already has, else the only one the ruleset's creation builds. */
export function buildEntity({ compiled, entityType }: { compiled: CompiledRuleset; entityType: string }): string {
  if (entityType !== "") return entityType;
  const types = [...new Set(compiled.ruleset.creation.map((s) => s.actor))];
  const only = types[0];
  if (types.length !== 1 || only === undefined) fail("Ask the GM to create this character with its type first");
  return only;
}

// actor.build: the server runs the ruleset's `creation` against the answers (the client's preview is only a preview),
// then writes the fields, the choices and the starting resources, and drops the caller's draft, all in this transaction.
export async function buildActor(tx: Tx, { ctx, action: a }: { ctx: Ctx; action: BuildAction }): Promise<ActionResult> {
  const cid = ctx.campaignId;
  const compiled = (await loadCompiled(tx, cid)) ?? fail("This game has no ruleset yet");
  const [row] = await tx
    .select({ entityType: actor.entityType, name: actor.name })
    .from(actor)
    .where(and(eq(actor.id, a.actorId), eq(actor.campaignId, cid)));
  if (!row) fail("Character not found");
  const entity = buildEntity({ compiled, entityType: row.entityType });
  if (!compiled.ruleset.creation.some((s) => s.actor === entity)) fail("This ruleset has nothing to build for that");

  const [fields, choices] = await Promise.all([
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(actorField)
      .where(eq(actorField.actorId, a.actorId)),
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(actorChoice)
      .where(eq(actorChoice.actorId, a.actorId)),
  ]);
  if ((fields[0]?.n ?? 0) + (choices[0]?.n ?? 0) > 0) fail("Already built. Ask the GM to correct a value");

  // A player picks from what a player may see; a GM side from everything attached (house decision #18).
  const types = [...new Set(compiled.ruleset.creation.flatMap((s) => (s.kind === "choose" ? [s.pick] : [])))];
  const lookup = entryLookup({
    entries: await loadServedEntries(tx, { campaignId: cid, types }),
    gm: ["gm", "cogm"].includes(seatRole(ctx.seat)),
  });
  const result = runCreation({ ruleset: compiled.ruleset, actor: entity, answers: a.answers, lookup });
  if (!result.ok) fail(problemLines(result.problems));

  const [room] = await tx.select({ version: campaign.rulesetVersionId }).from(campaign).where(eq(campaign.id, cid));
  const name = typeof result.fields.name === "string" ? result.fields.name.trim().slice(0, 100) : "";
  await tx
    .update(actor)
    .set({ entityType: entity, rulesetVersionId: room?.version ?? null, ...(name === "" ? {} : { name }) })
    .where(eq(actor.id, a.actorId));
  // ponytail: choices are plain rows, not deltas (DeltaTarget has no choice target), so undo does not remove them
  if (result.choices.length > 0)
    await tx.insert(actorChoice).values(result.choices.map((c) => ({ actorId: a.actorId, ...c })));
  const id = await writeStart(tx, { ctx, compiled, targets: [{ actorId: a.actorId, fields: result.fields }] });
  if (ctx.userId)
    await tx.delete(builderDraft).where(and(eq(builderDraft.userId, ctx.userId), eq(builderDraft.campaignId, cid)));
  return { ok: true, id: id ?? undefined };
}
