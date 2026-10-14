"use client";
import { useMemo, useState } from "react";

import type { ActionInput, BookSource, LiveState } from "@inconsistable/core-schema";

import type { Ruleset } from "@inconsistable/rules-engine";

import { Creatures } from "@/components/gm/creatures/creatures";
import { AddCombatants } from "@/components/gm/track/components/add-combatants/add-combatants";
import { CombatantPanel } from "@/components/gm/track/components/combatant-panel/combatant-panel";
import { FightBar } from "@/components/gm/track/components/fight-bar/fight-bar";
import { OrderList } from "@/components/gm/track/components/order-list/order-list";
import { CallForm } from "@/components/gm/tests/components/call-form/call-form";
import { SheetView } from "@/components/sheet/sheet-view/sheet-view";
import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import { currentOf } from "@/lib/track/track";

type TrackProps = {
  state: LiveState;
  send: Send;
  /** What a character sheet needs: the ruleset as the GM reads it, the served books and the page relay. */
  sheet: { ruleset: Ruleset | null; books: readonly BookSource[]; requestPage: RequestPage };
};

// TRACK: the fight from the GM's tablet. Initiative is typed from the dice (the app never rolls), the order and whose
// turn it is stay in view, and Undo is always under the thumb. Test calls live in their own tab.
export function Track({ state, send, sheet }: TrackProps) {
  const [sheetOf, setSheetOf] = useState<string | null>(null);
  const [testFor, setTestFor] = useState<string | null>(null); // the actor a Test is being called for
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

  const sheetActor = sheetOf ? actors.get(sheetOf) : undefined;
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
      {encounter?.paused && (
        <p className="dim" role="status">
          Paused — start a session to continue
        </p>
      )}
      {encounter ? (
        <fieldset disabled={encounter.paused} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
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
                onSheet={sheet.ruleset ? setSheetOf : undefined}
                onCallTest={state.testDefs.length > 0 ? setTestFor : undefined}
              />
            )}
          </div>
          {encounter && <AddCombatants encounter={encounter} actors={state.actors} run={run} />}
        </fieldset>
      ) : (
        <p className="dim">
          {state.session
            ? "No fight is running. Start one to add the party and the creatures."
            : "Start a session in the Party tab, then start a fight here."}
        </p>
      )}
      {sheet.ruleset && sheetActor && (
        <BottomSheet title={`Sheet of ${sheetActor.name}`} onClose={() => setSheetOf(null)}>
          <SheetView
            key={sheetActor.id}
            actor={sheetActor}
            ruleset={sheet.ruleset}
            characters={state.actors.filter((x) => x.kind === "pc").length}
            gm
            send={send}
            books={sheet.books}
            requestPage={sheet.requestPage}
          />
        </BottomSheet>
      )}
      {testFor && (
        <BottomSheet
          title={`Call a Test for ${actors.get(testFor)?.name ?? "a character"}`}
          onClose={() => setTestFor(null)}
        >
          <CallForm
            key={testFor}
            state={state}
            send={send}
            initialTargets={[testFor]}
            onCalled={() => setTestFor(null)}
          />
        </BottomSheet>
      )}
      <Creatures campaignId={state.campaign.id} send={send} />
    </>
  );
}
