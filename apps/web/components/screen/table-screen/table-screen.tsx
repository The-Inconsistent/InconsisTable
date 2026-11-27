"use client";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { compileRuleset } from "@inconsistable/rules-engine";

import { ScreenCard } from "@/components/screen/table-screen/components/screen-card/screen-card";
import { ClocksView } from "@/components/ui/clocks-view/clocks-view";
import { EntryFields } from "@/components/ui/entry-fields/entry-fields";
import { PoolsView } from "@/components/ui/pools-view/pools-view";
import { RollsView } from "@/components/ui/rolls-view/rolls-view";
import { GameResult } from "@/components/ui/game-result/game-result";
import { HandoutDoc } from "@/components/ui/handout-doc/handout-doc";
import { MentionText } from "@/components/ui/mention-text/mention-text";
import { OrderView } from "@/components/ui/order-view/order-view";
import { RecapCard } from "@/components/ui/recap-card/recap-card";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { XCardOverlay } from "@/components/ui/xcard/xcard-overlay";
import { useTable } from "@/hooks/use-table/use-table";
import { useWorldRefresh } from "@/hooks/use-world-refresh/use-world-refresh";
import { heldChips } from "@/lib/held/held";
import type { RulesView } from "@/lib/rules-reader/rules-reader";
import { rangeOf } from "@/lib/sheet/sheet";
import { screenCardsOf, type ScreenCardOf } from "@/lib/table-screen/table-screen";
import { testWords } from "@/lib/test-inputs/test-inputs";

type TableScreenProps = { campaignId: string; view: RulesView | null };

// The TV at the table (docs/design.md §1.1): read from across the room, no input. It joins by a screen token and sees
// the party view; turn order, party bars and the revealed map join it with the first ruleset (P1) and maps (P2). A
// ruleset that lays out the screen adds a card per character, and one per creature the GM shows in full (#127).
export function TableScreen({ campaignId, view }: TableScreenProps) {
  const t = useTranslations("tableScreen");
  const tTable = useTranslations("table");
  const tStatus = useTranslations("status");
  const { state, codex, online, xcard, send, requestPage } = useTable(campaignId);
  useWorldRefresh({ rendered: view?.first.world?.versionId ?? null, live: state?.campaign.worldVersionId });
  const ruleset = view?.ruleset ?? null;
  const compiled = useMemo(() => {
    const c = ruleset ? compileRuleset(ruleset) : null;
    return c?.ok ? c.compiled : null;
  }, [ruleset]);
  if (!state) return <StatusScreen text={tStatus("syncing")} />;
  const revealed = (codex?.entries ?? []).filter((e) => e.audienceMode === "all");
  const cards = screenCardsOf({ ruleset, state });
  const characters = state.actors.filter((a) => a.kind === "pc").length;
  // One card per actor, its bounds worked out from what the screen received.
  const cardOf = ({ actor, rows }: ScreenCardOf) =>
    ruleset && (
      <ScreenCard
        key={actor.id}
        range={(resource) =>
          compiled ? rangeOf({ compiled, resource, actor, characters, campaign: state.campaign.fields }) : null
        }
        {...{ actor, ruleset, rows, send, requestPage }}
      />
    );
  return (
    <div className="surface-table" data-density="tv">
      <XCardOverlay signal={xcard} tv />
      <main className="screen stack">
        {/* The screen has no header band: the badge is its first row instead. */}
        {!online && (
          <span className="badge-offline" role="status">
            {tTable("offline")}
          </span>
        )}
        <h1 className="title">{state.campaign.name}</h1>
        <p>{state.session ? tTable("session", { number: state.session.number }) : t("between")}</p>
        <p className="dim">
          {state.actors
            .filter((a) => a.kind === "pc")
            .map((a) => a.name)
            .join(" · ")}
        </p>
        {/* "Last time...": while a session runs and no fight has started. */}
        {state.session && !state.encounter && codex?.recaps[0] && (
          <RecapCard recap={codex.recaps[0]} entries={codex.entries} />
        )}
        <PoolsView pools={state.pools} />
        <ClocksView clocks={state.clocks} />
        <RollsView rolls={state.rolls} />
        {cards.party.length > 0 && <div className="screen-cards">{cards.party.map(cardOf)}</div>}
        {state.encounter && (
          <OrderView
            encounter={state.encounter}
            sides={view?.ruleset?.initiative?.strategy === "sides" ? view.ruleset.initiative : undefined}
            conditions={view?.ruleset?.conditions}
            heldOf={(id) => heldChips({ ruleset: view?.ruleset, actor: state.actors.find((a) => a.id === id) })}
          />
        )}
        {cards.shown.length > 0 && <div className="screen-cards">{cards.shown.map(cardOf)}</div>}
        {/* The newest ended game stays up until the next one starts. */}
        {!state.encounter && state.games[0] && <GameResult game={state.games[0]} />}
        {/* A Test in progress: that it is, and how far along. Never who, or any number (the state carries none). */}
        {state.tests
          .filter((c) => c.status === "open")
          .map((c) => (
            <section key={c.id} className="card" role="status">
              <strong>{t("testInProgress")}</strong>
              <span>
                {t("rolledCount", {
                  // The Test's label from the ruleset this screen already reads (house decision #77), else its id.
                  test: testWords({ ...view?.ruleset?.tests[c.testId], id: c.testId }).test,
                  reported: c.reported,
                  called: c.called,
                })}
              </span>
            </section>
          ))}
        {revealed.map((e) => (
          <section key={e.id} className="card">
            <strong>{e.title}</strong>
            <EntryFields
              ruleset={view?.ruleset ?? null}
              entry={e}
              campaignId={null}
              known={view?.first.entries ?? []}
              entries={codex?.entries ?? []}
              campaign={state.campaign.fields}
            />
            {e.layout !== null ? (
              <HandoutDoc layout={e.layout} header={e.header ?? ""} title={e.title} body={e.body} entries={revealed} />
            ) : (
              <span>
                <MentionText body={e.body} entries={revealed} />
              </span>
            )}
          </section>
        ))}
      </main>
    </div>
  );
}
