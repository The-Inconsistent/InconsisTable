"use client";
import type { CSSProperties, ReactNode } from "react";

import { Cite } from "@/components/ui/cite/cite";
import { Term } from "@/components/ui/term-card/term-card";
import { type SheetRow, termOf } from "@/lib/sheet-widgets/sheet-widgets";

import { Num } from "../num/num";
import type { WidgetEnv } from "../types";

/** One framed value: its label, the number (a derived one opens its breakdown), its cite under it. */
export function Frame({ row, env, mark, total }: { row: SheetRow; env: WidgetEnv; mark?: string; total?: boolean }) {
  return (
    <div className="w-cell" data-stat={row.id} data-total={total || undefined}>
      <span className="w-cell-label">
        {mark && <span aria-hidden="true">{mark} </span>}
        <Term term={termOf(row)} env={env} />
      </span>
      <Num row={row} env={env} className="w-cell-num" />
      {row.cite && <Cite cite={row.cite} ruleset={env.ruleset} books={env.books} requestPage={env.requestPage} />}
    </div>
  );
}

/** Framed cells side by side, at most three to a line. */
export function Cells({ count, children }: { count: number; children: ReactNode }) {
  return (
    <div className="w-cells" data-n={Math.min(count, 3)} style={{ "--n": Math.min(count, 3) } as CSSProperties}>
      {children}
    </div>
  );
}

// Framed values side by side.
export function Frames({ values, env }: { values: readonly SheetRow[]; env: WidgetEnv }) {
  return (
    <Cells count={values.length}>
      {values.map((v) => (
        <Frame key={`${v.kind}-${v.id}`} row={v} env={env} />
      ))}
    </Cells>
  );
}
