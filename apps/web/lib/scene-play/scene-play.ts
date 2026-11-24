import type { CodexEntry, CodexKind, LatestBegin } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { shownFields, type ShownField } from "@/lib/entry-fields/entry-fields";
import { groupLinks, prepTree } from "@/lib/prep/prep";

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
