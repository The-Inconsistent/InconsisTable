"use client";
import { useTranslations } from "next-intl";

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
import type { RulesView } from "@/lib/rules-reader/rules-reader";

type TableScreenProps = { campaignId: string; view: RulesView | null };

// The TV at the table (docs/design.md §1.1): read from across the room, no input. It joins by a screen token and sees
// the party view; turn order, party bars and the revealed map join it with the first ruleset (P1) and maps (P2).
export function TableScreen({ campaignId, view }: TableScreenProps) {
  const t = useTranslations("tableScreen");
  const tTable = useTranslations("table");
  const tStatus = useTranslations("status");
  const { state, codex, online, xcard } = useTable(campaignId);
  useWorldRefresh({ rendered: view?.first.world?.versionId ?? null, live: state?.campaign.worldVersionId });
  if (!state) return <StatusScreen text={tStatus("syncing")} />;
  const revealed = (codex?.entries ?? []).filter((e) => e.audienceMode === "all");
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
        {state.session && !state.encounter && codex?.recaps[0] && <RecapCard recap={codex.recaps[0]} />}
        <PoolsView pools={state.pools} />
        <ClocksView clocks={state.clocks} />
        <RollsView rolls={state.rolls} />
        {state.encounter && (
          <OrderView
            encounter={state.encounter}
            sides={view?.ruleset?.initiative?.strategy === "sides" ? view.ruleset.initiative : undefined}
            conditions={view?.ruleset?.conditions}
          />
        )}
        {/* The newest ended game stays up until the next one starts. */}
        {!state.encounter && state.games[0] && <GameResult game={state.games[0]} />}
        {/* A Test in progress: that it is, and how far along. Never who, or any number (the state carries none). */}
        {state.tests
          .filter((c) => c.status === "open")
          .map((c) => (
            <section key={c.id} className="card" role="status">
              <strong>{t("testInProgress")}</strong>
              <span>{t("rolledCount", { test: c.testId, reported: c.reported, called: c.called })}</span>
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
