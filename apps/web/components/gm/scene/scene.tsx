"use client";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import {
  canInCampaign,
  type ActionInput,
  type BookSource,
  type Codex,
  type LiveState,
  type Me,
} from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { NoScene } from "@/components/gm/scene/components/no-scene/no-scene";
import { PlayScene } from "@/components/gm/scene/components/play-scene/play-scene";
import { SCENE_LAYERS, type SceneLayer } from "@/components/gm/scene/constants";
import { Track } from "@/components/gm/track/track";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import type { RulesEntry } from "@/lib/library/library";
import { nextUp, scenePlay } from "@/lib/scene-play/scene-play";
import { lineNames, prepWorld, type Spawnable } from "@/lib/scene-prep/scene-prep";

type SceneProps = {
  me: Me;
  state: LiveState;
  codex: Codex | null;
  send: Send;
  ruleset: Ruleset | null;
  /** The attached packs' creatures, to place a prepared fight; null when they could not be read. */
  spawnable: Spawnable | null;
  /** The pack entries this seat read, to name a ref. */
  known: readonly RulesEntry[];
  /** What a character sheet needs, for the fight layer. */
  sheet: { ruleset: Ruleset | null; books: readonly BookSource[]; requestPage: RequestPage };
  /** `?tab=track`: opens on the fight layer. */
  initialFight: boolean;
  /** A name opens the entry in Codex. */
  onOpenCodex: (entryId: string) => void;
};

// SCENE: the GM's first tab (issue #216). The scene being played as a page, run with the actions the Prep run view
// sends; with none playing, each adventure's next scene to begin. The tracker is its second layer, FIGHT.
export function Scene({
  me,
  state,
  codex,
  send,
  ruleset,
  spawnable,
  known,
  sheet,
  initialFight,
  onOpenCodex,
}: SceneProps) {
  const t = useTranslations("scene");
  const canFight = canInCampaign({ ctx: me, perm: "encounter:run" });
  // A live fight opens the tab on FIGHT; otherwise on the scene.
  const [layer, setLayer] = useState<SceneLayer>(canFight && (initialFight || state.encounter) ? "fight" : "scene");
  const [error, setError] = useState<string | null>(null);
  const [beginning, setBeginning] = useState(false);
  const entries = useMemo(() => codex?.entries ?? [], [codex]);
  const play = useMemo(() => scenePlay(entries), [entries]);
  const offers = useMemo(() => nextUp(entries), [entries]);
  const world = useMemo(() => prepWorld({ state, entries, spawnable, ruleset }), [state, entries, spawnable, ruleset]);
  const names = useMemo(() => lineNames(world), [world]);

  // Sends an action and shows its refusal, if any.
  const act = async (a: ActionInput) => {
    const r = await send(a);
    setError(r.ok ? null : r.error);
    return r;
  };

  // BEGIN on a card: `scene.begin`; the begun scene is then the one played, and the page shows it.
  const handleBegin = async (sceneId: string) => {
    setBeginning(true);
    await act({ type: "scene.begin", sceneId });
    setBeginning(false);
  };

  const layers = SCENE_LAYERS.filter((l) => l === "scene" || canFight);
  return (
    <div className="stack" style={{ gap: 16 }}>
      {layers.length > 1 && (
        <div className="row" role="group" aria-label={t("layers.label")}>
          {layers.map((l) => (
            <button key={l} className="btn" aria-pressed={layer === l} onClick={() => setLayer(l)}>
              {t(`layers.${l}`)}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {layer === "fight" && canFight ? (
        <Track me={me} state={state} send={send} sheet={sheet} entries={entries} />
      ) : play.playing ? (
        <PlayScene
          me={me}
          play={play}
          scene={play.playing}
          entries={entries}
          world={world}
          names={names}
          ruleset={ruleset}
          known={known}
          act={act}
          latestBegin={codex?.latestBegin ?? null}
          onOpenCodex={onOpenCodex}
        />
      ) : (
        <NoScene
          offers={offers}
          canFight={canFight}
          busy={beginning}
          onBegin={(scene) => handleBegin(scene.id)}
          onFight={() => setLayer("fight")}
        />
      )}
    </div>
  );
}
