"use client";
import { useTranslations } from "next-intl";

import { Cite } from "@/components/ui/cite/cite";
import type { WidgetModel } from "@/lib/sheet-widgets/sheet-widgets";

import type { WidgetEnv } from "../types";

type FoldsProps = { model: Extract<WidgetModel, { widget: "folds" }>; env: WidgetEnv };

// Named entries the saved build holds, folded: the name, a stamp for a talent when both lists show, and the page; the
// importer's own summary opens under it. An entry without a summary does not fold. Never the books' wording.
export function Folds({ model, env }: FoldsProps) {
  const t = useTranslations("sheet.widget");
  const { lines, variant } = model;
  const entries = [
    ...(variant === "talents" ? [] : lines.abilities.map((r) => ({ ...r, talent: false }))),
    ...(variant === "abilities" ? [] : lines.talents.map((r) => ({ ...r, talent: variant === "both" }))),
  ];
  return (
    <div className="w-folds">
      {entries.map((e, i) => {
        const head = (
          <>
            {e.talent && <span className="w-stamp">{t("talent")}</span>}
            <span className="w-fold-title">{e.name}</span>
          </>
        );
        const cite = e.page && (
          <Cite cite={e.page} ruleset={env.ruleset} books={env.books} requestPage={env.requestPage} />
        );
        return e.summary ? (
          <details key={i} className="w-fold">
            <summary>
              {head}
              {e.page && <span className="w-fold-page">{e.page}</span>}
            </summary>
            <div className="w-fold-body">
              <p>{e.summary}</p>
              {cite}
            </div>
          </details>
        ) : (
          <div key={i} className="w-fold w-fold-flat">
            {head}
            {cite}
          </div>
        );
      })}
    </div>
  );
}
