"use client";
import { useTranslations } from "next-intl";

import type { BookSource } from "@inconsistable/core-schema";
import type { BreakdownLine, Ruleset } from "@inconsistable/rules-engine";

import { Cite } from "@/components/ui/cite/cite";
import type { RequestPage } from "@/hooks/use-table/use-table";

type BreakdownLinesProps = {
  lines: readonly BreakdownLine[];
  ruleset: Ruleset;
  books: readonly BookSource[];
  requestPage: RequestPage;
  label?: string;
};

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

// The lines a number is made of: the base, then each source signed, each with the page that says so. A derived value's
// breakdown on the sheet and a strike's numbers in its guide (house decision #99) draw the same lines; a GM's override
// is the last line (house decision #96).
export function BreakdownLines({ lines, ruleset, books, requestPage, label }: BreakdownLinesProps) {
  const t = useTranslations("breakdown");
  return (
    <ul className="list" aria-label={label}>
      {lines.map((l, i) => (
        <li key={`${l.source}-${i}`}>
          <span className="stack" style={{ gap: 2 }}>
            <strong>{l.override ? t("override", { source: l.source }) : l.source}</strong>
            {l.cite && <Cite cite={l.cite} {...{ ruleset, books, requestPage }} />}
          </span>
          <strong className="sheet-num">{i === 0 ? l.amount : signed(l.amount)}</strong>
        </li>
      ))}
    </ul>
  );
}
