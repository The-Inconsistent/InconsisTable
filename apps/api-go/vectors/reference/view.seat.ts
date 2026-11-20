import {
  canInCampaign,
  hideMentions,
  PARTY_KINDS,
  type Actor,
  type BuilderDraftBody,
  type Clock,
  type Codex,
  type CodexEntry,
  type Ctx,
  type DealtRow,
  type Encounter,
  type RollRow,
  type LiveState,
  type PoolState,
  type RequestAnswer,
  type SpendRequest,
} from "../../../../packages/core-schema/src/index.ts";
import {
  checkFieldValue,
  toViewerView,
  type ActorView,
  type CompiledRuleset,
  type EntryVisibility,
  type Ruleset,
  type Viewer,
} from "../../../../packages/rules-engine/src/index.ts";
import { actorGmSide, heldBy, readableEntryVisibilities, sightOf, type Sight } from "./view.sight.ts";
import { seatTests } from "./view.tests.ts";

// The Seat view (CONTEXT.md): everything one seat receives, after every rule about what it may see. The one place that
// decides it (CLAUDE.md, principles 4 and 6); the gateway only loads, asks and emits. A co-GM sees hidden parts only
// where a scope covers them (house decision #31).

/** What the server holds of a campaign, whole: the raw snapshots that no seat below the GM side ever receives. */
export interface Snapshot {
  state: LiveState;
  codex: Codex;
  /** Builder drafts by user: each user gets their own in `state.myDraft`. */
  drafts: ReadonlyMap<string, BuilderDraftBody>;
}

export interface SeatView {
  /** The `state` socket event: actors, Encounter, Test Calls and the rest, with the seat's own builder draft. */
  state: LiveState;
  /** The `codex` socket event. */
  codex: Codex;
  /** The ruleset's manifest as the seat may read it; null while no ruleset is pinned. */
  manifest: Ruleset | null;
  /** The visibilities of pack entries the seat may read. */
  packVisibilities: EntryVisibility[];
}

const GM_VIEWER: Viewer = { role: "gm", characterIds: [] };
const NO_VALUES = { entity: "", fields: {}, resources: {}, derived: {}, conditions: [] };

/**
 * The manifest as a seat may read it. A seat that sees `gm` values reads all of it; any other seat gets the definitions
 * of fields, derived values, resources and conditions whose visibility is not `gm` (fail-closed: a definition that
 * declares none is `gm`). The values themselves are filtered per actor in `seatView`.
 * ponytail: a visible condition's effect formulas are shown as written, even where they name a `gm` field; strip or
 * redact them if a ruleset needs that secret kept
 */
export function seatManifest({ ruleset, ctx }: { ruleset: Ruleset; ctx: Ctx }): Ruleset {
  const shown = seatCodexDefinitions({ ruleset: seatDefinitions({ ruleset, ctx }), secrets: sightOf(ctx).secrets });
  // The entries of a `gm` or `owner` table are what a roll or a deal keeps secret: only the side that runs the table
  // with a GM reads them. Anyone else still sees the table's title (a deal can be run without a GM).
  if (shown.tables === undefined || sightOf(ctx).tables) return shown;
  return {
    ...shown,
    tables: Object.fromEntries(
      Object.entries(shown.tables).map(([id, t]) => [id, t.visibility === "party" ? t : { ...t, entries: [] }]),
    ),
  };
}

/**
 * The codex block (house decision #71) as a seat may read it: the side that reads GM notes every field, anyone else the
 * `party` ones. Independent of the actor definitions: a co-GM with `combat` but not `codex.secrets` reads no `gm` one.
 */
function seatCodexDefinitions({ ruleset, secrets }: { ruleset: Ruleset; secrets: boolean }): Ruleset {
  if (ruleset.codex === undefined || secrets) return ruleset;
  const kinds = Object.entries(ruleset.codex.kinds).map(([kind, k]) => [
    kind,
    { fields: Object.fromEntries(Object.entries(k.fields).filter(([, f]) => f.visibility === "party")) },
  ]);
  return { ...ruleset, codex: { kinds: Object.fromEntries(kinds) } };
}

/**
 * An entry's declared fields as a seat receives them (house decision #71): only what the room's ruleset declares for
 * the kind and what is still valid for it, `gm` ones only to the side that reads GM notes.
 * ponytail: a value the ruleset no longer declares, or that no longer fits, stays stored and reaches nobody; the
 * compatible upgrade (house decision #51) is where it would be carried or cleared.
 */
