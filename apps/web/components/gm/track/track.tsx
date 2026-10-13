"use client";
import { useMemo, useState } from "react";

import type { ActionInput, LiveState } from "@inconsistable/core-schema";

import { Creatures } from "@/components/gm/creatures/creatures";
import { AddCombatants } from "@/components/gm/track/components/add-combatants/add-combatants";
import { CombatantPanel } from "@/components/gm/track/components/combatant-panel/combatant-panel";
import { FightBar } from "@/components/gm/track/components/fight-bar/fight-bar";
import { OrderList } from "@/components/gm/track/components/order-list/order-list";
import type { Send } from "@/hooks/use-table/use-table";
import { currentOf } from "@/lib/track/track";

type TrackProps = { state: LiveState; send: Send };

// TRACK: the fight from the GM's tablet. Initiative is typed from the dice (the app never rolls), the order and whose
// turn it is stay in view, and Undo is always under the thumb. Test calls live in their own tab.
export function Track({ state, send }: TrackProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const encounter = state.encounter;
  const actors = useMemo(() => new Map(state.actors.map((a) => [a.id, a])), [state.actors]);

  // RUN: sends one action, shows the api's refusal, and says whether it went through.
  const run = async (action: ActionInput) => {
    const r = await send(action);
    setError(r.ok ? null : r.error);
    return r.ok;
  };

  const selected =
    encounter?.combatants.find((c) => c.id === selectedId) ??
    (encounter ? (currentOf(encounter) ?? encounter.combatants[0]) : undefined);

  return (
    <>
      <FightBar encounter={encounter} sessionRunning={state.session !== null} run={run} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {encounter ? (
        <div className="track">
          <div className="stack">
            {encounter.combatants.length === 0 && (
              <p className="dim">Nobody is in the fight yet. Add the party below.</p>
            )}
            <OrderList
              encounter={encounter}
              actors={actors}
              selectedId={selected?.id}
              onSelect={setSelectedId}
              run={run}
            />
          </div>
          {selected && (
            <CombatantPanel
              key={selected.id}
              encounter={encounter}
              combatant={selected}
              actor={actors.get(selected.actorId)}
              run={run}
            />
          )}
        </div>
      ) : (
        <p className="dim">
          {state.session
            ? "No fight is running. Start one to add the party and the creatures."
            : "Start a session in the Party tab, then start a fight here."}
        </p>
      )}
      {encounter && <AddCombatants encounter={encounter} actors={state.actors} run={run} />}
      <Creatures campaignId={state.campaign.id} send={send} />
    </>
  );
}
