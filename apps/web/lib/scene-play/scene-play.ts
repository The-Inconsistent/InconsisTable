import { splitMentions, type CodexEntry, type CodexKind, type LatestBegin } from "@inconsistable/core-schema";
import { checkFieldValue, type Ruleset } from "@inconsistable/rules-engine";

import { declaredFields, shownFields, type ShownField } from "@/lib/entry-fields/entry-fields";
import { groupLinks, prepTree } from "@/lib/prep/prep";
import { EMPTY_PREP, resolveLine, type PrepWorld } from "@/lib/scene-prep/scene-prep";

// The scene being played, as a page (issue #216): what the SCENE tab draws, worked out from the entries the GM's seat
// already holds. Nothing here sends anything.

const PLAYED = ["done", "skipped"];

/** The scene being played (status active), its adventure, and that adventure's scenes in order with what each has become. */
export function scenePlay(entries: readonly CodexEntry[]) {
  const tree = prepTree(entries);
  const playing = entries.find((e) => e.kind === "scene" && e.status === "active") ?? null;
  const group = playing && tree.adventures.find((a) => a.scenes.some((s) => s.id === playing.id));
  return {
    playing,
    adventure: group?.adventure ?? null,
    strip: (group?.scenes ?? []).map((scene) => ({
      scene,
      played: scene.status !== null && PLAYED.includes(scene.status),
      playing: scene.id === playing?.id,
    })),
  };
}

export type PlayStrip = ReturnType<typeof scenePlay>["strip"];

/** A scene's number in its adventure (from 1), or null for a scene outside the strip. */
export const sceneNumber = ({ strip, id }: { strip: PlayStrip; id: string }) => {
  const at = strip.findIndex((s) => s.scene.id === id);
  return at < 0 ? null : at + 1;
};

/**
 * What can be begun with nothing running: each adventure's first scene still planned (or with no status), a running
 * adventure (one with a scene already done or skipped) before the rest, each group in adventure order. A scene with no
 * adventure is not offered.
 */
export function nextUp(entries: readonly CodexEntry[]) {
  const offers = prepTree(entries).adventures.flatMap(({ adventure, scenes }) => {
    const scene = scenes.find((s) => s.status === null || s.status === "planned");
    const running = scenes.some((s) => s.status !== null && PLAYED.includes(s.status));
    return scene ? [{ adventure, scene, running }] : [];
  });
  return [...offers.filter((o) => o.running), ...offers.filter((o) => !o.running)];
}

/** A scene's links by kind; `shown` is true once the entry is visible to the party or the public, to any audience. */
export function sceneCast({ scene, entries }: { scene: CodexEntry; entries: readonly CodexEntry[] }) {
  return groupLinks({ entry: scene, entries }).map(({ kind, entries: linked }) => ({
    kind: kind as CodexKind,
    entries: linked.map((entry) => ({ entry, shown: entry.visibility !== "gm" })),
  }));
}

/** An entry's shown fields split by what the ruleset declares: a `gm` field is closed, the rest read aloud or open. */
export function pageFields({ ruleset, entry }: { ruleset: Ruleset | null; entry: CodexEntry }) {
  const shown = shownFields({ ruleset, entry });
  const closed = (f: ShownField) => f.def.visibility === "gm";
  return { open: shown.filter((f) => !closed(f)), closed: shown.filter(closed) };
}

/** The room's latest begin and its scene while that scene is still the one played; null otherwise (TAKE BACK's guard). */
export function beginTakenBack({ begin, entries }: { begin: LatestBegin | null; entries: readonly CodexEntry[] }) {
  const scene = begin && entries.find((e) => e.id === begin.sceneId && e.status === "active");
  return begin && scene ? { begin, scene } : null;
}

/** The longest tagline a board card shows. */
export const TAGLINE_MAX = 90;

/**
 * A scene's one line on the board: the first open (not `gm`) text field it holds, else the first line of its body with
 * mentions read as their titles, cut to TAGLINE_MAX.
 */