function seatEntryFields({ codex, ruleset, secrets }: { codex: Codex; ruleset: Ruleset | null; secrets: boolean }) {
  return {
    ...codex,
    entries: codex.entries.map((e) => {
      const defs = ruleset?.codex?.kinds[e.kind]?.fields ?? {};
      const fields = Object.entries(e.fields).filter(([id, value]) => {
        const def = Object.hasOwn(defs, id) ? defs[id] : undefined;
        return def !== undefined && (secrets || def.visibility === "party") && checkFieldValue({ def, value }) === null;
      });
      return { ...e, fields: Object.fromEntries(fields) };
    }),
  };
}

function seatDefinitions({ ruleset, ctx }: { ruleset: Ruleset; ctx: Ctx }): Ruleset {
  const sight = sightOf(ctx);
  // ponytail: the manifest is not split per entity kind; a co-GM with `party` or `combat` reads every definition
  if (sight.all || (ctx.tableMode === "gm" && (sight.combat || sight.party))) return ruleset;
  return {
    ...ruleset,
    entities: ruleset.entities.map((e) => ({
      ...e,
      fields: Object.fromEntries(Object.entries(e.fields).filter(([, f]) => f.visibility !== "gm")),
      derived: e.derived.filter((d) => d.visibility !== "gm"),
    })),
    resources: ruleset.resources.filter((r) => r.visibility !== "gm"),
    conditions: ruleset.conditions.filter((c) => c.visibility !== "gm"),
  };
}

/**
 * What one seat receives of a campaign. Pure: the snapshot, the compiled ruleset (null before one is pinned: no value is
 * sent then, fail-closed) and the seat in, the whole payload out.
 */
export function seatView({
  snapshot,
  compiled,
  ctx: seated,
}: {
  snapshot: Snapshot;
  compiled: CompiledRuleset | null;
  ctx: Ctx;
}): SeatView {
  // The mode is the campaign row's, as loaded with this snapshot: a socket opened before the table changed mode must
  // not keep the sight it was handed.
  const ctx: Ctx = { ...seated, tableMode: snapshot.state.campaign.tableMode };
  const sight = sightOf(ctx);
  const myDraft = (ctx.userId !== null && snapshot.drafts.get(ctx.userId)) || null;
  const manifest = compiled && seatManifest({ ruleset: compiled.ruleset, ctx });
  const packVisibilities = readableEntryVisibilities(ctx);
  const pools = seatPools({ pools: snapshot.state.pools, compiled, ctx });
  const fielded = seatEntryFields({
    codex: snapshot.codex,
    ruleset: compiled?.ruleset ?? null,
    secrets: sight.secrets,
  });
  if (sight.all) return { state: { ...snapshot.state, myDraft, pools }, codex: fielded, manifest, packVisibilities };
  const codex = seatCodex({ codex: fielded, ctx, sight });
  const state = seatState({ state: snapshot.state, compiled, ctx, sight });
  return {
    state: {
      ...state,
      myDraft,
      pools,
      clocks: seatClocks({ clocks: state.clocks, codex, sight }),
      ...seatRequests({ requests: state.requests, answers: state.requestAnswers, ctx, sight }),
      ...seatTables({ rolls: state.rolls, dealt: state.dealt, ctx, sight }),
    },
    codex,
    manifest,
    packVisibilities,
  };
}

// The pools a seat receives (house decision #59). The GM side (a room with a GM, a seat that runs the table; the same
// notion as the pool write path) gets every pool. Anyone else gets `public` ones, `party` ones, and `owner` ones only for
// a `party`-scope pool and a seat holding a character (never the screen); `gm` and every other `owner` pool reach nobody.
// A pool the seat may not see is dropped whole. Without a ruleset in the view, none.
export const seatPools = ({
  pools,
  compiled,
  ctx,
}: {
  pools: readonly PoolState[];
  compiled: CompiledRuleset | null;
  ctx: Ctx;
}): PoolState[] => {
  if (compiled === null) return [];
  const gmSide = ctx.tableMode === "gm" && sightOf(ctx).tables;
  const holder = !(ctx.seat.kind === "token" && ctx.seat.role === "screen") && heldBy(ctx).length > 0;
  return pools.filter(
    (p) =>
      gmSide ||
      p.visibility === "public" ||
      p.visibility === "party" ||
      (p.visibility === "owner" && p.scope === "party" && holder),
  );
};

