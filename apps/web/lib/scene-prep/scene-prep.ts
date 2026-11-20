import type {
  ActionInput,
  Actor,
  CodexEntry,
  LiveState,
  PoolLine,
  PrepKind,
  RevealLine,
  RosterLine,
  ScenePrep,
  TestDef,
  TestLine,
  ExitLine,
} from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { takers } from "@/components/gm/tests/components/call-form/takers";
import { MAX_SPAWN } from "@/lib/creatures/creatures";

// A scene's prepared lines on the GM's screen (house decision #73): what each line stands for, whether it can be sent,
// and which kinds a scene offers. Sending a line is the action it stands for, built here and sent through the same path
// as a hand-made one; nothing here runs by itself.

/** The groups in the order the scene screens show them: shown on entry, Tests, pools, the fight, then where next. */
export const PREP_ORDER = ["reveals", "tests", "pools", "roster", "exits"] as const satisfies readonly PrepKind[];

export const EMPTY_PREP: ScenePrep = { roster: [], tests: [], pools: [], exits: [], reveals: [] };

/** The attached packs' spawnable entries the GM's page read, by pack slug and key; `complete` when none was cut off. */
export type Spawnable = {
  packs: { slug: string; id: string }[];
  entries: { pack: string; key: string; type: string; name: string }[];
  complete: boolean;
};

/** What a line is resolved against: everything the GM's device already holds. */
export type PrepWorld = {
  state: Pick<LiveState, "testDefs" | "pools" | "actors" | "encounter" | "access">;
  entries: readonly CodexEntry[];
  spawnable: Spawnable;
};

/** What a line names that the room no longer has. */
export type Missing = "pack" | "entry" | "test" | "actor" | "pool" | "scene";
/** Why a whole line cannot be sent right now (it is not broken). */
export type Blocked = "noFight" | "visibility" | "count" | "mobCount" | "nobody" | "short";

export type Resolved =
  | { state: "broken"; missing: Missing }
  | { state: "blocked"; reason: Blocked }
  | { state: "ready"; action: ActionInput }
  | { state: "open"; sceneId: string };

type Line<K extends PrepKind> = ScenePrep[K][number];

/** The characters holding a seat (a member's or a guest's), the party a `party` Test line calls. */
export function seatedCharacters(state: PrepWorld["state"]): Actor[] {
  const held = new Set([
    ...state.access.members.flatMap((m) => m.characterIds),
    ...state.access.guests.map((g) => g.actorId),
  ]);
  return state.actors.filter((a) => held.has(a.id));
}

function resolveRoster(line: RosterLine, world: PrepWorld): Resolved {
  const pack = world.spawnable.packs.find((p) => p.slug === line.pack);
  if (!pack) return { state: "broken", missing: "pack" };
  const known = world.spawnable.entries.some((e) => e.pack === line.pack && e.key === line.key);
  if (!known && world.spawnable.complete) return { state: "broken", missing: "entry" };
  // actor.spawn places creatures hidden, at most 20 of them, and a mob as one actor (house decision #66).
  if (line.visibility !== "hidden") return { state: "blocked", reason: "visibility" };
  if (line.mob !== undefined && line.count > 1) return { state: "blocked", reason: "mobCount" };
  if (line.count > MAX_SPAWN) return { state: "blocked", reason: "count" };
  if (!world.state.encounter) return { state: "blocked", reason: "noFight" };
  const action: ActionInput = {
    type: "actor.spawn",
    packVersionId: pack.id,
    key: line.key,
    count: line.count,
    temporary: line.temporary,
    ...(line.mob === undefined ? {} : { mob: line.mob }),
  };
  return { state: "ready", action };
}

function resolveTest(line: TestLine, world: PrepWorld): Resolved {
  const def: TestDef | undefined = world.state.testDefs.find((d) => d.id === line.testId);
  if (!def) return { state: "broken", missing: "test" };
  const actorIds =
    line.takers === "party" ? takers({ actors: seatedCharacters(world.state), def }).map((a) => a.id) : line.actorIds;
  if (line.takers === "listed" && actorIds.some((id) => !world.state.actors.some((a) => a.id === id)))
    return { state: "broken", missing: "actor" };
  if (actorIds.length === 0) return { state: "blocked", reason: "nobody" };
  const action: ActionInput = {
    type: "test.call",
    testId: line.testId,
    actorIds,
    inputs: line.inputs,
    // A reported Test has no number to hide.
    hideTarget: !def.outcomes && line.hideTarget,
    showOutcome: false,
  };
  return { state: "ready", action };
}

