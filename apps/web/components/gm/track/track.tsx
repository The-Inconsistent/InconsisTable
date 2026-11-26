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

import { compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { Creatures } from "@/components/gm/creatures/creatures";
import { SpendButtons } from "@/components/gm/spend-buttons/spend-buttons";
import { HeldListEditor } from "@/components/ui/held-list/held-list";
import { StrikeGuide } from "@/components/ui/strike-guide/strike-guide";
import { AddCombatants } from "@/components/gm/track/components/add-combatants/add-combatants";
import { CommandLine } from "@/components/gm/track/components/command-line/command-line";
import { FightLog } from "@/components/gm/track/components/fight-log/fight-log";
import { ClocksPanel } from "@/components/gm/track/components/clocks-panel/clocks-panel";
import { PoolsPanel } from "@/components/gm/track/components/pools-panel/pools-panel";
import { CombatantPanel } from "@/components/gm/track/components/combatant-panel/combatant-panel";
import { FightBar } from "@/components/gm/track/components/fight-bar/fight-bar";
import { SidesOrder } from "@/components/gm/track/components/sides-order/sides-order";
import { TablesPanel } from "@/components/gm/track/components/tables-panel/tables-panel";
import { PhaseBar } from "@/components/gm/track/components/phase-bar/phase-bar";
import { ReminderLines } from "@/components/gm/track/components/reminder-lines/reminder-lines";
import { OrderList } from "@/components/gm/track/components/order-list/order-list";
import { RowShortcuts } from "@/components/gm/track/components/row-shortcuts/row-shortcuts";
import { CallForm } from "@/components/gm/tests/components/call-form/call-form";
import { SheetView } from "@/components/sheet/sheet-view/sheet-view";
import { EndNotice } from "@/components/ui/end-notice/end-notice";
import { GameResult } from "@/components/ui/game-result/game-result";
import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import { harmPadOf } from "@/lib/harm/harm";
import { afterAnswer, afterSelect, refusalAt, type Refusal } from "@/lib/refusal/refusal";
import { gmSideOf } from "@/lib/ledger/table";
import { heldChips } from "@/lib/held/held";
import { rangeOf } from "@/lib/sheet/sheet";
import { currentOf } from "@/lib/track/track";
import { tableCardId, type OpenedTable, type TrackMode } from "@/components/gm/track/constants";

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
  const [opened, setOpened] = useState<OpenedTable | null>(null); // the table a spend opened last
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const encounter = state.encounter;
  const actors = useMemo(() => new Map(state.actors.map((a) => [a.id, a])), [state.actors]);
  const rules = sheet.ruleset;
  const mode: TrackMode = rules?.initiative?.strategy === "seated" || rules?.phases ? "game" : "fight";

  // The one place that branches on the turn order: the pinned ruleset's sides order, or null for the two older ones.
  const sides = rules?.initiative?.strategy === "sides" ? rules.initiative : null;

  const noTurnOrder = rules != null && rules.initiative === undefined; // a game without a turn order has no fight to run

  // RUN: sends one action, keeps the api's refusal with where it came from (a combatant's panel, or null for the
  // tracker), and says whether it went through.
  const askFrom = (from: string | null) => async (action: ActionInput) => {
    const r = await send(action);
    setRefusal(afterAnswer({ result: r, from }));
    return r;
  };
  const runFrom = (from: string | null) => async (action: ActionInput) => (await askFrom(from)(action)).ok;
  const run = runFrom(null);

  // CORRECT: the GM fixes one score of the newest game; the server ranks the game again.
  const handleCorrect = (resultId: string, score: number) => run({ type: "result.set", resultId, score });

  const sheetActor = sheetOf ? actors.get(sheetOf) : undefined;
  const selected =
    encounter?.combatants.find((c) => c.id === selectedId) ??
    (encounter ? (currentOf(encounter) ?? encounter.combatants[0]) : undefined);
  const characters = state.actors.filter((x) => x.kind === "pc").length;
  const trackerRefusal = refusalAt({ refusal, at: null });

  // SELECT: another combatant's panel opens; a refusal about the one before goes.
  const handleSelect = (id: string) => {
    setRefusal(afterSelect({ refusal, was: selected?.id, now: id }));
    setSelectedId(id);
  };

  // What each combatant holds up, for its row (house decision #91).
  const heldOf = (actorId: string) => heldChips({ ruleset: rules, actor: actors.get(actorId) });
  // Its tag and steppers, beside its row (house decision #92).
  const shortcutsOf = (actorId: string) => <RowShortcuts ruleset={rules} actor={actors.get(actorId)} run={run} />;

  // OPEN TABLE: a spend's next table (house decision #91), opened in the tables panel for the spender with the spend's
  // inputs, brought into view and focused.
  const handleOpenTable = (open: Omit<OpenedTable, "n">) => {
    setOpened((was) => ({ ...open, n: (was?.n ?? 0) + 1 }));
    const card = document.getElementById(tableCardId(open.tableId));
    card?.scrollIntoView({ block: "center" });
    card?.focus();
  };

  // The selected combatant's hit pad, when the ruleset has `health.harm` and a profile holds its type (#66).
  const compiled = useMemo(() => {
    const c = rules ? compileRuleset(rules) : null;
    return c?.ok ? c.compiled : null;
  }, [rules]);
  const selectedActor = selected && actors.get(selected.actorId);
  const harmPad = selected ? harmPadOf({ ruleset: rules, actor: selectedActor, combatant: selected }) : null;
  const maxOf = (resource: string) =>
    compiled && selectedActor
      ? (rangeOf({ compiled, resource, actor: selectedActor, characters, campaign: state.campaign.fields })?.max ??
        null)
      : null;

  // What an order on the command line can name and do (house decision #100).
  const resourceLabel = (id: string) => rules?.resources.find((r) => r.id === id)?.label ?? id;
  const harmDef = rules?.health.harm;
  const commandTable = encounter && {
    fighters: encounter.combatants.map((c) => ({ combatantId: c.id, actorId: c.actorId, name: c.name })),
    selected: selected ? { combatantId: selected.id, actorId: selected.actorId, name: selected.name } : null,
    conditions: encounter.conditionDefs.map((d) => ({ id: d.id, label: d.label })),
    pools: state.pools.map((p) => ({ id: p.id, label: p.label })),
    harm: harmDef
      ? {
          wounds: { id: harmDef.wounds, label: resourceLabel(harmDef.wounds) },
          shock: harmDef.shock ? { id: harmDef.shock, label: resourceLabel(harmDef.shock) } : null,
          mob: harmDef.mob !== undefined,
        }
      : null,
    track: encounter.health ? { id: encounter.health.resource, label: resourceLabel(encounter.health.resource) } : null,
    sides: sides !== null,
  };

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
      {encounter && <ReminderLines encounter={encounter} sides={sides ?? undefined} run={run} />}
      {encounter && <EndNotice encounter={encounter} />}
      {encounter && <PhaseBar encounter={encounter} run={run} />}
      {trackerRefusal && (
        <p className="error" role="alert">
          {trackerRefusal}
        </p>
      )}
      {encounter?.paused && (
        <p className="dim" role="status">
          {t("paused")}
        </p>
      )}
      {encounter ? (
        <fieldset disabled={encounter.paused} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          {commandTable && <CommandLine table={commandTable} run={run} />}
          <div className="track">
            <div className="stack">
              {encounter.combatants.length === 0 && <p className="dim">{t("nobody", { mode })}</p>}
              {sides ? (
                <SidesOrder
                  encounter={encounter}
                  sides={sides}
                  actors={actors}
                  selectedId={selected?.id}
                  onSelect={handleSelect}
                  heldOf={heldOf}
                  shortcutsOf={shortcutsOf}
                />
              ) : (
                <OrderList
                  encounter={encounter}
                  actors={actors}
                  selectedId={selected?.id}
                  onSelect={handleSelect}
                  run={run}
                  heldOf={heldOf}
                  shortcutsOf={shortcutsOf}
                />
              )}
            </div>
            {selected && (
              <CombatantPanel
                key={selected.id}
                encounter={encounter}
                combatant={selected}
                actor={actors.get(selected.actorId)}
                run={runFrom(selected.id)}
                refusal={refusalAt({ refusal, at: selected.id })}
                mode={mode}
                onSheet={sheet.ruleset ? setSheetOf : undefined}
                terms={sheet.ruleset ? { ...sheet, ruleset: sheet.ruleset } : undefined}
                onCallTest={state.testDefs.length > 0 ? setTestFor : undefined}
                sides={sides ?? undefined}
                pools={state.pools}
                harm={harmPad && { pad: harmPad, maxOf }}
                spends={
                  sheet.ruleset &&
                  actors.get(selected.actorId) && (
                    <SpendButtons
                      ruleset={sheet.ruleset}
                      compiled={compiled}
                      state={state}
                      actor={actors.get(selected.actorId)!}
                      send={send}
                      onTable={handleOpenTable}
                    />
                  )
                }
                strike={
                  sheet.ruleset &&
                  compiled &&
                  selectedActor && (
                    <StrikeGuide
                      key={selectedActor.id}
                      ruleset={sheet.ruleset}
                      compiled={compiled}
                      attacker={selectedActor}
                      fighting={encounter.combatants.flatMap((x) => actors.get(x.actorId) ?? [])}
                      campaignId={state.campaign.id}
                      characters={characters}
                      campaign={state.campaign.fields}
                      books={sheet.books}
                      requestPage={sheet.requestPage}
                      run={runFrom(selected.id)}
                      onTable={handleOpenTable}
                    />
                  )
                }
                held={
                  sheet.ruleset &&
                  selectedActor && (
                    <HeldListEditor
                      ruleset={sheet.ruleset}
                      actor={selectedActor}
                      campaignId={state.campaign.id}
                      gm
                      send={send}
                    />
                  )
                }
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
      {encounter && <FightLog log={encounter.log ?? []} actors={actors} ruleset={rules ?? null} />}
      {!encounter && state.games[0] && <GameResult game={state.games[0]} onCorrect={handleCorrect} />}
      {sheet.ruleset && sheetActor && (
        <BottomSheet title={t("sheetOf", { name: sheetActor.name })} onClose={() => setSheetOf(null)}>
          <SheetView
            key={sheetActor.id}
            actor={sheetActor}
            ruleset={sheet.ruleset}
            characters={characters}
            campaign={state.campaign.fields}
            gm={canInCampaign({ ctx: me, perm: gmPermOf(sheetActor.kind) })}
            send={send}
            books={sheet.books}
            campaignId={state.campaign.id}
            requestPage={sheet.requestPage}
            builderHref={
              gmSideOf({ me, kind: sheetActor.kind })
                ? `/c/${state.campaign.id}/build/${sheetActor.id}?step=advance`
                : null
            }
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
      {rules && (
        <TablesPanel
          ruleset={rules}
          compiled={compiled}
          rolls={state.rolls}
          dealt={state.dealt}
          actors={state.actors}
          fighting={encounter?.combatants.map((c) => c.actorId) ?? []}
          hasGm={me.tableMode === "gm"}
          campaign={state.campaign.fields}
          books={sheet.books}
          requestPage={sheet.requestPage}
          ask={askFrom(null)}
          opened={opened}
        />
      )}
      {/* A board game's players, automa included, are characters: there are no creatures to spawn. */}
      {mode === "fight" && (
        <Creatures campaignId={state.campaign.id} send={send} state={state} ruleset={rules ?? null} />
      )}
    </>
  );
}
