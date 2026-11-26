"use client";
import { useTranslations } from "next-intl";

import type { BuildStep } from "@inconsistable/rules-engine";

import { Cite } from "@/components/ui/cite/cite";
import { toggleApproval } from "@/lib/ledger/ledger";

import { useLedger } from "../../ledger-context";
import { ChoiceCard } from "../choice-card/choice-card";

type StepIssuesProps = { step: BuildStep };

// What a step still asks for and what is wrong in it, then every choice its grants ask, answered or not. A question
// only the GM can judge waits for the GM on a player's screen, and carries the tick on a GM-side seat. The engine's
// sentences are shown as they come (docs/adr/0011, consequences).
export function StepIssues({ step }: StepIssuesProps) {
  const t = useTranslations("ledgerBuilder.issues");
  const { issues, gm, build, edit } = useLedger();
  const { pending, choices, problems } = issues[step];
  if (pending.length + choices.length + problems.length === 0) return null;
  return (
    <div className="stack lb-issues">
      {pending.length + problems.length > 0 && (
        <ul className="list lb-issue-list" aria-label={t("label")}>
          {pending.map((p) => (
            <li key={p.path} data-kind="todo">
              <span className="lb-tag">{t("todo")}</span>
              <span className="lb-issue-text">
                {p.what}
                {p.of && <span className="dim"> ({p.of})</span>}
                {p.cite && (
                  <span className="small dim">
                    {" "}
                    · <Cite cite={p.cite} />
                  </span>
                )}
              </span>
            </li>
          ))}
          {problems.map((p, i) => (
            <li key={`${p.path ?? ""}${i}`} data-kind={p.severity}>
              <span className="lb-tag">{p.severity === "gm" ? t("gm") : t("fix")}</span>
              <span className="lb-issue-text">
                {p.what}
                {p.cite && (
                  <span className="small dim">
                    {" "}
                    · <Cite cite={p.cite} />
                  </span>
                )}
              </span>
              {p.severity === "gm" &&
                (gm && p.path ? (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => edit(toggleApproval({ build, path: p.path! }))}
                    aria-label={t("approveLabel", { what: p.what })}
                  >
                    {t("approve")}
                  </button>
                ) : (
                  <span className="small dim">{gm ? t("noTick") : t("waiting")}</span>
                ))}
            </li>
          ))}
        </ul>
      )}
      {choices.map((c) => (
        <ChoiceCard key={c.path} prompt={c} />
      ))}
    </div>
  );
}
