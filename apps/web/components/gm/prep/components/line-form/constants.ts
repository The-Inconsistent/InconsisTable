import {
  MAX_TEST_OUTCOMES,
  type CodexEntry,
  type LiveState,
  type PrepKind,
  type PrepLine,
} from "@inconsistable/core-schema";

import type { Spawnable } from "@/lib/scene-prep/scene-prep";

export const MAX_OUTCOMES = MAX_TEST_OUTCOMES;

// A line's id inside its scene's document. Not crypto.randomUUID: a LAN table is served over plain HTTP, where it is
// missing; uniqueness only matters within one scene.
export const lineId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** A new line of a kind, aimed at the first thing the room has for it (the GM changes it before saving). */
export function newLine({
  kind,
  state,
  entries,
  scene,
  spawnable,
}: {
  kind: PrepKind;
  state: Pick<LiveState, "testDefs" | "pools">;
  entries: readonly CodexEntry[];
  scene: CodexEntry;
  spawnable: Spawnable;
}): PrepLine {
  const id = lineId();
  switch (kind) {
    case "roster": {
      const first = spawnable.entries[0];
      return { id, pack: first?.pack ?? "", key: first?.key ?? "", count: 1, visibility: "hidden", temporary: true };
    }
    case "tests":
      return {
        id,
        testId: state.testDefs[0]?.id ?? "",
        inputs: {},
        takers: "party",
        actorIds: [],
        hideTarget: true,
        outcomes: [],
      };
    case "pools":
      return { id, pool: state.pools[0]?.id ?? "", amount: 1, text: "" };
    case "exits":
      return { id, label: "", sceneId: entries.find((e) => e.kind === "scene" && e.id !== scene.id)?.id ?? "" };
    default:
      return { id, entryId: "" };
  }
}