// The rolls and dealt cards a seat receives (house decision #49): the side that runs the table with a GM sees them all.
// Anyone else sees what the table's visibility shows: `party` to every seat, `owner` to the seat that holds the card's
// character. A `gm` one, and every card without a GM, reaches nobody else.
const seatTables = ({
  rolls,
  dealt,
  ctx,
  sight,
}: {
  rolls: readonly RollRow[];
  dealt: readonly DealtRow[];
  ctx: Ctx;
  sight: Sight;
}): Pick<LiveState, "rolls" | "dealt"> => {
  const held = heldBy(ctx);
  return {
    rolls: rolls.filter((r) => sight.tables || r.visibility === "party"),
    dealt: dealt.filter(
      (d) => sight.tables || d.visibility === "party" || (d.visibility === "owner" && held.includes(d.actorId)),
    ),
  };
};

// The spend requests a seat receives: the side that answers them sees every pending request, a player only their own
// and their own answers (that side sees every answer), a screen and a guest token (no user) none.
const seatRequests = ({
  requests,
  answers,
  ctx,
  sight,
}: {
  requests: readonly SpendRequest[];
  answers: readonly RequestAnswer[];
  ctx: Ctx;
  sight: Sight;
}): Pick<LiveState, "requests" | "requestAnswers"> =>
  sight.requests
    ? { requests: [...requests], requestAnswers: [...answers] }
    : {
        requests: requests.filter((q) => ctx.userId !== null && q.userId === ctx.userId),
        requestAnswers: answers.filter((r) => ctx.userId !== null && r.userId === ctx.userId),
      };

// The clocks a seat receives: the clock side sees every clock, anyone else the `party` ones. A clock's entry id is sent
// only when the seat can read that entry, so a hidden entry's id never leaks.
const seatClocks = ({ clocks, codex, sight }: { clocks: readonly Clock[]; codex: Codex; sight: Sight }): Clock[] =>
  clocks
    .filter((k) => sight.clocks || k.visibility === "party")
    .map((k) => ({ ...k, entryId: codex.entries.some((e) => e.id === k.entryId) ? k.entryId : null }));

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

// Each actor's values as the seat may see them (docs/design.md §5.5): as a GM where the seat is on the GM side of that
// kind of actor, as a player (or the Screen) holding what it holds elsewhere.
function actorViews({ actors, compiled, ctx }: { actors: readonly Actor[]; compiled: CompiledRuleset; ctx: Ctx }) {
  const seat: Viewer = {
    role: ctx.seat.kind === "token" && ctx.seat.role === "screen" ? "screen" : "player",
    characterIds: heldBy(ctx),
  };
  const gmSide = actors.filter((a) => actorGmSide({ ctx, kind: a.kind }));
  const rest = actors.filter((a) => !gmSide.includes(a));
  return new Map(
    [
      ...toViewerView({ compiled, viewer: GM_VIEWER, actors: gmSide }).actors,
      ...toViewerView({ compiled, viewer: seat, actors: rest }).actors,
    ].map((v) => [v.id, v]),
  );
}

/**
 * The Encounter one seat receives. The combat side sees every Combatant. Anyone else (players, the table screen) gets no
 * hidden Combatant at all, the turn passes over a hidden one without naming it, a `bar` Combatant carries its fraction
 * and no numbers, and the GM's own mark (keep) stays home. A Combatant's health numbers and conditions follow the values
 * of its actor: they are sent only where the ruleset lets the seat see that resource or condition on that actor (house
 * decision #67).
 */
