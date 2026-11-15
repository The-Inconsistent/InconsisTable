import {
  canInCampaign,
  gmPermOf,
  roleOf,
  type ActorKind,
  type Ctx,
} from "../../../../packages/core-schema/src/index.ts";
import type { EntryVisibility, Visibility } from "../../../../packages/rules-engine/src/index.ts";

// "Is this seat on the GM side?" has one answer per part of the table (house decision #31). The GM, the room's owner and
// an admin who opened the room without a seat are on every side; a co-GM only on the sides their scopes cover; anyone
// else on none. A seated admin is just that seat. Pure: no database, so it is unit tested without one.

/** What a seat may see of the parts of the table that are hidden from players. */
export interface Sight {
  /** The GM, the owner, an unseated admin: everything, whatever a scope says. */
  all: boolean;
  /** Hidden Combatants, Creature and NPC values, the whole Encounter, `gm` pack entries. */
  combat: boolean;
  /** Hidden Test targets and inputs, the session notes. */
  session: boolean;
  /** Secret codex entries and the notes on them. */
  secrets: boolean;
  /** Every codex entry, `gm` ones and each entry's audience (not the notes on them: those are `secrets`). */
  codex: boolean;
  /** The `gm` fields and resources of the party's Characters. */
  party: boolean;
  /** The `gm` clocks. */
  clocks: boolean;
  /** Every player's pending spend requests: the side that answers them. */
  requests: boolean;
  /** Every `gm` roll and every dealt card: the side that runs the table, with a GM. Never without one. */
  tables: boolean;
  /**
   * A player seat of a room without a GM: it sees the whole Encounter and every Test call, since nothing is hidden
   * there. It sees none of the GM side (no `gm` entry, note, pack entry, field or hidden target), whatever it may run.
   */
  tableRun: boolean;
}

/** Whether the seat runs the room as its GM. An admin who opened it does not: they see all, but they run nothing. */
export const runsAsGm = (ctx: Ctx): boolean =>
  ctx.tableMode === "gm" && ctx.seat.kind === "member" && ctx.seat.role === "gm";

/**
 * Without a GM the table permissions (session:run, encounter:run, test:call, codex:write...) go to every player, so the
 * sight is NOT read from them: that would hand every player the GM side. Only an unseated admin sees all there.
 */
export function sightOf(ctx: Ctx): Sight {
  if (ctx.tableMode !== "gm" && ctx.seat.kind !== "admin") {
    const player = roleOf(ctx) === "player";
    return {
      all: false,
      combat: player,
      session: false,
      secrets: false,
      codex: false,
      party: false,
      clocks: false,
      requests: false,
      tables: false,
      tableRun: player,
    };
  }
  const all = ctx.seat.kind === "admin" || runsAsGm(ctx) || (ctx.userId !== null && ctx.userId === ctx.campaignOwnerId);
  // The scopes themselves are `COGM_SCOPES_FOR` in core-schema, which also decides actions: asked here, not copied.
  const can = (perm: Parameters<typeof canInCampaign>[0]["perm"]) => all || canInCampaign({ ctx, perm });
  return {
    all,
    combat: can("encounter:run"),
    session: can("test:call"),
    secrets: can("codex:read_secret"),
    codex: can("codex:write"),
    party: can("character:edit:any"),
    clocks: can("clock:run"),
    requests: can("request:resolve"),
    tables: can("session:run"),
    tableRun: false,
  };
}

/** The characters this seat holds. An admin who opened the room holds none. */
export const heldBy = (ctx: Ctx): readonly string[] => (ctx.seat.kind === "admin" ? [] : ctx.seat.characterIds);

/** Whether the seat sees and writes every value of an actor of this kind: `party` covers the party, `combat` the rest. */
export const actorGmSide = ({ ctx, kind }: { ctx: Ctx; kind: ActorKind }): boolean =>
  sightOf(ctx).all || (ctx.tableMode === "gm" && canInCampaign({ ctx, perm: gmPermOf(kind) }));

/**
 * Whether the seat writes a value of this visibility on an actor of this kind, whatever its `editableBy`. The GM side of
 * the kind does. A co-GM outside it still writes what everyone sees (what their action's permission lets them touch);
 * the hidden values need the scope that shows them: `party` for a Character's, `combat` for a Creature's or NPC's.
 */
export const actorWriteSide = ({ ctx, kind, visibility }: { ctx: Ctx; kind: ActorKind; visibility: Visibility }) =>
  actorGmSide({ ctx, kind }) ||
  (ctx.seat.kind === "member" && roleOf(ctx) === "cogm" && (visibility === "public" || visibility === "party"));

/** The visibilities of pack entries the seat may read; the RULES route filters by them in SQL. */
export const readableEntryVisibilities = (ctx: Ctx): EntryVisibility[] =>
  readsGm(ctx) ? ["public", "party", "gm"] : ["public", "party"];

/** Whether the seat reads `gm` pack entries and the `gm` definitions of the manifest. Without a GM nobody does. */
export const readsGm = (ctx: Ctx): boolean => {
  const sight = sightOf(ctx);
  return sight.all || (ctx.tableMode === "gm" && sight.combat);
};
