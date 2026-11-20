import {
  MAX_SPAWN,
  type ActionInput,
  type Actor,
  type CodexEntry,
  type LiveState,
  type PoolLine,
  type PrepKind,
  type RevealLine,
  type RosterLine,
  type ScenePrep,
  type TestDef,
  type TestLine,
  type ExitLine,
  type PrepLine,
} from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { takers } from "@/components/gm/tests/components/call-form/takers";
import { JOIN_AS } from "@/components/gm/track/constants";
import {
  draftOf,
  missingInputs,
  testWords,
  toInputs,
  type InputDraft,
  type TestInput,
} from "@/lib/test-inputs/test-inputs";

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
export type Blocked = "noFight" | "count" | "mobCount" | "nobody" | "short";

export type Resolved =
  | { state: "broken"; missing: Missing }
  | { state: "blocked"; reason: Blocked }
  | { state: "ready"; action: ActionInput }
  | { state: "open"; sceneId: string }
  // A Test line that lacks inputs its Test asks for: the GM fills them in on the line, for that send only.
  | { state: "fill"; missing: TestInput[] }
  // A `pick` Test line before the GM has chosen who takes it: nothing is built until then (house decision #75).
  | { state: "pick"; takers: Actor[] };

type Line<K extends PrepKind> = ScenePrep[K][number];

/** The characters holding a seat (a member's or a guest's), the party a `party` Test line calls. */
export function seatedCharacters(state: PrepWorld["state"]): Actor[] {
  const held = new Set([
    ...state.access.members.flatMap((m) => m.characterIds),
    ...state.access.guests.map((g) => g.actorId),
  ]);
  return state.actors.filter((a) => held.has(a.id));
}

// The spawn a roster line stands for, fight or no fight: its creatures under the line's label, at its view (house
// decision #75); a mob stays one actor per action (house decision #66).
function rosterAction(line: RosterLine, world: PrepWorld): Resolved {
  const pack = world.spawnable.packs.find((p) => p.slug === line.pack);
  if (!pack) return { state: "broken", missing: "pack" };
  const known = world.spawnable.entries.some((e) => e.pack === line.pack && e.key === line.key);
  if (!known && world.spawnable.complete) return { state: "broken", missing: "entry" };
  if (line.mob !== undefined && line.count > 1) return { state: "blocked", reason: "mobCount" };
  if (line.count > MAX_SPAWN) return { state: "blocked", reason: "count" };
  const name = line.label?.trim();
  const action: ActionInput = {
    type: "actor.spawn",
    packVersionId: pack.id,
    key: line.key,
    count: line.count,
    temporary: line.temporary,
    visibility: line.visibility,
    ...(line.mob === undefined ? {} : { mob: line.mob }),
    ...(name ? { name } : {}),
  };
  return { state: "ready", action };
}

function resolveRoster(line: RosterLine, world: PrepWorld): Resolved {
  const r = rosterAction(line, world);
  if (r.state === "ready" && !world.state.encounter) return { state: "blocked", reason: "noFight" };
  return r;
}

/** The inputs a Test line leaves for the GM to fill in before sending it; none when its Test is gone. */
export function lineAsks({ line, world }: { line: TestLine; world: PrepWorld }): TestInput[] {
  const def = world.state.testDefs.find((d) => d.id === line.testId);
  return def ? missingInputs({ def, inputs: line.inputs }) : [];
}

