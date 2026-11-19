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
import { ClocksPanel } from "@/components/gm/track/components/clocks-panel/clocks-panel";
import { PoolsPanel } from "@/components/gm/track/components/pools-panel/pools-panel";
import { CombatantPanel } from "@/components/gm/track/components/combatant-panel/combatant-panel";
import { FightBar } from "@/components/gm/track/components/fight-bar/fight-bar";
import { SidesOrder } from "@/components/gm/track/components/sides-order/sides-order";
import { TablesPanel } from "@/components/gm/track/components/tables-panel/tables-panel";
import { PhaseBar } from "@/components/gm/track/components/phase-bar/phase-bar";
import { OrderList } from "@/components/gm/track/components/order-list/order-list";
import { CallForm } from "@/components/gm/tests/components/call-form/call-form";
import { SheetView } from "@/components/sheet/sheet-view/sheet-view";
import { EndNotice } from "@/components/ui/end-notice/end-notice";
import { GameResult } from "@/components/ui/game-result/game-result";
import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import { currentOf } from "@/lib/track/track";
import type { TrackMode } from "@/components/gm/track/constants";

type TrackProps = {
  me: Me;
  state: LiveState;
  send: Send;
  /** What a character sheet needs: the ruleset as the GM reads it, the served books and the page relay. */
  sheet: { ruleset: Ruleset | null; books: readonly BookSource[]; requestPage: RequestPage };
  /** The codex entries a clock can be about (the ones this seat reads). */
  entries: readonly { id: string; title: string }[];
};

// TRACK: the fight from the GM's tablet. Initiative is typed from the dice (the app never rolls), the order and whose
// turn it is stay in view, and Undo is always under the thumb. Test calls live in their own tab.
export function Track({ me, state, send, sheet, entries }: TrackProps) {
  const t = useTranslations("track");
  const [sheetOf, setSheetOf] = useState<string | null>(null);
  const [testFor, setTestFor] = useState<string | null>(null); // the actor a Test is being called for
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const encounter = state.encounter;
  const actors = useMemo(() => new Map(state.actors.map((a) => [a.id, a])), [state.actors]);
  const rules = sheet.ruleset;
  const mode: TrackMode = rules?.initiative?.strategy === "seated" || rules?.phases ? "game" : "fight";

  // The one place that branches on the turn order: the pinned ruleset's sides order, or null for the two older ones.
  const sides = rules?.initiative?.strategy === "sides" ? rules.initiative : null;

  const noTurnOrder = rules != null && rules.initiative === undefined; // a game without a turn order has no fight to run

  // RUN: sends one action, shows the api's refusal, and says whether it went through.
  const run = async (action: ActionInput) => {
    const r = await send(action);
    setError(r.ok ? null : r.error);
    return r.ok;
  };

  // CORRECT: the GM fixes one score of the newest game; the server ranks the game again.
  const handleCorrect = (resultId: string, score: number) => run({ type: "result.set", resultId, score });

  const sheetActor = sheetOf ? actors.get(sheetOf) : undefined;
  const selected =
    encounter?.combatants.find((c) => c.id === selectedId) ??
    (encounter ? (currentOf(encounter) ?? encounter.combatants[0]) : undefined);

  return (
    <>
      {noTurnOrder ? (
        <p className="dim" role="status">
          {t("noTurnOrder")}
        </p>
      ) : (
        <FightBar
          encounter={encounter}
          sessionRunning={state.session !== null}
          run={run}
          mode={mode}
          sides={sides ?? undefined}
        />
      )}
      {encounter && <EndNotice encounter={encounter} />}
      {encounter && <PhaseBar encounter={encounter} run={run} />}
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
              {encounter.combatants.length === 0 && <p className="dim">{t("nobody", { mode })}</p>}
              {sides ? (
                <SidesOrder
                  encounter={encounter}
                  sides={sides}
                  actors={actors}
                  selectedId={selected?.id}
                  onSelect={setSelectedId}
                />
              ) : (
                <OrderList
                  encounter={encounter}
                  actors={actors}
                  selectedId={selected?.id}
                  onSelect={setSelectedId}
                  run={run}
                />
              )}
            </div>
            {selected && (
              <CombatantPanel
                key={selected.id}
                encounter={encounter}
                combatant={selected}
                actor={actors.get(selected.actorId)}
                run={run}
                mode={mode}
                onSheet={sheet.ruleset ? setSheetOf : undefined}
                onCallTest={state.testDefs.length > 0 ? setTestFor : undefined}
                sides={sides ?? undefined}
                pools={state.pools}
              />
            )}
          </div>
          {encounter && (
            <AddCombatants encounter={encounter} actors={state.actors} run={run} mode={mode} sided={sides !== null} />
          )}
        </fieldset>
      ) : (
        !noTurnOrder && <p className="dim">{state.session ? t("noFight", { mode }) : t("startSession", { mode })}</p>
      )}
      {!encounter && state.games[0] && <GameResult game={state.games[0]} onCorrect={handleCorrect} />}
      {sheet.ruleset && sheetActor && (
        <BottomSheet title={t("sheetOf", { name: sheetActor.name })} onClose={() => setSheetOf(null)}>
          <SheetView
            key={sheetActor.id}
            actor={sheetActor}
            ruleset={sheet.ruleset}
            characters={state.actors.filter((x) => x.kind === "pc").length}
            campaign={state.campaign.fields}
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
      {/* Clocks need no fight and no session: they sit under the order, always usable. */}
      <ClocksPanel clocks={state.clocks} entries={entries} run={run} />
      <PoolsPanel pools={state.pools} me={me} send={send} />
      <TablesPanel
        tables={rules?.tables ?? {}}
        rolls={state.rolls}
        dealt={state.dealt}
        actors={state.actors}
        hasGm={me.tableMode === "gm"}
        run={run}
      />
      {/* A board game's players, automa included, are characters: there are no creatures to spawn. */}
      {mode === "fight" && <Creatures campaignId={state.campaign.id} send={send} />}
    </>
  );
}
