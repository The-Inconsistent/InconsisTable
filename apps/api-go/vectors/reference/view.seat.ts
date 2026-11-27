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
  type HeldRecord,
  type HistoryLine,
  type RollRow,
  type LiveState,
  type PoolState,
  type RequestAnswer,
  type SpendRequest,
  type Whisper,
} from "../../../../packages/core-schema/src/index.ts";
import {
  checkFieldValue,
  compileRuleset,
  fitRows,
  partyReadsReminder,
  toViewerView,
  type ActorView,
  type CompiledRuleset,
  type EntryVisibility,
  type Ruleset,
  type Viewer,
} from "../../../../packages/rules-engine/src/index.ts";
import { compilable } from "./view.compiles.ts";
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
 * declares none is `gm`). The values themselves are filtered per actor in `seatView`. What is left is cut until it
 * compiles (house decision #101): a part that names a definition the seat may not read goes with it.
 */
export function seatManifest({ ruleset, ctx }: { ruleset: Ruleset; ctx: Ctx }): Ruleset {
  const defs = seatCodexDefinitions({ ruleset: seatDefinitions({ ruleset, ctx }), secrets: sightOf(ctx).secrets });
  // The setup checklist (house decision #90) and the generators (house decision #98) are the GM's: only the side that
  // reads GM notes is sent them.
  const { checklist: _checklist, generators: _generators, ...unlisted } = defs;
  const shown =
    sightOf(ctx).secrets || (defs.checklist === undefined && defs.generators === undefined) ? defs : unlisted;
  // The entries of a `gm` or `owner` table are what a roll or a deal keeps secret: only the side that runs the table
  // with a GM reads them. Anyone else still sees the table's title (a deal can be run without a GM).
  const served =
    shown.tables === undefined || sightOf(ctx).tables
      ? shown
      : {
          ...shown,
          tables: Object.fromEntries(
            Object.entries(shown.tables).map(([id, t]) => [id, t.visibility === "party" ? t : { ...t, entries: [] }]),
          ),
        };
  // Only a manifest that compiles is cut to compile for a seat: a room always pins one (an import compiles it).
  return compileRuleset(ruleset).ok ? compilable(served) : served;
}

/**
 * The codex block (house decision #71) as a seat may read it: the side that reads GM notes every field, anyone else the
 * `party` ones. Independent of the actor definitions: a co-GM with `combat` but not `codex.secrets` reads no `gm` one.
 */
function seatCodexDefinitions({ ruleset, secrets }: { ruleset: Ruleset; secrets: boolean }): Ruleset {
  if (ruleset.codex === undefined || secrets) return ruleset;
  // A reminder goes only where every field its `if` reads goes (house decision #89).
  const kinds = Object.entries(ruleset.codex.kinds).map(([kind, k]) => [
    kind,
    {
      fields: Object.fromEntries(Object.entries(k.fields).filter(([, f]) => f.visibility === "party")),
      ...(k.reminders === undefined
        ? {}
        : {
            reminders: k.reminders.filter((reminder) =>
              partyReadsReminder({ kind: k, reminder, campaign: ruleset.campaignFields }),
            ),
          }),
    },
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
      const fields = Object.entries(e.fields).flatMap(([id, value]): [string, (typeof e.fields)[string]][] => {
        const def = Object.hasOwn(defs, id) ? defs[id] : undefined;
        if (def === undefined || !(secrets || def.visibility === "party")) return [];
        // A rows value keeps what still fits, row by row and cell by cell (house decision #89).
        if (def.type === "rows") {
          const fit = fitRows({ def, value });
          return fit === null ? [] : [[id, fit as Record<string, unknown>[]]];
        }
        return checkFieldValue({ def, value }) === null ? [[id, value]] : [];
      });
      return { ...e, fields: Object.fromEntries(fields) };
    }),
  };
}

/**
 * The links between entries (house decision #76) a seat receives, run on the codex as the seat receives it: an `entry`
 * field stays only while it names an entry of the field's kind that the seat also receives. The side that reads every
 * entry keeps every link whose target exists; anyone else loses one to an entry hidden from them, so nothing names it.
 * ponytail: a link whose target was deleted stays stored and reaches nobody, as a value the ruleset no longer declares;
 * the compatible upgrade (house decision #51) is where it would be carried or cleared.
 */