export function sceneTagline({ ruleset, scene }: { ruleset: Ruleset | null; scene: CodexEntry }): string {
  const open = shownFields({ ruleset, entry: scene }).find(
    (f) => f.def.type === "text" && f.def.visibility !== "gm" && typeof f.value === "string",
  );
  const body = splitMentions(scene.body)
    .map((p) => ("text" in p ? p.text : p.title))
    .join("");
  const text = (typeof open?.value === "string" ? open.value : body).trim().split("\n")[0] ?? "";
  return text.length > TAGLINE_MAX ? `${text.slice(0, TAGLINE_MAX - 1).trimEnd()}…` : text;
}

/** What a scene needs before it is ready for the table (house decision #107): a field to fill, or an exit to wire. */
export type Fix = { kind: "field"; fieldId: string; label: string } | { kind: "exit"; lineId: string; label: string };

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

/**
 * The fixes a scene has: each field its kind's `ready` names that is empty or no longer fits its declaration, then each
 * exit line naming a scene the GM's entries do not hold. A ruleset with no `ready` for scenes has only exit fixes; none
 * at all means ready. A seat without `secrets` is never sent a `gm` field's value, so such a field is not counted.
 */
export function sceneFixes({
  ruleset,
  scene,
  entries,
  secrets = true,
}: {
  ruleset: Ruleset | null;
  scene: CodexEntry;
  entries: readonly CodexEntry[];
  secrets?: boolean;
}): Fix[] {
  const needed = new Set(ruleset?.codex?.kinds.scene?.ready ?? []);
  const fields = declaredFields({ ruleset, kind: "scene" })
    .filter(({ id, def }) => needed.has(id) && (secrets || def.visibility !== "gm"))
    .flatMap(({ id, def }): Fix[] => {
      const value = Object.hasOwn(scene.fields, id) ? scene.fields[id] : undefined;
      return isEmpty(value) || checkFieldValue({ def, value }) !== null
        ? [{ kind: "field", fieldId: id, label: def.label }]
        : [];
    });
  const scenes = new Set(entries.filter((e) => e.kind === "scene").map((e) => e.id));
  const exits = (scene.prep ?? EMPTY_PREP).exits.flatMap((l): Fix[] =>
    scenes.has(l.sceneId) ? [] : [{ kind: "exit", lineId: l.id, label: l.label }],
  );
  return [...fields, ...exits];
}

/** What a scene holds, counted for the board's glance; `shownOnEntry` are the entries its reveal lines name. */
export function sceneGlance({ scene, entries }: { scene: CodexEntry; entries: readonly CodexEntry[] }) {
  const prep = scene.prep ?? EMPTY_PREP;
  const byKind = groupLinks({ entry: scene, entries }).map((g) => ({ kind: g.kind, count: g.entries.length }));
  const count = (kind: CodexKind) => byKind.find((g) => g.kind === kind)?.count ?? 0;
  const byId = new Map(entries.map((e) => [e.id, e]));
  return {
    byKind,
    handouts: count("handout"),
    items: count("item"),
    tests: prep.tests.length,
    combatants: prep.roster.reduce((sum, l) => sum + l.count, 0),
    exits: prep.exits.length,
    shownOnEntry: prep.reveals.flatMap((l) => byId.get(l.entryId) ?? []),
  };
}

/**
 * The missions of a scene (issue #216): the quests linked to the scene, with its status and the actors it is listed to
 * (an empty list: the whole table reads it). Only a scene links, so a mission is a scene's (house decision #108).
 */
export function sceneMissions({ scene, entries }: { scene: CodexEntry; entries: readonly CodexEntry[] }) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return scene.links.flatMap((id) => {
    const quest = byId.get(id);
    return quest?.kind === "quest"
      ? [{ quest, status: quest.status, audience: quest.audienceMode === "listed" ? quest.audience : [] }]
      : [];
  });
}

/**
 * The pool lines of the scene being played that name one pool, each resolved against the room. The header's pool pad
 * draws them (issue #217); nothing is sent from here.
 */
export function scenePoolLines({
  entries,
  pool,
  world,
}: {
  entries: readonly CodexEntry[];
  pool: string;
  world: PrepWorld;
}) {
  const playing = scenePlay(entries).playing;
  return (playing?.prep ?? EMPTY_PREP).pools
    .filter((line) => line.pool === pool)
    .map((line) => ({ line, resolved: resolveLine({ kind: "pools", line, world }) }));
}