function seatEncounter({
  encounter,
  views,
  sight,
}: {
  encounter: Encounter | null;
  views: ReadonlyMap<string, ActorView>;
  sight: Sight;
}): Encounter | null {
  if (encounter === null) return null;
  const resource = encounter.health?.resource;
  const hpOf = (c: Encounter["combatants"][number]) =>
    resource !== undefined && Object.hasOwn(views.get(c.actorId)?.resources ?? {}, resource) ? c.hp : null;
  // Conditions follow the actor's values too: only those the ruleset lets this seat see on that actor.
  const conditionsOf = (c: Encounter["combatants"][number]) =>
    c.conditions.filter((x) => views.get(c.actorId)?.conditions.includes(x.id));
  if (sight.combat)
    return {
      ...encounter,
      combatants: encounter.combatants.map((c) => ({ ...c, hp: hpOf(c), conditions: conditionsOf(c) })),
    };
  const seen = encounter.combatants.filter((c) => c.visibility !== "hidden");
  const acting = seen.some((c) => c.id === encounter.currentId);
  return {
    ...encounter,
    conditionDefs: [],
    currentId: acting ? encounter.currentId : null,
    // Someone the seat is not sent holds the turn: said, never named (house decision #68).
    ...(encounter.currentId !== null && !acting ? { unseen: true } : {}),
    firstId: seen.some((c) => c.id === encounter.firstId) ? encounter.firstId : null,
    done: encounter.done.filter((id) => seen.some((c) => c.id === id)),
    combatants: seen.map((c, i) => ({
      ...c,
      ord: i, // renumbered over what the seat sees, so a gap never shows where a hidden one sits
      keep: false,
      conditions: conditionsOf(c),
      hp: c.visibility === "full" ? hpOf(c) : null,
    })),
  };
}

function seatState({
  state,
  compiled,
  ctx,
  sight,
}: {
  state: LiveState;
  compiled: CompiledRuleset | null;
  ctx: Ctx;
  sight: Sight;
}): LiveState {
  const held = heldBy(ctx);
  // Fail-closed: with no ruleset to say who sees a value, none is sent.
  const views = compiled ? actorViews({ actors: state.actors, compiled, ctx }) : new Map<string, ActorView>();
  return {
    ...state,
    // Everyone sees the party by name and what the seat holds; the rest of the cast is for the combat side.
    actors: state.actors
      .filter((a) => PARTY_KINDS.has(a.kind) || held.includes(a.id) || sight.combat)
      .map((a) => {
        const v = views.get(a.id);
        const own = held.includes(a.id) || actorGmSide({ ctx, kind: a.kind });
        return {
          ...a,
          ownerUserId: own ? a.ownerUserId : null,
          // The saved ledger build and sheet, and their play figures (house decisions #63, #64): the GM side and the
          // seat holding the character.
          ledger: own ? a.ledger : null,
          ...(v ? copyValues(v) : NO_VALUES),
          // The durations of the conditions the seat sees.
          conditionTimers: a.conditionTimers.filter((t) => v?.conditions.includes(t.id)),
        };
      }),
    session: state.session && { ...state.session, notes: sight.session ? state.session.notes : "" },
    tests: seatTests({ tests: state.tests, ctx, sight }),
    testDefs: sight.session || sight.tableRun ? state.testDefs : [],
    encounter: seatEncounter({ encounter: state.encounter, views, sight }),
    access: {
      ...state.access,
      // Invite codes are never in the snapshot, but who was invited for what is the party side's business.
      invites: sight.party || canInCampaign({ ctx, perm: "member:invite" }) ? state.access.invites : [],
    },
  };
}

const shownPicture = (e: CodexEntry) => {
  const imageId = e.imageRevealed ? e.imageId : null;
  return { imageId, imageRevealed: imageId !== null };
};

// The entries a seat sees: the codex and secrets sides read all of them; anyone else only what is revealed to them, and a reader
// never learns who else an entry was shown to.
function seatCodex({ codex, ctx, sight }: { codex: Codex; ctx: Ctx; sight: Sight }): Codex {
  const held = heldBy(ctx);
  const seen = codex.entries.filter(
    (e) =>
      sight.secrets ||
      sight.codex ||
      (e.visibility !== "gm" && (e.audienceMode === "all" || e.audience.some((a) => held.includes(a)))),
  );
  // A link or a parent reaches a seat only when both its ends do: an id is never a way to learn a hidden entry exists.
  const ids = new Set(seen.map((e) => e.id));
  return {
    recaps: codex.recaps,
    entries: seen.map((e) => ({
      ...e,
      body: sight.secrets || sight.codex ? e.body : hideMentions({ body: e.body, canSee: (id) => ids.has(id) }),
      gmNotes: sight.secrets ? e.gmNotes : "",
      audience: sight.secrets || sight.codex ? e.audience : e.audience.filter((a) => held.includes(a)),
      parentId: e.parentId !== null && ids.has(e.parentId) ? e.parentId : null,
      links: e.links.filter((l) => ids.has(l)),
      plannedTests: sight.secrets || sight.codex ? e.plannedTests : [],
      // A picture reaches the table only once it is shown to it (house decision #70).
      ...(sight.secrets || sight.codex ? {} : shownPicture(e)),
    })),
  };
}
