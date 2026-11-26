"use client";
import { useTranslations } from "next-intl";

import type { Ruleset } from "@inconsistable/rules-engine";

import { PrintDialog, type PrintOptions } from "@/components/print/print-dialog/print-dialog";
import { cardsBlob } from "@/components/print/print-dialog/utils";
import type { RulesEntry } from "@/lib/library/library";
import { creatureCard } from "@/lib/print/cards";
import { PAPER_KEYS, PAPERS } from "@/lib/print/constants";

type PrintCreatureProps = { entry: RulesEntry; ruleset: Ruleset };

// PRINT CARD on a creature picked in ADD CREATURES (issue #4): its name, numbers and cite on a card at true size.
export function PrintCreature({ entry, ruleset }: PrintCreatureProps) {
  const t = useTranslations("print.cards");

  // The creature's card.
  const make = async ({ paper }: PrintOptions) => {
    const blob = await cardsBlob({ cards: [creatureCard({ ruleset, entry })], paper, title: entry.name });
    return blob;
  };

  return (
    <PrintDialog
      label={t("one")}
      ariaLabel={t("oneLabel", { name: entry.name })}
      title={t("title")}
      papers={PAPERS}
      paperKey={PAPER_KEYS.pages}
      hint={t("hint")}
      file={t("file")}
      make={make}
    />
  );
}
