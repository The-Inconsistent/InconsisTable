"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import {
  canInCampaign,
  type Codex as CodexSnapshot,
  type BookSource,
  type LiveState,
  type Me,
} from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { Codex } from "@/components/gm/codex/codex";
import { Party } from "@/components/gm/party/party";
import { Tests } from "@/components/gm/tests/tests";
import { Track } from "@/components/gm/track/track";
import { RUN_TABS, type RunTab } from "@/components/player/run-table/constants";
import { TableModePicker } from "@/components/player/run-table/table-mode-picker";
import { DraftRecap as DraftRecapButton } from "@/components/ui/draft-recap/draft-recap";
import type { DraftRecap, RequestPage, Send } from "@/hooks/use-table/use-table";
import { RECAP_MAX } from "@/lib/codex/codex";
import { TableModeProvider } from "@/lib/table-mode/table-mode";

type RunTableProps = {
  me: Me;
  state: LiveState;
  codex: CodexSnapshot | null;
  send: Send;
  draftRecap: DraftRecap;
  ruleset: Ruleset | null;
  books: readonly BookSource[];
  requestPage: RequestPage;
  /** A quick game just made this room: open on PARTY with the invite QR up. */
  quick?: boolean;
};

// RUN THE TABLE: a room without a GM is run by every phone at once, so the table's controls live here, behind one tab,
// and the sheet stays the sheet. It is the GM's own panels (TRACK, TESTS, CODEX, PARTY), unchanged: what the api would
// refuse a seat is refused there too, and what is kept for a GM does not exist without one (docs/adr/0009-table-modes.md).
export function RunTable({
  me,
  state,
  codex,
  send,
  draftRecap,
  ruleset,
  books,
  requestPage,
  quick = false,
}: RunTableProps) {
  const t = useTranslations("runTable");
  const can = (perm: Parameters<typeof canInCampaign>[0]["perm"]) => canInCampaign({ ctx: me, perm });
  const tabs = RUN_TABS.filter((name) => can(name === "party" ? "member:invite" : "session:run"));
  const [tab, setTab] = useState<RunTab>(quick ? "party" : "fight");
  const [recap, setRecap] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = tabs.includes(tab) ? tab : (tabs[0] ?? "fight");
  const sheet = { ruleset, books, requestPage };

  // Starts or ends the session; an api refusal is shown as it comes.
  const act = async (action: Parameters<Send>[0]) => {
    const r = await send(action);
    setError(r.ok ? null : r.error);
    return r.ok;
  };
  const handleEnd = async (e: FormEvent) => {
    e.preventDefault();
    if (await act({ type: "session.end", recap: recap ?? "" })) setRecap(null);
  };

  return (
    <TableModeProvider mode={me.tableMode}>
      <div className="stack" style={{ gap: 20 }}>
        {shown !== "party" && can("session:run") && (
          <section className="row">
            {state.session ? (
              recap === null ? (
                <button className="btn" onClick={() => setRecap("")}>
                  {t("end", { number: state.session.number })}
                </button>
              ) : (
                <form className="card stack" onSubmit={handleEnd} style={{ width: "100%" }}>
                  <DraftRecapButton draft={draftRecap} text={recap} onFill={setRecap} onError={setError} />
                  <label className="stack">
                    {t("recap")}
                    <textarea
                      rows={4}
                      value={recap}
                      onChange={(e) => setRecap(e.target.value)}
                      maxLength={RECAP_MAX}
                      placeholder={t("recapHint")}
                      autoFocus
                    />
                  </label>
                  <div className="row">
                    <button className="btn primary">{t("endConfirm", { number: state.session.number })}</button>
                    <button type="button" className="btn" onClick={() => setRecap(null)}>
                      {t("cancel")}
                    </button>
                  </div>
                </form>
              )
            ) : (
              <button className="btn primary" onClick={() => act({ type: "session.start" })}>
                {t("start")}
              </button>
            )}
          </section>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <nav className="tabs" role="tablist" aria-label={t("label")}>
          {tabs.map((name) => (
            <button key={name} className="tab" role="tab" aria-selected={shown === name} onClick={() => setTab(name)}>
              {t(`tabs.${name}`)}
            </button>
          ))}
        </nav>
        {shown === "fight" ? (
          <Track me={me} state={state} send={send} sheet={sheet} entries={codex?.entries ?? []} />
        ) : shown === "tests" ? (
          <Tests state={state} send={send} />
        ) : shown === "codex" ? (
          <Codex me={me} state={state} codex={codex} send={send} />
        ) : (
          <div className="stack" style={{ gap: 24 }}>
            <TableModePicker me={me} state={state} ruleset={ruleset} send={send} />
            <Party
              me={me}
              state={state}
              send={send}
              draftRecap={draftRecap}
              recaps={codex?.recaps ?? []}
              sheet={sheet}
              autoQr={quick}
            />
          </div>
        )}
      </div>
    </TableModeProvider>
  );
}
