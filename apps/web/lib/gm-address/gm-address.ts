import { CodexKind } from "@inconsistable/core-schema";

import { FIGHT_TAB, GM_TABS, TAB_PARAM, type GmTab } from "../../components/gm/gm-app/constants.ts";
import { PREP_MODES, type PrepMode } from "../../components/gm/prep/constants.ts";
import { SCENE_LAYERS, type SceneLayer } from "../../components/gm/scene/constants.ts";

// The GM's address (house decision #111): the open tab and what is open inside it, kept in the query of `/c/<id>`.
// Only the keys of the open tab are written; every other parameter (`quick`, the admin marker) is kept as it came.
export type GmAddress = {
  tab: GmTab;
  /** CODEX: the kind listed. */
  kind?: CodexKind;
  /** CODEX: the entry open (its editor is the open entry). */
  entry?: string;
  /** PREP: the scene whose page is open. */
  scene?: string;
  /** PREP: how that page is looked at. */
  mode?: PrepMode;
  /** SCENE: the layer, scene or fight. */
  layer?: SceneLayer;
  /** SCENE: a previewed scene of the adventure. */
  preview?: string;
  /** TESTS: the Test preselected. */
  test?: string;
};
type InnerKey = Exclude<keyof GmAddress, "tab">;

// What a tab keeps in the query besides `tab`.
const INNER: Partial<Record<GmTab, readonly InnerKey[]>> = {
  scene: ["layer", "preview"],
  prep: ["scene", "mode"],
  codex: ["kind", "entry"],
  tests: ["test"],
};
const INNER_KEYS = new Set<string>(Object.values(INNER).flat());

// An id as the api issues it; anything else is dropped rather than carried into a lookup.
const ID = /^[\w-]{1,64}$/;
const asId = (v: string | null) => (v !== null && ID.test(v) ? v : undefined);
const asOne = <T extends string>(v: string | null, options: readonly T[]) => options.find((o) => o === v);

/** Reads the address from a query. An unknown tab is SCENE; an unknown or malformed inner value is dropped. */
export function parseGmAddress(params: { get(key: string): string | null }): GmAddress {
  const raw = params.get(TAB_PARAM);
  // The old ?tab=track opens SCENE on its FIGHT layer.
  if (raw === FIGHT_TAB) return { tab: "scene", layer: "fight" };
  const tab: GmTab = raw !== null && Object.hasOwn(GM_TABS, raw) ? (raw as GmTab) : "scene";
  const all: Omit<GmAddress, "tab"> = {
    kind: CodexKind.safeParse(params.get("kind")).data,
    entry: asId(params.get("entry")),
    scene: asId(params.get("scene")),
    mode: asOne(params.get("mode"), PREP_MODES),
    layer: asOne(params.get("layer"), SCENE_LAYERS),
    preview: asId(params.get("preview")),
    test: asId(params.get("test")),
  };
  const own = INNER[tab] ?? [];
  return { tab, ...Object.fromEntries(own.flatMap((k) => (all[k] === undefined ? [] : [[k, all[k]]]))) };
}

/** The query string (no `?`) for an address: `keep`'s other parameters first, then the tab and its inner keys. */
export function gmAddress(state: GmAddress, keep: Iterable<[string, string]> = []): string {
  const out = new URLSearchParams();
  for (const [k, v] of keep) if (k !== TAB_PARAM && !INNER_KEYS.has(k)) out.append(k, v);
  out.set(TAB_PARAM, state.tab);
  for (const k of INNER[state.tab] ?? []) {
    const v = state[k];
    if (v !== undefined) out.set(k, v);
  }
  return out.toString();
}
