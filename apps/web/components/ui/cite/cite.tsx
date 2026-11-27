"use client";
import { useTranslations } from "next-intl";
import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { BookSource } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { FloatingSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import type { RequestPage } from "@/hooks/use-table/use-table";
import { pageOfCite } from "@/lib/sheet/sheet";

type CiteEnv = {
  ruleset: Ruleset | null;
  /** Sources a device is serving right now (`useTable().books`). */
  books: readonly BookSource[];
  requestPage: RequestPage;
};

// Off the table (the builder, the library) nothing is served, so a cite there is plain text rather than an error:
// this context has a default instead of a hook that throws.
const CiteContext = createContext<CiteEnv>({
  ruleset: null,
  books: [],
  requestPage: async () => ({ ok: false, error: "" }),
});

type CiteProviderProps = CiteEnv & { children: ReactNode };

/** The room's ruleset and served books for every cite inside: the GM app and the player app mount it. */
export function CiteProvider({ ruleset, books, requestPage, children }: CiteProviderProps) {
  const value = useMemo(() => ({ ruleset, books, requestPage }), [ruleset, books, requestPage]);
  return <CiteContext value={value}>{children}</CiteContext>;
}

// ponytail: the drilled ruleset, books and requestPage props stay for the callers that pass them, drop them as those
// callers move to the provider
type CiteProps = { cite: string } & Partial<CiteEnv>;

type Shown = { url?: string; error?: string };

/** Whether a cite opens its page right now. A row that is itself a button keeps the cite as text inside it until then,
 * and shows a `Cite` beside it once it opens (a button can't hold one). */
export function useCiteOpens(cite: string | undefined) {
  const { ruleset, books } = use(CiteContext);
  const page = cite && ruleset ? pageOfCite({ cite, ruleset }) : null;
  return !!page && books.includes(page.source);
}

// A printed page reference. When a device at the table serves that book it is a button that asks for the page (the
// `book:*` relay: nothing is stored) and shows it in a sheet; otherwise it is the cite text alone.
export function Cite({ cite, ...props }: CiteProps) {
  const t = useTranslations("cite");
  const env = { ...use(CiteContext), ...props };
  const [shown, setShown] = useState<Shown | null>(null);
  const [zoomed, setZoomed] = useState(false);
  // The newest open: a reply for a page already put away is dropped, its picture never made.
  const asked = useRef(0);
  // Lets go of a page's picture once another replaces it, the sheet is put away or the cite unmounts.
  const url = shown?.url;
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const page = env.ruleset && pageOfCite({ cite, ruleset: env.ruleset });
  if (!page || !env.books.includes(page.source)) return <span className="small dim">{cite}</span>;

  // Opens the sheet at once, asks for the page and shows the picture it sends back.
  const handleOpen = async () => {
    const n = ++asked.current;
    setShown({});
    setZoomed(false);
    const r = await env.requestPage(page);
    if (asked.current !== n) return;
    setShown(r.ok ? { url: URL.createObjectURL(new Blob([r.image], { type: "image/jpeg" })) } : { error: r.error });
  };
  // Puts the page away; the effect above lets go of its picture.
  const handleClose = () => {
    asked.current++;
    setShown(null);
  };

  return (
    <>
      <button className="btn sm" onClick={handleOpen} aria-label={t("openLabel", { cite })}>
        {cite}
      </button>
      {shown && (
        <FloatingSheet title={cite} onClose={handleClose}>
          {shown.url ? (
            <>
              <button
                className="btn sm"
                style={{ justifySelf: "start" }}
                aria-pressed={zoomed}
                onClick={() => setZoomed(!zoomed)}
              >
                {zoomed ? t("fit") : t("zoom")}
              </button>
              <div className="book-page-frame" tabIndex={0} role="region" aria-label={t("pageAlt", { cite })}>
                {/* A blob made in this browser from the relayed page; next/image has nothing to optimise. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="book-page" data-zoom={zoomed} src={shown.url} alt={t("pageAlt", { cite })} />
              </div>
            </>
          ) : shown.error !== undefined ? (
            <p className="error" role="alert">
              {shown.error}
            </p>
          ) : (
            <p className="dim" role="status">
              {t("asking")}
            </p>
          )}
        </FloatingSheet>
      )}
    </>
  );
}
