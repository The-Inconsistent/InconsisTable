"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { BookSource } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { FloatingSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import type { RequestPage } from "@/hooks/use-table/use-table";
import { pageOfCite } from "@/lib/sheet/sheet";

type CiteProps = {
  cite: string;
  ruleset: Ruleset;
  /** Sources a GM tablet is serving right now (`useTable().books`). */
  books: readonly BookSource[];
  requestPage: RequestPage;
};

// A printed page reference. When a GM tablet serves that book it is a button that asks the tablet for the page
// (the `book:*` relay: nothing is stored); otherwise it is the cite text alone.
export function Cite({ cite, ruleset, books, requestPage }: CiteProps) {
  const t = useTranslations("cite");
  const [shown, setShown] = useState<{ url: string } | { error: string } | null>(null);
  const page = pageOfCite({ cite, ruleset });
  if (!page || !books.includes(page.source)) return <span className="small dim">{cite}</span>;

  // Asks the GM's tablet for the page and shows the picture it sends back.
  const handleOpen = async () => {
    const r = await requestPage(page);
    setShown(r.ok ? { url: URL.createObjectURL(new Blob([r.image], { type: "image/jpeg" })) } : { error: r.error });
  };
  // Puts the page away and lets go of its picture.
  const handleClose = () => {
    if (shown && "url" in shown) URL.revokeObjectURL(shown.url);
    setShown(null);
  };

  return (
    <>
      <button className="btn sm" onClick={handleOpen} aria-label={t("openLabel", { cite })}>
        {cite}
      </button>
      {shown && (
        <FloatingSheet title={cite} onClose={handleClose}>
          {"url" in shown ? (
            // A blob made in this browser from the relayed page; next/image has nothing to optimise.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown.url} alt={t("pageAlt", { cite })} style={{ width: "100%", height: "auto" }} />
          ) : (
            <p className="error" role="alert">
              {shown.error}
            </p>
          )}
        </FloatingSheet>
      )}
    </>
  );
}
