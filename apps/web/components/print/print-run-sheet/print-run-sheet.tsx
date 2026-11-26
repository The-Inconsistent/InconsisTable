"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry } from "@inconsistable/core-schema";

import { PrintDialog, type PrintOptions } from "@/components/print/print-dialog/print-dialog";
import { usePrintWords } from "@/components/print/use-print-words";
import { useSummaryWords } from "@/hooks/use-summary-words/use-summary-words";
import { PAPER_KEYS, PAPERS } from "@/lib/print/constants";
import { printRunSheet } from "@/lib/print/run-sheet";
import { lineNames, type PrepWorld } from "@/lib/scene-prep/scene-prep";

type PrintRunSheetProps = {
  adventure: CodexEntry;
  /** Its scenes in play order. */
  scenes: readonly CodexEntry[];
  world: PrepWorld;
  /** The seat reads the GM's secrets: its notes and the Tests' outcomes go on the paper. */
  gm: boolean;
};

// PRINT RUN SHEET on an adventure in PREP (issue #4): its scenes in order on paper, built in the GM's browser.
export function PrintRunSheet({ adventure, scenes, world, gm }: PrintRunSheetProps) {
  const t = useTranslations("print.runSheet");
  const words = usePrintWords();
  const summary = useSummaryWords();

  // Builds the run sheet from the codex as it stands now.
  const make = async ({ paper, breaks }: PrintOptions) => {
    const sheet = printRunSheet({ adventure, scenes, world, names: lineNames(world), summary, t: words, gm });
    const { runSheetPdf } = await import("@/components/print/run-sheet-pdf/run-sheet-pdf");
    const blob = await runSheetPdf({
      sheet,
      paper,
      breaks,
      words: { readAloud: t("readAloud"), gmNotes: t("gmNotes"), budget: t("budget"), fields: t("fields") },
    });
    return blob;
  };

  return (
    <PrintDialog
      label={t("button")}
      ariaLabel={t("label", { title: adventure.title })}
      title={t("title")}
      papers={PAPERS}
      paperKey={PAPER_KEYS.pages}
      hint={t("hint")}
      file={t("file")}
      breaks={t("breaks")}
      make={make}
    />
  );
}
