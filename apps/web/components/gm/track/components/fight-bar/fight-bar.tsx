"use client";
import { useState } from "react";

import type { Encounter } from "@inconsistable/core-schema";

import type { Run } from "@/components/gm/track/constants";

type FightBarProps = { encounter: Encounter | null; sessionRunning: boolean; run: Run };

// The bar that stays under the thumb: the round, Prev and Next, and Undo (always, even between fights: it takes back the
// newest step of the session). Ending the fight asks twice, because temporary creatures go with it and that stays.
export function FightBar({ encounter, sessionRunning, run }: FightBarProps) {
  const [ending, setEnding] = useState(false);

  // END: the first tap asks, the second ends and clears the temporary creatures nobody marked Keep.
  const handleEnd = async () => {
    if (!ending) return setEnding(true);
    setEnding(false);
    await run({ type: "encounter.end" });
  };

  return (
    <div className="fightbar" role="toolbar" aria-label="Fight controls">
      {encounter ? (
        <>
          <span className="round">Round {encounter.round}</span>
          <button className="btn" onClick={() => run({ type: "turn.prev" })}>
            Prev
          </button>
          <button className="btn primary" onClick={() => run({ type: "turn.next" })} style={{ minWidth: 120 }}>
            Next turn
          </button>
        </>
      ) : (
        <>
          <span className="round">No fight</span>
          <button
            className="btn primary"
            disabled={!sessionRunning}
            onClick={() => run({ type: "encounter.start" })}
            title={sessionRunning ? undefined : "Start a session first"}
          >
            Start fight
          </button>
        </>
      )}
      <button className="btn" onClick={() => run({ type: "event.undo" })} disabled={!sessionRunning}>
        Undo
      </button>
      {encounter && (
        <button className="btn" onClick={handleEnd} onBlur={() => setEnding(false)}>
          {ending ? "End fight and clear temporary creatures" : "End fight"}
        </button>
      )}
    </div>
  );
}
