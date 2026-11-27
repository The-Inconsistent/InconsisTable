"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry } from "@inconsistable/core-schema";

import { PrintDialog, type PrintOptions } from "@/components/print/print-dialog/print-dialog";
import { cardsBlob, handoutsBlob } from "@/components/print/print-dialog/utils";
import { usePrintWords } from "@/components/print/use-print-words";
import { creatureCard, handoutPage, itemCard } from "@/lib/print/cards";
import { HANDOUT_PAPERS, PAPER_KEYS, PAPERS } from "@/lib/print/constants";
import { groupLinks } from "@/lib/prep/prep";
import type { PrepWorld } from "@/lib/scene-prep/scene-prep";

type PrintSceneProps = { scene: CodexEntry; world: PrepWorld; campaignId: string };

// PRINT CARDS and PRINT HANDOUTS on an open scene (issue #4): a card for each creature its roster names and each item
// it links, and its linked handouts as props, built in the GM's browser from what it already holds.
export function PrintScene({ scene, world, campaignId }: PrintSceneProps) {
  const t = useTranslations("print");
  const tHandout = useTranslations("handout");
  const words = usePrintWords();
  const ruleset = world.ruleset ?? null;
  const linked = groupLinks({ entry: scene, entries: world.entries });
  const items = linked.find((g) => g.kind === "item")?.entries ?? [];
  const handouts = linked.find((g) => g.kind === "handout")?.entries ?? [];
  // Each creature the roster names, once, among the packs' entries the page read.
  // ponytail: the page's creatures carry no cite (app/c/[campaignId]/page.tsx drops it), so these cards print none;
  // keep `cite` in that read to print it.
  const keys = new Set((scene.prep?.roster ?? []).map((l) => `${l.pack}/${l.key}`));
  const creatures = ruleset ? world.spawnable.entries.filter((e) => keys.has(`${e.pack}/${e.key}`)) : [];
  const cardCount = creatures.length + items.length;

  // The scene's cards as they stand now.
  const handleCards = async ({ paper }: PrintOptions) => {
    const cards = [
      ...(ruleset ? creatures.map((entry) => creatureCard({ ruleset, entry })) : []),
      ...items.map((entry) => itemCard({ ruleset, entry, entries: world.entries, t: words })),
    ];
    const blob = await cardsBlob({ cards, paper, title: scene.title });
    return blob;
  };
  // The scene's handouts, each in its layout.
  const handleHandouts = async ({ paper }: PrintOptions) => {
    const pages = handouts.map((entry) => handoutPage({ entry, entries: world.entries }));
    const blob = await handoutsBlob({ pages, paper, title: scene.title, signed: tHandout("signed"), campaignId });
    return blob;
  };

  if (cardCount === 0 && handouts.length === 0) return null;
  return (
    <div className="row">
      {cardCount > 0 && (
        <PrintDialog
          label={t("cards.button")}
          ariaLabel={t("cards.label", { title: scene.title })}
          title={t("cards.title")}
          papers={PAPERS}
          paperKey={PAPER_KEYS.pages}
          hint={t("cards.hint")}
          file={t("cards.file")}
          make={handleCards}
        />
      )}
      {handouts.length > 0 && (
        <PrintDialog
          label={t("handouts.button")}
          ariaLabel={t("handouts.label", { title: scene.title })}
          title={t("handouts.title")}
          papers={HANDOUT_PAPERS}
          paperKey={PAPER_KEYS.handouts}
          hint={t("handouts.hint")}
          file={t("handouts.file")}
          make={handleHandouts}
        />
      )}
    </div>
  );
}
