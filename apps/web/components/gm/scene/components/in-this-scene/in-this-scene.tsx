"use client";
import { useTranslations } from "next-intl";

import type { ActionInput, CodexEntry } from "@inconsistable/core-schema";

import { ItemGive } from "@/components/gm/codex/components/item-give/item-give";
import { FightButton } from "@/components/gm/prep/components/scene-run/components/fight-button/fight-button";
import { RevealSwitch } from "@/components/ui/reveal-switch/reveal-switch";
import type { LineSender } from "@/hooks/use-line-sender/use-line-sender";
import type { PrepWorld } from "@/lib/scene-prep/scene-prep";
import { sceneCast } from "@/lib/scene-play/scene-play";

type InThisSceneProps = {
  scene: CodexEntry;
  entries: readonly CodexEntry[];
  world: PrepWorld;
  sender: LineSender;
  act: (a: ActionInput) => Promise<{ ok: boolean }>;
  /** The seat holds `codex:reveal`: the SHOW / SEAL switch is drawn only then. */
  canReveal: boolean;
  /** The seat can give items (`codex:write`) and the ruleset allows it. */
  canGive: boolean;
  /** A name opens the entry in Codex (the peek is the codex layer's, P105). */
  onOpenEntry: (entryId: string) => void;
  /** A preview shows the cast as names only. */
  readOnly?: boolean;
};

// IN THIS SCENE: everything the scene links, by kind, each with a one-tap SHOW / SEAL switch, GIVE on an item, then the
// prepared fight with START THE FIGHT.
export function InThisScene({
  scene,
  entries,
  world,
  sender,
  act,
  canReveal,
  canGive,
  onOpenEntry,
  readOnly = false,
}: InThisSceneProps) {
  const t = useTranslations("scene.inScene");
  const tCodex = useTranslations("codex");
  const cast = sceneCast({ scene, entries });
  const characters = world.state.actors.filter((a) => a.kind === "pc");
  const creatures = sender.prep.roster.reduce((sum, l) => sum + l.count, 0);
  return (
    <aside className="card stack scene-side" aria-label={t("title")} style={{ minWidth: 0 }}>
      <h2 className="head">{t("title")}</h2>
      {cast.length === 0 && <p className="dim">{t("empty")}</p>}
      {cast.map(({ kind, entries: linked }) => (
        <section key={kind} className="stack" data-kind={kind}>
          <h3 className="w-label">{tCodex(`kind.${kind}`)}</h3>
          <ul className="list">
            {linked.map(({ entry }) => (
              <li key={entry.id} className="stack" style={{ gap: 6 }}>
                <span className="row between" style={{ flexWrap: "wrap" }}>
                  <button
                    className="btn"
                    aria-label={t("open", { name: entry.title })}
                    onClick={() => onOpenEntry(entry.id)}
                    style={{ textAlign: "left", overflowWrap: "anywhere" }}
                  >
                    {entry.title}
                  </button>
                  {canReveal && !readOnly && <RevealSwitch entry={entry} act={act} />}
                </span>
                {kind === "item" && canGive && !readOnly && (
                  <ItemGive entry={entry} characters={characters} act={act} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="stack" data-kind="roster">
        <h3 className="w-label">{t("fight")}</h3>
        <p>{t("creatures", { count: creatures })}</p>
        {creatures > 0 && !readOnly && <FightButton sender={sender} world={world} />}
      </section>
    </aside>
  );
}
