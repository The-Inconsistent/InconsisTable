"use client";
import { useTranslations } from "next-intl";

import type { SheetRow } from "@/lib/sheet-widgets/sheet-widgets";
import { valueOf } from "@/lib/sheet-widgets/sheet-widgets";
import { printValue } from "@/lib/sheet/sheet";

import type { WidgetEnv } from "../types";

type StripProps = { title: SheetRow | null; values: readonly SheetRow[]; env: WidgetEnv };

// A headed strip of short values: the title value in a bar, then each value under its label.
export function Strip({ title, values, env }: StripProps) {
  const t = useTranslations("sheet");
  const print = (row: SheetRow) =>
    printValue({ value: valueOf({ actor: env.actor, row }), yes: t("yes"), no: t("no") });
  return (
    <div className="w-strip">
      {title && (
        <p className="w-strip-bar" data-stat={title.id}>
          <span className="sr-only">{title.label}: </span>
          {print(title)}
        </p>
      )}
      {values.length > 0 && (
        <dl className="w-strip-cells">
          {values.map((v) => (
            <div key={`${v.kind}-${v.id}`} className="w-strip-cell" data-stat={v.id}>
              <dt>{v.label}</dt>
              <dd>{print(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