function resolvePool(line: PoolLine, world: PrepWorld): Resolved {
  const pool = world.state.pools.find((p) => p.id === line.pool);
  if (!pool) return { state: "broken", missing: "pool" };
  // A spend the pool cannot pay is held back: the server would stop at the minimum and charge less.
  if (line.amount < 0 && pool.value + line.amount < pool.min) return { state: "blocked", reason: "short" };
  const action: ActionInput = {
    type: "rule.op",
    primitive: "resource.capped",
    op: "adjustPool",
    input: { resource: line.pool, delta: line.amount },
  };
  return { state: "ready", action };
}

function resolveExit(line: ExitLine, world: PrepWorld): Resolved {
  const found = world.entries.some((e) => e.id === line.sceneId && e.kind === "scene");
  return found ? { state: "open", sceneId: line.sceneId } : { state: "broken", missing: "scene" };
}

function resolveReveal(line: RevealLine, world: PrepWorld): Resolved {
  if (!world.entries.some((e) => e.id === line.entryId)) return { state: "broken", missing: "entry" };
  const action: ActionInput = {
    type: "codex.reveal",
    id: line.entryId,
    visibility: "party",
    audienceMode: "all",
    audience: [],
  };
  return { state: "ready", action };
}

/** What sending one line does now: the action it stands for, the scene it opens, or why it can't be sent. */
export function resolveLine<K extends PrepKind>({
  kind,
  line,
  world,
}: {
  kind: K;
  line: Line<K>;
  world: PrepWorld;
}): Resolved {
  switch (kind) {
    case "roster":
      return resolveRoster(line as RosterLine, world);
    case "tests":
      return resolveTest(line as TestLine, world);
    case "pools":
      return resolvePool(line as PoolLine, world);
    case "exits":
      return resolveExit(line as ExitLine, world);
    default:
      return resolveReveal(line as RevealLine, world);
  }
}

/**
 * The kinds of line a scene offers to add (ADR 0012 decision 3): creatures only when an attached pack has some to place,
 * Tests and pools only when the ruleset declares them; exits and reveals always. Lines already there stay, offered or not.
 */
export function offeredKinds({ ruleset, spawnable }: { ruleset: Ruleset | null; spawnable: Spawnable }): PrepKind[] {
  const has: Record<PrepKind, boolean> = {
    reveals: true,
    tests: ruleset !== null && Object.keys(ruleset.tests).length > 0,
    pools: ruleset?.resources.some((r) => r.scope === "party" || r.scope === "gm" || r.scope === "campaign") ?? false,
    roster: ruleset !== null && spawnable.entries.length > 0,
    exits: true,
  };
  return PREP_ORDER.filter((k) => has[k]);
}

/** The document with one line put in place of the line of the same id, or added last. */
export function withLine<K extends PrepKind>({ prep, kind, line }: { prep: ScenePrep; kind: K; line: Line<K> }) {
  const list = prep[kind] as Line<K>[];
  const at = list.findIndex((l) => l.id === line.id);
  const next = at < 0 ? [...list, line] : list.map((l, i) => (i === at ? line : l));
  return { ...prep, [kind]: next } as ScenePrep;
}

/** The document without one line. */
export function withoutLine({ prep, kind, id }: { prep: ScenePrep; kind: PrepKind; id: string }): ScenePrep {
  return { ...prep, [kind]: (prep[kind] as { id: string }[]).filter((l) => l.id !== id) } as ScenePrep;
}

/** The document with one line moved a step within its kind; unchanged at either end. */
export function stepLine({ prep, kind, id, step }: { prep: ScenePrep; kind: PrepKind; id: string; step: -1 | 1 }) {
  const list = [...(prep[kind] as { id: string }[])];
  const at = list.findIndex((l) => l.id === id);
  const to = at + step;
  if (at < 0 || to < 0 || to >= list.length) return prep;
  [list[at], list[to]] = [list[to]!, list[at]!];
  return { ...prep, [kind]: list } as ScenePrep;
}

/** The names a line's summary reads: the room's own, or undefined for what it no longer has. */
export type LineNames = {
  creature: (pack: string, key: string) => string | undefined;
  pool: (id: string) => string | undefined;
  entry: (id: string) => string | undefined;
  actor: (id: string) => string | undefined;
};

/** The lookups behind LineNames, built once per render of a scene. */
export function lineNames({ state, entries, spawnable }: PrepWorld): LineNames {
  const creatures = new Map(spawnable.entries.map((e) => [`${e.pack}/${e.key}`, e.name]));
  const pools = new Map(state.pools.map((p) => [p.id, p.label]));
  const titles = new Map(entries.map((e) => [e.id, e.title]));
  const actors = new Map(state.actors.map((a) => [a.id, a.name]));
  return {
    creature: (pack, key) => creatures.get(`${pack}/${key}`),
    pool: (id) => pools.get(id),
    entry: (id) => titles.get(id),
    actor: (id) => actors.get(id),
  };
}
