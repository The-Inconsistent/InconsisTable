"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Encounter } from "@inconsistable/core-schema";
import type { SidesInitiative } from "@inconsistable/rules-engine";

import { SidesControls } from "@/components/gm/track/components/sides-controls/sides-controls";
import type { Run, TrackMode } from "@/components/gm/track/constants";

type FightBarProps = {
  encounter: Encounter | null;
  sessionRunning: boolean;
  run: Run;
  mode: TrackMode;
  /** The pinned ruleset's sides order, when it has one: the turn buttons follow it. */
  sides?: SidesInitiative;
};

// The bar that stays under the thumb: the round, Prev and Next, and Undo (always, even between fights: it takes back the
// newest step of the session). Ending the fight asks twice, because temporary creatures go with it and that stays.
export function FightBar({ encounter, sessionRunning, run, mode, sides }: FightBarProps) {
  const t = useTranslations("fightBar");
  const [ending, setEnding] = useState(false);
  const [endingGame, setEndingGame] = useState(false);

  // END: the first tap asks, the second ends and clears the temporary creatures nobody marked Keep.
  const handleEnd = async () => {
    if (!ending) return setEnding(true);
    setEnding(false);
    await run({ type: "encounter.end" });
  };

  // END GAME: the first tap asks (it cannot be undone), the second scores everyone, saves the results and ends the fight.
  const handleEndGame = async () => {
    if (!endingGame) return setEndingGame(true);
    setEndingGame(false);
    await run({ type: "game.end" });
  };

  return (
    <div className="fightbar" role="toolbar" aria-label={t("label", { mode })}>
      {encounter ? (
        <>
          <span key={encounter.round} className="round">
            {/* A sides fight that has not begun is still being set up: there is no round yet. */}
            {encounter.begun === false ? t("setup") : t("round", { round: encounter.round })}
          </span>
          {sides ? (
            <SidesControls encounter={encounter} run={run} />
          ) : (
            <>
              <button className="btn" disabled={encounter.paused} onClick={() => run({ type: "turn.prev" })}>
                {t("prev")}
              </button>
              <button
                className="btn primary"
                disabled={encounter.paused}
                onClick={() => run({ type: "turn.next" })}
                style={{ minWidth: 120 }}
              >
                {t("next")}
              </button>
            </>
          )}
        </>
      ) : (
        <>
          <span className="round">{t("noFight", { mode })}</span>
          <button
            className="btn primary"
            disabled={!sessionRunning}
            onClick={() => run({ type: "encounter.start" })}
            title={sessionRunning ? undefined : t("startSessionFirst")}
          >
            {t("start", { mode })}
          </button>
        </>
      )}
      <button className="btn" onClick={() => run({ type: "event.undo" })} disabled={!sessionRunning}>
        {t("undo")}
      </button>
      {encounter?.scoring && (
        <button
          className="btn"
          data-attention={encounter.endMet.length > 0}
          disabled={encounter.paused}
          onClick={handleEndGame}
          onBlur={() => setEndingGame(false)}
        >
          {endingGame ? t("endGameConfirm") : t("endGame")}
        </button>
      )}
      {encounter && (
        <button className="btn" disabled={encounter.paused} onClick={handleEnd} onBlur={() => setEnding(false)}>
          {ending ? t("endConfirm", { mode }) : t("end", { mode })}
        </button>
      )}
    </div>
  );
}
