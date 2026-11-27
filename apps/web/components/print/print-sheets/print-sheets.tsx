"use client";
import { useTranslations } from "next-intl";

import type { Actor } from "@inconsistable/core-schema";
import { compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { PrintDialog, type PrintOptions } from "@/components/print/print-dialog/print-dialog";
import { usePrintWords } from "@/components/print/use-print-words";
import { PAPER_KEYS, PAPERS } from "@/lib/print/constants";
import { printSheet } from "@/lib/print/sheet";
import { rangeOf } from "@/lib/sheet/sheet";

type PrintSheetsProps = {
  /** The characters to print, as this seat received them: a player's own, or any the GM side holds. */
  actors: readonly Actor[];
  ruleset: Ruleset;
  /** Player characters at the table: the `party.characters` a resource's limit may read. */
  characters: number;
  campaign?: Readonly<Record<string, number | string | boolean>>;
};

// PRINT on a sheet, PRINT SHEETS on the party (issue #4): each character's sheet as this seat holds it, so a value the
// seat was not sent is not on the paper.
export function PrintSheets({ actors, ruleset, characters, campaign }: PrintSheetsProps) {
  const t = useTranslations("print.sheet");
  const words = usePrintWords();
  const [only] = actors;
  if (!only) return null;
  const one = actors.length === 1;

  // Builds the sheets from the characters as they stand now, each resource's limit worked out as the screen does.
  const make = async ({ paper }: PrintOptions) => {
    const c = compileRuleset(ruleset);
    const sheets = actors.map((actor) =>
      printSheet({
        ruleset,
        actor,
        t: words,
        maxOf: (resource) =>
          c.ok ? (rangeOf({ compiled: c.compiled, resource, actor, characters, campaign })?.max ?? null) : null,
      }),
    );
    const { sheetsPdf } = await import("@/components/print/sheet-pdf/sheet-pdf");
    const blob = await sheetsPdf({ sheets, paper, title: one ? only.name : t("allTitle") });
    return blob;
  };

  return (
    <PrintDialog
      label={one ? t("one") : t("all")}
      ariaLabel={one ? t("oneLabel", { name: only.name }) : t("allLabel")}
      title={one ? t("oneTitle", { name: only.name }) : t("allTitle")}
      papers={PAPERS}
      paperKey={PAPER_KEYS.pages}
      hint={t("hint")}
      file={t("file")}
      make={make}
    />
  );
}
