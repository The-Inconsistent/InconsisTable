"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { BookSource } from "@inconsistable/core-schema";
import type { BreakdownLine } from "@inconsistable/rules-engine";
import type { Ruleset } from "@inconsistable/rules-engine";

import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import { BreakdownLines } from "@/components/ui/breakdown-lines/breakdown-lines";
import { Cite } from "@/components/ui/cite/cite";
import type { RequestPage } from "@/hooks/use-table/use-table";

type BreakdownProps = {
  label: string;
  total: number;
  /** Null: the value cannot be worked out on this device; only the cite is shown. */
  lines: BreakdownLine[] | null;
  cite: string | null;
  /** What the value means, in the importer's words (house decision #126): the number needs no second tap target. */
  summary?: string | null;
  ruleset: Ruleset;
  books: readonly BookSource[];
  requestPage: RequestPage;
  onClose: () => void;
  /** What the GM side may do to the number: its override (house decision #96). */
  children?: ReactNode;
};

// "Why is Defense 5?": each source with what it adds or takes away and the page that says so (docs/design.md §4.4).
export function Breakdown({
  label,
  total,
  lines,
  cite,
  summary = null,
  ruleset,
  books,
  requestPage,
  onClose,
  children,
}: BreakdownProps) {
  const t = useTranslations("breakdown");
  return (
    <BottomSheet title={`${label} ${total}`} onClose={onClose}>
      {summary && <p className="term-text">{summary}</p>}
      {lines ? <BreakdownLines {...{ lines, ruleset, books, requestPage }} /> : <p className="dim">{t("hidden")}</p>}
      {!lines && cite && <Cite {...{ cite, ruleset, books, requestPage }} />}
      {children}
    </BottomSheet>
  );
}
