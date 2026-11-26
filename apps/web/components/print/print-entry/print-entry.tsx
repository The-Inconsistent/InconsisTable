"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { PrintDialog, type PrintOptions } from "@/components/print/print-dialog/print-dialog";
import { cardsBlob, handoutsBlob } from "@/components/print/print-dialog/utils";
import { usePrintWords } from "@/components/print/use-print-words";
import { handoutPage, itemCard } from "@/lib/print/cards";
import { HANDOUT_PAPERS, PAPER_KEYS, PAPERS } from "@/lib/print/constants";

type PrintEntryProps = {
  campaignId: string;
  entry: CodexEntry;
  /** Every entry this seat holds: a mention prints as the table reads it. */
  entries: readonly CodexEntry[];
  ruleset: Ruleset | null;
};

// PRINT on a codex entry (issue #4): a handout as its printed prop, an item as its card. Other kinds print nothing.
// It prints the entry as saved, not an unsaved draft.
export function PrintEntry({ campaignId, entry, entries, ruleset }: PrintEntryProps) {
  const t = useTranslations("print");
  const tHandout = useTranslations("handout");
  const words = usePrintWords();

  // The handout, one page or more in its layout.
  const handleHandout = async ({ paper }: PrintOptions) => {
    const pages = [handoutPage({ entry, entries })];
    const blob = await handoutsBlob({ pages, paper, title: entry.title, signed: tHandout("signed"), campaignId });
    return blob;
  };
  // The item's card at true size.
  const handleItem = async ({ paper }: PrintOptions) => {
    const blob = await cardsBlob({
      cards: [itemCard({ ruleset, entry, entries, t: words })],
      paper,
      title: entry.title,
    });
    return blob;
  };

  if (entry.kind === "handout")
    return (
      <PrintDialog
        label={t("handouts.one")}
        ariaLabel={t("handouts.oneLabel", { title: entry.title })}
        title={t("handouts.title")}
        papers={HANDOUT_PAPERS}
        paperKey={PAPER_KEYS.handouts}
        hint={t("handouts.hint")}
        file={t("handouts.file")}
        make={handleHandout}
      />
    );
  if (entry.kind === "item")
    return (
      <PrintDialog
        label={t("cards.one")}
        ariaLabel={t("cards.oneLabel", { name: entry.title })}
        title={t("cards.title")}
        papers={PAPERS}
        paperKey={PAPER_KEYS.pages}
        hint={t("cards.hint")}
        file={t("cards.file")}
        make={handleItem}
      />
    );
  return null;
}
