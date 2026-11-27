"use client";
import { useTranslations } from "next-intl";

import { CREATION_PATHS, type CreationPath } from "@inconsistable/rules-engine";

type CreationPathProps = { path: CreationPath; onPick: (path: CreationPath) => void };

// BUILD or BY HAND, for a character of a type both the ledger and creation steps make, until its first save (house
// decision #199): the GM side only; the ruleset's `first` is picked to start with.
export function CreationPathPicker({ path, onPick }: CreationPathProps) {
  const t = useTranslations("builder.path");
  return (
    <div className="row" style={{ gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <span className="label">{t("label")}</span>
      <span className="seg" role="group" aria-label={t("label")}>
        {CREATION_PATHS.map((p) => (
          <button key={p} type="button" className="btn sm" aria-pressed={path === p} onClick={() => onPick(p)}>
            {t(p)}
          </button>
        ))}
      </span>
    </div>
  );
}
