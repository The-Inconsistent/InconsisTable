"use client";
import { useTranslations } from "next-intl";

import type { LiveState } from "@inconsistable/core-schema";
import { compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import { PrintDialog, type PrintOptions } from "@/components/print/print-dialog/print-dialog";
import { cardsBlob } from "@/components/print/print-dialog/utils";
import { PrintSheets } from "@/components/print/print-sheets/print-sheets";
import { usePrintWords } from "@/components/print/use-print-words";
import { tentCard } from "@/lib/print/cards";
import { PAPER_KEYS, PAPERS } from "@/lib/print/constants";
import { rangeOf } from "@/lib/sheet/sheet";

type PrintPartyProps = { state: Pick<LiveState, "actors" | "campaign">; ruleset: Ruleset | null };

// PARTY's prints (issue #4): every character's sheet, and a tent card for each to stand behind its miniature.
export function PrintParty({ state, ruleset }: PrintPartyProps) {
  const t = useTranslations("print");
  const words = usePrintWords();
  const pcs = state.actors.filter((a) => a.kind === "pc");
  if (!ruleset || pcs.length === 0) return null;
  const campaign = state.campaign.fields;

  // A tent card per character, its resources at their limits as the screen works them out.
  const handleTents = async ({ paper }: PrintOptions) => {
    const c = compileRuleset(ruleset);
    const cards = pcs.map((actor) =>
      tentCard({
        ruleset,
        actor,
        t: words,
        maxOf: (resource) =>
          c.ok
            ? (rangeOf({ compiled: c.compiled, resource, actor, characters: pcs.length, campaign })?.max ?? null)
            : null,
      }),
    );
    const blob = await cardsBlob({ cards, paper, title: t("tents.title") });
    return blob;
  };

  return (
    <div className="row">
      <PrintSheets actors={pcs} ruleset={ruleset} characters={pcs.length} campaign={campaign} />
      <PrintDialog
        label={t("tents.button")}
        ariaLabel={t("tents.label")}
        title={t("tents.title")}
        papers={PAPERS}
        paperKey={PAPER_KEYS.pages}
        hint={t("cards.hint")}
        file={t("tents.file")}
        make={handleTents}
      />
    </div>
  );
}
