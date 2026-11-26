"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";

import type { ActionInput, Me } from "@inconsistable/core-schema";
import { checklistTicks, type Ruleset } from "@inconsistable/rules-engine";

import { GeneratorWizard } from "@/components/gm/codex/components/generator-wizard/generator-wizard";
import { PackAdder } from "@/components/gm/codex/components/pack-adder/pack-adder";
import { StatusScreen } from "@/components/ui/status-screen/status-screen";
import { useTable } from "@/hooks/use-table/use-table";
import { checklistRoom } from "@/lib/checklist/checklist";
import { fromKinds } from "@/lib/entry-fields/entry-fields";

import { JoinQr, type Invite } from "./components/join-qr/join-qr";

type FirstRunProps = { me: Me; ruleset: Ruleset | null; packs: readonly { slug: string }[] };

// FIRST RUN (house decision #146): the setup checklist the ruleset declares, one step at a time, each with what its GO
// TO names mounted here (ADD FROM A PACK, which is also the printed-premise picker, the generators that make its kind,
// the room's join QR) and a way into the table for the rest. Every step can be skipped; nothing here is stored, and the
// checklist on PARTY still shows what is left.
export function FirstRun({ me, ruleset, packs }: FirstRunProps) {
  const t = useTranslations("firstRun");
  const tTabs = useTranslations("gmApp.tabs");
  const tKind = useTranslations("codex.kind");
  const tChecklist = useTranslations("checklist");
  const tStatus = useTranslations("status");
  const { state, codex, send } = useTable(me.campaignId);
  const [at, setAt] = useState(0);
  const [generating, setGenerating] = useState<string | null>(null);
  // The one room invite this walk made, shown again on every step that asks for the join QR.
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const table = `/c/${me.campaignId}?tab=party`;
  const steps = ruleset?.checklist ?? [];

  if (!state) return <StatusScreen text={tStatus("syncing")} />;
  const { ticks } = checklistTicks({
    steps,
    room: checklistRoom({ state, entries: codex?.entries ?? [], packs }),
  });
  const tick = ticks[Math.min(at, ticks.length - 1)];
  const goto = tick?.step.goto;
  const kind = goto?.tab === "codex" ? goto.kind : undefined;
  const madeFrom = fromKinds(ruleset).filter((k) => k.kind === kind);
  const generators = (ruleset?.generators ?? []).filter((g) => g.make.kind === kind);
  const generator = generators.find((g) => g.id === generating);
  const where = goto && (goto.kind ? `${tTabs(goto.tab)} › ${tKind(goto.kind)}` : tTabs(goto.tab));
  const goHref =
    goto && `/c/${me.campaignId}?${new URLSearchParams({ tab: goto.tab, ...(goto.kind ? { kind: goto.kind } : {}) })}`;

  // Sends an action from a mounted panel and shows its refusal, if any.
  const act = async (a: ActionInput) => {
    const r = await send(a);
    setError(r.ok ? null : r.error);
    return r;
  };
  // BACK, SKIP and NEXT: another step; a generator left open closes.
  const move = (to: number) => {
    setAt(to);
    setGenerating(null);
    setError(null);
  };

  return (
    <div className="surface-table">
      <header className="band">
        <strong className="header-name">{state.campaign.name}</strong>
        <Link className="btn sm" href={table}>
          {t("skipAll")}
        </Link>
      </header>
      <main className="page stack" style={{ gap: 16 }}>
        <h1 className="title">{t("title")}</h1>
        {!tick ? (
          <section className="card stack first-run-step">
            <p>{t("nothing")}</p>
          </section>
        ) : (
          <section key={tick.step.id} className="card stack first-run-step" aria-labelledby="first-run-label">
            <p className="small dim">{t("progress", { n: at + 1, count: ticks.length })}</p>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="chip" data-state={tick.done ? "good" : undefined}>
                {tick.done ? tChecklist("done") : tChecklist("toDo")}
              </span>
              {tick.step.optional && !tick.done && <span className="chip">{tChecklist("optional")}</span>}
              <h2 id="first-run-label" className="head" style={{ overflowWrap: "anywhere" }}>
                {tick.step.label}
              </h2>
            </div>
            <p className="small dim">
              {tick.step.done.count === "campaignField"
                ? t("value", { value: String(state.campaign.fields[tick.step.done.field] ?? "—") })
                : tChecklist("now", { count: tick.count })}
              {tick.step.cite && ` · ${tick.step.cite}`}
            </p>
            {tick.step.note && <p className="small">{tick.step.note}</p>}
            {madeFrom.length > 0 && (
              <PackAdder
                kinds={madeFrom}
                campaignId={me.campaignId}
                ruleset={ruleset}
                act={act}
                onMade={() => undefined}
                onClose={() => undefined}
              />
            )}
            {ruleset && generators.length > 0 && !generator && (
              <div className="row" style={{ flexWrap: "wrap" }}>
                {generators.map((g) => (
                  <button key={g.id} type="button" className="btn" onClick={() => setGenerating(g.id)}>
                    {t("generate", { name: g.label })}
                  </button>
                ))}
              </div>
            )}
            {ruleset && generator && (
              <GeneratorWizard
                key={generator.id}
                generator={generator}
                ruleset={ruleset}
                campaignId={me.campaignId}
                campaign={state.campaign.fields}
                act={act}
                onMade={() => setGenerating(null)}
                onClose={() => setGenerating(null)}
              />
            )}
            {goto?.tab === "party" && <JoinQr act={act} invite={invite} onInvite={setInvite} />}
            {goto && goHref && (
              <Link
                className="btn"
                href={goHref}
                aria-label={tChecklist("goTo", { step: tick.step.label, place: where ?? "" })}
              >
                {t("openThere", { place: where ?? "" })}
              </Link>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
        )}
        <div className="row between" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn" disabled={at === 0} onClick={() => move(at - 1)}>
            {t("back")}
          </button>
          {at < ticks.length - 1 ? (
            <button type="button" className={tick?.done ? "btn primary" : "btn"} onClick={() => move(at + 1)}>
              {tick?.done ? t("next") : t("skip")}
            </button>
          ) : (
            <Link className="btn primary" href={table}>
              {t("toTable")}
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
