import { and, asc, count, desc, eq, gt, isNull } from "drizzle-orm";
import { toSeatState, type Actor, type Codex, type Ctx, type LiveState } from "@inconsistable/core-schema";
import { toViewerView, type ActorView, type CompiledRuleset, type Viewer } from "@inconsistable/rules-engine";
import { buildActors, loadActorRows, toLiveActor } from "../actor/actor.values.ts";
import {
  accessToken,
  appUser,
  invite,
  membership,
  membershipCharacter,
  ownershipTransfer,
} from "../auth/auth.schema.ts";
import { campaign, session } from "../campaign/campaign.schema.ts";
import { codexEntry, codexReveal } from "../codex/codex.schema.ts";
import { db } from "../core/db.ts";
import { loadCompiled } from "../ruleset/ruleset.compiled.ts";

const iso = (d: Date | null) => d?.toISOString() ?? null;

// The live snapshot with the ruleset it was built under, read after the action's transaction commits (CLAUDE.md, "The
// server decides"). The full snapshot is for GM seats; every other seat goes through `seatState`.
// ponytail: whole snapshot per action, fine at table scale; versioned per-seat patches once a snapshot passes ~256 KB
// or its build passes ~50 ms at p95 in the P3 load test (docs/design.md §5.6)
export interface Live {
  state: LiveState;
  compiled: CompiledRuleset | null;
}

export async function loadLive(campaignId: string): Promise<Live | null> {
  const [c] = await db.select().from(campaign).where(eq(campaign.id, campaignId));
  if (!c) return null;
  const compiled = await loadCompiled(db, campaignId);
  const [sessions, actorRows, members, held, invites, guests, [screens], [transfer]] = await Promise.all([
    db.select().from(session).where(eq(session.campaignId, campaignId)).orderBy(desc(session.number)).limit(1),
    loadActorRows(db, campaignId),
    db
      .select({
        id: membership.id,
        userId: membership.userId,
        role: membership.role,
        scopes: membership.scopes,
        name: appUser.name,
      })
      .from(membership)
      .innerJoin(appUser, eq(appUser.id, membership.userId))
      .where(eq(membership.campaignId, campaignId))
      .orderBy(asc(membership.createdAt)),
    db
      .select({ membershipId: membershipCharacter.membershipId, actorId: membershipCharacter.actorId })
      .from(membershipCharacter)
      .innerJoin(membership, eq(membership.id, membershipCharacter.membershipId))
      .where(eq(membership.campaignId, campaignId)),
    db
      .select()
      .from(invite)
      .where(and(eq(invite.campaignId, campaignId), isNull(invite.revokedAt), gt(invite.expiresAt, new Date()))),
    db
      .selectDistinct({ actorId: accessToken.actorId })
      .from(accessToken)
      .where(
        and(eq(accessToken.campaignId, campaignId), eq(accessToken.role, "player"), isNull(accessToken.revokedAt)),
      ),
    db
      .select({ n: count() })
      .from(accessToken)
      .where(
        and(eq(accessToken.campaignId, campaignId), eq(accessToken.role, "screen"), isNull(accessToken.revokedAt)),
      ),
    db.select().from(ownershipTransfer).where(eq(ownershipTransfer.campaignId, campaignId)),
  ]);
  const last = sessions[0];
  const built = buildActors({ compiled, rows: actorRows });
  const state: LiveState = {
    campaign: {
      id: c.id,
      name: c.name,
      ownerUserId: c.ownerUserId,
      archived: c.archivedAt !== null,
      nextSessionAt: iso(c.nextSessionAt),
      nextSessionPlace: c.nextSessionPlace,
    },
    stateVersion: c.stateVersion,
    session:
      last && last.endedAt === null
        ? {
            id: last.id,
            number: last.number,
            title: last.title,
            startedAt: last.startedAt.toISOString(),
            endedAt: null,
            recap: last.recap,
            notes: last.notes,
          }
        : null,
    actors: actorRows.map((r) => toLiveActor(built[r.actor.id]!)), // built from these very rows
    access: {
      members: members.map((m) => ({
        userId: m.userId,
        name: m.name,
        role: m.role,
        scopes: m.scopes,
        characterIds: held.filter((h) => h.membershipId === m.id).map((h) => h.actorId),
      })),
      invites: invites.map((i) => ({
        id: i.id,
        mode: i.mode,
        role: i.role,
        actorId: i.actorId,
        allowGuests: i.allowGuests,
        expiresAt: i.expiresAt.toISOString(),
        uses: i.uses,
        maxUses: i.maxUses,
      })),
      guests: guests.flatMap((g) => (g.actorId ? [{ actorId: g.actorId }] : [])),
      screens: screens?.n ?? 0,
      transfer:
        transfer && transfer.expiresAt > new Date()
          ? { toUserId: transfer.toUserId, expiresAt: transfer.expiresAt.toISOString() }
          : null,
    },
  };
  return { state, compiled };
}

// The viewer the rules engine filters for: what the seat is, and the characters it holds.
const viewerOf = (ctx: Ctx): Viewer =>
  ctx.seat.kind === "admin"
    ? { role: "gm", characterIds: [] }
    : { role: ctx.seat.role, characterIds: ctx.seat.characterIds };

// The ruleset values of one actor as a seat may see them, in the snapshot's (mutable) shape.
const copyValues = (v: ActorView): Pick<Actor, "entity" | "fields" | "resources" | "derived" | "conditions"> => ({
  entity: v.entity,
  fields: Object.fromEntries(
    Object.entries(v.fields).map(([k, x]) => [k, typeof x === "object" && x !== null ? [...x] : x]),
  ),
  resources: { ...v.resources },
  derived: { ...v.derived },
  conditions: [...v.conditions],
});

// What one non-GM seat receives: the core filter (which actors, access, notes), then the ruleset's declared visibility
// over each actor's values (docs/design.md §5.5). Fail-closed: with no ruleset to say who sees a value, none is sent.
export function seatState({ live, ctx }: { live: Live; ctx: Ctx }): LiveState {
  const state = toSeatState({ state: live.state, ctx });
  const { compiled } = live;
  const seen = new Map(
    (compiled ? toViewerView({ compiled, viewer: viewerOf(ctx), actors: state.actors }).actors : []).map((v) => [
      v.id,
      v,
    ]),
  );
  return {
    ...state,
    actors: state.actors.map((a) => {
      const v = seen.get(a.id);
      return { ...a, ...(v ? copyValues(v) : { entity: "", fields: {}, resources: {}, derived: {}, conditions: [] }) };
    }),
  };
}

export async function loadCodex(campaignId: string): Promise<Codex> {
  const [entries, reveals] = await Promise.all([
    db.select().from(codexEntry).where(eq(codexEntry.campaignId, campaignId)).orderBy(asc(codexEntry.createdAt)),
    db
      .select({ entryId: codexReveal.entryId, actorId: codexReveal.actorId })
      .from(codexReveal)
      .innerJoin(codexEntry, eq(codexEntry.id, codexReveal.entryId))
      .where(eq(codexEntry.campaignId, campaignId)),
  ]);
  return {
    entries: entries.map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      body: e.body,
      gmNotes: e.gmNotes,
      visibility: e.visibility,
      audienceMode: e.audienceMode,
      audience: reveals.filter((r) => r.entryId === e.id).map((r) => r.actorId),
    })),
  };
}