function resolveTest(line: TestLine, world: PrepWorld, taker?: string, filled: InputDraft = {}): Resolved {
  const def: TestDef | undefined = world.state.testDefs.find((d) => d.id === line.testId);
  if (!def) return { state: "broken", missing: "test" };
  if (line.takers === "listed" && line.actorIds.some((id) => !world.state.actors.some((a) => a.id === id)))
    return { state: "broken", missing: "actor" };
  // What the GM filled in on the line counts for this send only; the call form's own reading decides what is filled.
  const inputs = toInputs({ def, draft: { ...draftOf(line.inputs), ...filled } });
  if (!inputs.ok) return { state: "fill", missing: missingInputs({ def, inputs: line.inputs }) };
  const seated = takers({ actors: seatedCharacters(world.state), def });
  // `pick`: the one seated character the GM chose when sending it; nothing is built until then.
  if (line.takers === "pick" && seated.length > 0 && !seated.some((a) => a.id === taker))
    return { state: "pick", takers: seated };
  const actorIds =
    line.takers === "listed"
      ? line.actorIds
      : seated.filter((a) => line.takers === "party" || a.id === taker).map((a) => a.id);
  if (actorIds.length === 0) return { state: "blocked", reason: "nobody" };
  const action: ActionInput = {
    type: "test.call",
    testId: line.testId,
    actorIds,
    inputs: inputs.inputs,
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

/**
 * What sending one line does now: the action it stands for, the scene it opens, or why it can't be sent. `taker` is
 * the seated character the GM picked for a `pick` Test line; `filled`, the inputs the GM filled in on a Test line.
 */
export function resolveLine<K extends PrepKind>({
  kind,
  line,
  world,
  taker,
  filled,
}: {
  kind: K;
  line: Line<K>;
  world: PrepWorld;
  taker?: string;
  filled?: InputDraft;
}): Resolved {
  switch (kind) {
    case "roster":
      return resolveRoster(line as RosterLine, world);
    case "tests":
      return resolveTest(line as TestLine, world, taker, filled);
    case "pools":
      return resolvePool(line as PoolLine, world);
    case "exits":
      return resolveExit(line as ExitLine, world);
    default:
      return resolveReveal(line as RevealLine, world);
  }
}

/** One action of START THE FIGHT, and the roster line it places, if it places one. */
export type FightStep = { action: ActionInput; line?: RosterLine };

/**
 * START THE FIGHT on a scene's roster (house decision #75): what the source app's one button does, as ordinary actions
 * the GM's screen sends one after another, each its own entry in the log and Undo. `encounter.start` when no fight is
 * running (with one running, everything joins it), the seated characters not yet in it as the tracker's ADD PARTY adds
 * them, then every roster line that can be sent. A line that can't is skipped, with why.
 */
export function fightSteps({ prep, world, sided }: { prep: ScenePrep; world: PrepWorld; sided: boolean }) {
  const steps: FightStep[] = [];
  const fight = world.state.encounter;
  if (!fight) steps.push({ action: { type: "encounter.start" } });
  const inFight = new Set(fight?.combatants.map((c) => c.actorId));
  const joining = seatedCharacters(world.state).filter((a) => !inFight.has(a.id) && a.status === "active");
  if (joining.length > 0) {
    // A sides order places each actor by its entity type: no side is sent (house decision #60).
    const join = sided ? { visibility: JOIN_AS.party.visibility } : JOIN_AS.party;
    steps.push({ action: { type: "encounter.add", actorIds: joining.map((a) => a.id), ...join } });
  }
  const skipped: { line: RosterLine; resolved: Resolved }[] = [];
  for (const line of prep.roster) {
    const resolved = rosterAction(line, world);
    if (resolved.state === "ready") steps.push({ action: resolved.action, line });
    else skipped.push({ line, resolved });
  }
  return { steps, skipped };
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
  test: (id: string) => TestDef | undefined;
};

/** The lookups behind LineNames, built once per render of a scene. */
export function lineNames({ state, entries, spawnable }: PrepWorld): LineNames {
  const creatures = new Map(spawnable.entries.map((e) => [`${e.pack}/${e.key}`, e.name]));
  const pools = new Map(state.pools.map((p) => [p.id, p.label]));
  const titles = new Map(entries.map((e) => [e.id, e.title]));
  const actors = new Map(state.actors.map((a) => [a.id, a.name]));
  const tests = new Map(state.testDefs.map((d) => [d.id, d]));
  return {
    creature: (pack, key) => creatures.get(`${pack}/${key}`),
    pool: (id) => pools.get(id),
    entry: (id) => titles.get(id),
    actor: (id) => actors.get(id),
    test: (id) => tests.get(id),
  };
}

/** The prep namespace's words a line's summary reads (next-intl's `t`, narrowed to the keys used here). */
export type SummaryWords = (key: `summary.${string}`, values?: Record<string, string | number>) => string;

/** What a line does, in the room's own names; a name the room no longer has falls back to the id the line keeps. */
export function lineSummary({
  kind,
  line,
  names,
  t,
}: {
  kind: PrepKind;
  line: PrepLine;
  names: LineNames;
  t: SummaryWords;
}): string {
  if (kind === "roster" && "pack" in line) {
    const name = names.creature(line.pack, line.key) ?? line.key;
    return line.mob === undefined
      ? t("summary.roster", { count: line.count, name })
      : t("summary.mob", { count: line.count, name, mob: line.mob });
  }
  if (kind === "tests" && "testId" in line) {
    // In the Test's words (house decision #77), each input in the order the Test declares them.
    const def = names.test(line.testId);
    const words = testWords(def ?? { id: line.testId });
    const order = def?.inputs.map((i) => i.id) ?? [];
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    const inputs = Object.entries(line.inputs)
      .sort(([a], [b]) => rank(a) - rank(b))
      // A mark (house decision #80) is kept only while on, and reads as its word.
      .map(([k, v]) => def?.marks?.find((m) => m.id === k)?.label ?? `${words.input(k)} ${words.value(k, v)}`)
      .join(", ");
    const who =
      line.takers === "listed"
        ? line.actorIds.map((id) => names.actor(id) ?? t("summary.gone")).join(", ")
        : t(`summary.${line.takers}`);
    return inputs === ""
      ? t("summary.test", { test: words.test, who })
      : t("summary.testWith", { test: words.test, inputs, who });
  }
  if (kind === "pools" && "pool" in line) {
    const pool = names.pool(line.pool) ?? line.pool;
    return [t("summary.pool", { pool, amount: line.amount }), line.text].filter(Boolean).join(" · ");
  }
  if (kind === "exits" && "sceneId" in line) return t("summary.exit", { scene: names.entry(line.sceneId) ?? "?" });
  if ("entryId" in line) return t("summary.reveal", { entry: names.entry(line.entryId) ?? "?" });
  return "";
}

/** What names a line on its send button and in "Sent: …": the GM's own label, else what the line does. */
export function lineName(args: { kind: PrepKind; line: PrepLine; names: LineNames; t: SummaryWords }): string {
  return args.line.label?.trim() || lineSummary(args);
}
