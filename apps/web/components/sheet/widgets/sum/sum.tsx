"use client";
import type { SheetRow } from "@/lib/sheet-widgets/sheet-widgets";

import { Cells, Frame } from "../frames/frames";
import type { WidgetEnv } from "../types";

type SumProps = { parts: readonly SheetRow[]; total: SheetRow; env: WidgetEnv };

// Parts and the total they make, framed in a row: the first part, `+` each next one, `=` the total, highlighted.
export function Sum({ parts, total, env }: SumProps) {
  return (
    <Cells count={parts.length + 1}>
      {parts.map((p, i) => (
        <Frame key={`${p.kind}-${p.id}`} row={p} env={env} mark={i > 0 ? "+" : undefined} />
      ))}
      <Frame row={total} env={env} mark={parts.length > 0 ? "=" : undefined} total />
    </Cells>
  );
}
