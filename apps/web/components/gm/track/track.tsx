"use client";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import {
  canInCampaign,
  gmPermOf,
  type ActionInput,
  type BookSource,
  type LiveState,
  type Me,
} from "@inconsistable/core-schema";

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
  me: Me;
  state: LiveState;
  send: Send;
  /** What a character sheet needs: the ruleset as the GM reads it, the served books and the page relay. */
  sheet: { ruleset: Ruleset | null; books: readonly BookSource[]; requestPage: RequestPage };
};

// TRACK: the fight from the GM's tablet. Initiative is typed from the dice (the app never rolls), the order and whose
// turn it is stay in view, and Undo is always under the thumb. Test calls live in their own tab.
export function Track({ me, state, send, sheet }: TrackProps) {
  const t = useTranslations("track");
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
          {t("paused")}
        </p>
      )}
      {encounter ? (
        <fieldset disabled={encounter.paused} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <div className="track">
            <div className="stack">
              {encounter.combatants.length === 0 && <p className="dim">{t("nobody")}</p>}
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
        <p className="dim">{state.session ? t("noFight") : t("startSession")}</p>
      )}
      {sheet.ruleset && sheetActor && (
        <BottomSheet title={t("sheetOf", { name: sheetActor.name })} onClose={() => setSheetOf(null)}>
          <SheetView
            key={sheetActor.id}
            actor={sheetActor}
            ruleset={sheet.ruleset}
            characters={state.actors.filter((x) => x.kind === "pc").length}
            gm={canInCampaign({ ctx: me, perm: gmPermOf(sheetActor.kind) })}
            send={send}
            books={sheet.books}
            requestPage={sheet.requestPage}
          />
        </BottomSheet>
      )}
      {testFor && (
        <BottomSheet
          title={t("callTestFor", { name: actors.get(testFor)?.name ?? t("aCharacter") })}
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
