import { layoutCards, type HandoutPage, type PrintCard } from "@/lib/print/cards";
import type { Paper } from "@/lib/print/constants";

// The builds the PRINT buttons share. Each loads its sheet (and with it the renderer) on the first build only.

/** Cards on sheets of nine at true size. */
export async function cardsBlob({ cards, paper, title }: { cards: PrintCard[]; paper: Paper; title: string }) {
  const { cardsPdf } = await import("@/components/print/card-sheet/card-sheet");
  const blob = await cardsPdf({ pages: layoutCards(cards), paper, title });
  return blob;
}

/** Handouts one to a page, each with its picture when this seat was sent one. */
export async function handoutsBlob({
  pages,
  paper,
  title,
  signed,
  campaignId,
}: {
  pages: HandoutPage[];
  paper: Paper;
  title: string;
  signed: string;
  campaignId: string;
}) {
  const [{ handoutsPdf }, { picturesOf }] = await Promise.all([
    import("@/components/print/handout-sheet/handout-sheet"),
    import("@/components/print/handout-sheet/utils"),
  ]);
  const pictures = await picturesOf({ campaignId, pages });
  const blob = await handoutsPdf({ pages, paper, title, pictures, signed });
  return blob;
}