function seatEntryLinks({ codex, ruleset }: { codex: Codex; ruleset: Ruleset | null }): Codex {
  const kinds = new Map(codex.entries.map((e) => [e.id, e.kind] as const));
  return {
    ...codex,
    entries: codex.entries.map((e) => {
      const defs = ruleset?.codex?.kinds[e.kind]?.fields ?? {};
      const fields = Object.entries(e.fields).filter(([id, value]) => {
        const def = Object.hasOwn(defs, id) ? defs[id] : undefined;
        return def?.type !== "entry" || (typeof value === "string" && kinds.get(value) === def.kind);
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
  const ruleset = compiled?.ruleset ?? null;
  const fielded = seatEntryFields({ codex: snapshot.codex, ruleset, secrets: sight.secrets });
  if (sight.all) {
    const codex = seatEntryLinks({ codex: fielded, ruleset });
    return { state: { ...snapshot.state, myDraft, pools }, codex, manifest, packVisibilities };
  }
  const codex = seatEntryLinks({ codex: seatCodex({ codex: fielded, ctx, sight }), ruleset });
  const state = seatState({ state: snapshot.state, compiled, ctx, sight });
  const seen = new Set(codex.entries.map((e) => e.id));
  const clocks = seatClocks({ clocks: state.clocks, codex, sight });
  return {
    state: {
      ...state,
      // The journal's recaps read like the codex's (house decision #136).
      journal:
        sight.secrets || sight.codex
          ? state.journal
          : state.journal.map((s) => ({ ...s, recap: hideMentions({ body: s.recap, canSee: (id) => seen.has(id) }) })),
      myDraft,
      pools,
      clocks,
      ...seatRequests({ requests: state.requests, answers: state.requestAnswers, ctx, sight, ruleset, pools }),
      ...seatTables({ rolls: state.rolls, dealt: state.dealt, ctx, sight }),
      whispers: seatWhispers({ whispers: state.whispers, ctx, sight }),
      history: seatHistory({ whole: snapshot.state, pools, clocks, codex, compiled, ctx, sight }),
    },
    codex,
    manifest,
    packVisibilities,
  };
}

/**
 * HISTORY as one seat receives it (house decision #133): the side that may undo (the combat side, as Undo is
 * `encounter:run`), and of each action only the writes of values the seat sees: an actor's field, resource or condition
 * by the ruleset's visibility as that seat sees that actor; a pool, a clock or a codex entry it is sent; the turn; a
 * Test's value to the session side or a table without a GM. An item row and anything else stay home (fail-closed). A
 * condition row goes without its source. An action left with no write and no strike is dropped; with none left the key
 * is absent. The api fills `history` only for the `session:history` read, never in a pushed state.
 */
function seatHistory({
  whole,
  pools,
  clocks,
  codex,
  compiled,
  ctx,
  sight,
}: {
  whole: LiveState;
  pools: readonly PoolState[];
  clocks: readonly Clock[];
  codex: Codex;
  compiled: CompiledRuleset | null;
  ctx: Ctx;
  sight: Sight;
}): HistoryLine[] | undefined {
  if (!sight.combat || whole.history === undefined || whole.history.length === 0) return undefined;
  const actors = new Map(whole.actors.map((a) => [a.id, a]));
  const seat: Viewer = {
    role: ctx.seat.kind === "token" && ctx.seat.role === "screen" ? "screen" : "player",
    characterIds: heldBy(ctx),
  };
  const conditionOf = (w: HistoryLine["writes"][number]) =>
    [w.after, w.before].flatMap((v) =>
      typeof v === "object" && v !== null && "conditionId" in v && typeof v.conditionId === "string"
        ? [v.conditionId]
        : [],
    )[0];
  const sees = (w: HistoryLine["writes"][number]): boolean => {
    const t = w.target;
    if (t.actorId !== undefined && t.actorId !== "") {
      const a = actors.get(t.actorId);
      if (a === undefined || compiled === null) return false;
      const viewer = actorGmSide({ ctx, kind: a.kind }) ? GM_VIEWER : seat;
      // The write as one value of the actor, through the one filter every actor value goes through.
      const condition = conditionOf(w);
      const value = t.resource
        ? { resources: { [t.resource]: 0 } }
        : t.field
          ? { fields: { [t.field]: null } }
          : t.condition && condition !== undefined
            ? { conditions: [condition] }
            : null;
      if (value === null) return false;
      const probe: ActorView = {
        id: a.id,
        entity: a.entity,
        fields: {},
        resources: {},
        derived: {},
        conditions: [],
        ...value,
      };
      const [seen] = toViewerView({ compiled, viewer, actors: [probe] }).actors;
      return (
        seen !== undefined &&
        Object.keys(seen.resources).length + Object.keys(seen.fields).length + seen.conditions.length > 0
      );
    }
    if (t.pool) return pools.some((p) => p.id === t.pool);
    if (t.clock) return clocks.some((k) => k.id === t.clock);
    if (t.entry) return codex.entries.some((e) => e.id === t.entry);
    if (t.turn) return true;
    if (t.test) return sight.session || sight.tableRun;
    return false;
  };
  // A condition row without its source, which may hold the GM's words.
  const shown = (v: unknown): unknown => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return v;
    const row = v as Record<string, unknown>;
    return Object.fromEntries(
      ["conditionId", "stacks", "expiresOn", "expiresAfter"].flatMap((k) => (k in row ? [[k, row[k]]] : [])),
    );
  };
  const history = whole.history.flatMap((line) => {
    const writes = line.writes
      .filter(sees)
      .map((w) => (w.target.condition ? { ...w, before: shown(w.before), after: shown(w.after) } : w));
    const cut = { ...line, writes };
    return cut.writes.length > 0 || cut.strike !== undefined ? [cut] : [];
  });
  return history.length > 0 ? history : undefined;
}

// The whispers a seat receives (house decision #93): the side that runs the session with a GM (the one that sends them)
// gets every one. Anyone else gets only whispers to a character it holds, with only those readers: never another
// reader's reply, name or existence. The screen holds none, so it gets none.
const seatWhispers = ({
  whispers,
  ctx,
  sight,
}: {
  whispers: readonly Whisper[];
  ctx: Ctx;
  sight: Sight;
}): Whisper[] => {
  if (sight.tables) return [...whispers];
  const held = heldBy(ctx);
  return whispers.flatMap((w) => {
    const readers = w.readers.filter((r) => held.includes(r.actorId));
    return readers.length > 0 ? [{ ...w, readers }] : [];
  });
};

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

// The spend requests a seat receives: the side that answers them sees every pending request, a player their own and
// their own answers (that side sees every answer). An ask for a spend that costs pools also reaches every seat that
// receives each of those pools (house decision #84); a spend that costs no pool stays with the asker and that side.
const seatRequests = ({
  requests,
  answers,
  ctx,
  sight,
  ruleset,
  pools,
}: {
  requests: readonly SpendRequest[];
  answers: readonly RequestAnswer[];
  ctx: Ctx;
  sight: Sight;
  ruleset: Ruleset | null;
  pools: readonly PoolState[];
}): Pick<LiveState, "requests" | "requestAnswers"> => {
  if (sight.requests) return { requests: [...requests], requestAnswers: [...answers] };
  const seen = new Set(pools.map((p) => p.id));
  const onSeenPools = (q: SpendRequest) => {
    const costs = ruleset?.spends?.find((s) => s.id === q.spendId)?.cost ?? [];
    const charged = costs.flatMap((c) => (c.pool === undefined ? [] : [c.pool]));
    return charged.length > 0 && charged.every((pool) => seen.has(pool));
  };
  return {
    requests: requests.filter((q) => (ctx.userId !== null && q.userId === ctx.userId) || onSeenPools(q)),
    requestAnswers: answers.filter((r) => ctx.userId !== null && r.userId === ctx.userId),
  };
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
  // A reminder line may name a hidden combatant: the combat side's only (house decision #81), and so may the step TURN
  // BACK would take (house decision #82), and the fight's log (house decision #100).
  const { reminders: _reminders, turnBack: _turnBack, log: _log, ...rest } = encounter;
  return {
    ...rest,
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
  // House decision #117: a combatant the GM shows in full reaches every seat, cut to what the seat may read.
  const shown = new Set(
    (state.encounter?.combatants ?? []).filter((c) => c.visibility === "full").map((c) => c.actorId),
  );
  return {
    ...state,
    // Everyone sees the party by name and what the seat holds; the rest of the cast is for the combat side.
    actors: state.actors
      .filter((a) => PARTY_KINDS.has(a.kind) || held.includes(a.id) || sight.combat || shown.has(a.id))
      .map(({ spawnOptions, ...a }) => {
        const v = views.get(a.id);
        const own = held.includes(a.id) || actorGmSide({ ctx, kind: a.kind });
        return {
          ...a,
          // The spawn options it was spawned with (house decision #92): the GM side and the seat holding it.
          ...(own && spawnOptions !== undefined && spawnOptions.length > 0 ? { spawnOptions } : {}),
          ownerUserId: own ? a.ownerUserId : null,
          // The saved ledger build and sheet, and their play figures (house decisions #63, #64): the GM side and the
          // seat holding the character.
          ledger: own ? a.ledger : null,
          // The items it holds, as its saved build's lines (house decision #95).
          items: own ? (a.items ?? []) : [],
          ...(v ? copyValues(v) : NO_VALUES),
          // The durations of the conditions the seat sees.
          conditionTimers: a.conditionTimers.filter((t) => v?.conditions.includes(t.id)),
          held: seatHeld({ held: a.held ?? [], compiled, seen: v !== undefined, named: own, fields: v?.fields ?? {} }),
        };
      }),
    session: state.session && { ...state.session, notes: sight.session ? state.session.notes : "" },
    tests: seatTests({ tests: state.tests, ctx, sight }),
    testDefs: sight.session || sight.tableRun ? state.testDefs : [],
    // The GM's journal (house decision #85): the seats that run the room; the notes only to the session side.
    journal:
      sight.session || sight.tableRun ? state.journal.map((s) => ({ ...s, notes: sight.session ? s.notes : "" })) : [],
    encounter: seatEncounter({ encounter: state.encounter, views, sight }),
    access: {
      ...state.access,
      // Invite codes are never in the snapshot, but who was invited for what is the party side's business.
      invites: sight.party || canInCampaign({ ctx, perm: "member:invite" }) ? state.access.invites : [],
    },
  };
}

/**
 * The records an actor holds as one seat receives them (house decision #88): none where the seat does not see the
 * actor's values; whole for the seat holding it and the GM side; otherwise a kind with an unseen word shows that word
 * and the effects, never the entry's name, key or cite. A kind the ruleset no longer has is left out, and so is a record
 * of a kind without an unseen word whose list field the seat may not read (house decision #117: a creature shown in full
 * reaches every seat). `fields` is the actor's fields as the seat reads them.
 */
function seatHeld({
  held,
  compiled,
  seen,
  named,
  fields,
}: {
  held: readonly HeldRecord[];
  compiled: CompiledRuleset | null;
  seen: boolean;
  named: boolean;
  fields: Readonly<Record<string, unknown>>;
}): HeldRecord[] {
  if (!seen || compiled === null) return [];
  return held.flatMap((r) => {
    const kind = Object.hasOwn(compiled.ruleset.held ?? {}, r.kind) ? compiled.ruleset.held?.[r.kind] : undefined;
    if (kind === undefined) return [];
    if (kind.unseen !== undefined && !named)
      return [{ kind: r.kind, key: null, name: kind.unseen, cite: null, effects: r.effects }];
    if (!named && !Object.hasOwn(fields, kind.field)) return [];
    return [r];
  });
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
    // A recap's mentions are hidden like an entry body's (house decision #136).
    recaps:
      sight.secrets || sight.codex
        ? codex.recaps
        : codex.recaps.map((r) => ({ ...r, recap: hideMentions({ body: r.recap, canSee: (id) => ids.has(id) }) })),
    latestBegin: sight.secrets || sight.codex ? codex.latestBegin : null,
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
      // A scene's prepared lines and where it stands: the codex and secrets sides only (house decision #73).
      prep: sight.secrets || sight.codex ? e.prep : null,
      // The pack entry it was made from: the codex and secrets sides only (house decision #97).
      source: sight.secrets || sight.codex ? e.source : null,
      status: sight.secrets || sight.codex || e.kind !== "scene" ? e.status : null,
    })),
  };
}
