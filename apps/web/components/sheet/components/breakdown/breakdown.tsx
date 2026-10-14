"use client";
import type { BookSource } from "@inconsistable/core-schema";
import type { BreakdownLine } from "@inconsistable/rules-engine";
import type { Ruleset } from "@inconsistable/rules-engine";

import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import { Cite } from "@/components/ui/cite/cite";
import type { RequestPage } from "@/hooks/use-table/use-table";

type BreakdownProps = {
  label: string;
  total: number;
  /** Null: the value cannot be worked out on this device; only the cite is shown. */
  lines: BreakdownLine[] | null;
  cite: string | null;
  ruleset: Ruleset;
  books: readonly BookSource[];
  requestPage: RequestPage;
  onClose: () => void;
};

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

// "Why is Defense 5?": each source with what it adds or takes away and the page that says so (docs/design.md §4.4).
export function Breakdown({ label, total, lines, cite, ruleset, books, requestPage, onClose }: BreakdownProps) {
  return (
    <BottomSheet title={`${label} ${total}`} onClose={onClose}>
      {lines ? (
        <ul className="list">
          {lines.map((l, i) => (
            <li key={`${l.source}-${i}`}>
              <span className="stack" style={{ gap: 2 }}>
                <strong>{l.source}</strong>
                {l.cite && <Cite cite={l.cite} {...{ ruleset, books, requestPage }} />}
              </span>
              <strong className="sheet-num">{i === 0 ? l.amount : signed(l.amount)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dim">The parts of this number aren&apos;t shown on your phone.</p>
      )}
      {!lines && cite && <Cite {...{ cite, ruleset, books, requestPage }} />}
    </BottomSheet>
  );
}
