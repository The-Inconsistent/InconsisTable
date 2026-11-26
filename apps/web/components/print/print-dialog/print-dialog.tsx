"use client";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

import type { Paper } from "@/lib/print/constants";

export type PrintOptions = { paper: Paper; breaks: boolean };

type PrintDialogProps = {
  /** The button's text, and its accessible name (the action and its target). */
  label: string;
  ariaLabel: string;
  /** The dialog's heading. */
  title: string;
  papers: readonly Paper[];
  /** Where this browser remembers the paper picked for this kind of print. */
  paperKey: string;
  /** How to print it (the scale, the fold, two to a sheet). */
  hint: string;
  file: string;
  /** The page-break switch's label; absent, no switch. */
  breaks?: string;
  /** Builds the PDF from what this browser holds at that moment; it loads the renderer on the first build. */
  make: (options: PrintOptions) => Promise<Blob>;
};

type Built = { url: string } | { error: string } | "building" | null;

const savedPaper = ({ papers, key }: { papers: readonly Paper[]; key: string }): Paper => {
  const first = papers[0] ?? "A4";
  try {
    const p = localStorage.getItem(key);
    return papers.find((x) => x === p) ?? first;
  } catch {
    return first; // storage blocked (a private window): the default every time
  }
};

// PRINT (issue #4, house decision #151): a PDF built in this browser from what the seat already holds, offered as a
// download and a link to open. Nothing is uploaded or stored on the server. A PDF, not the browser's print, so cards
// sit at true size and every device prints the same page.
export function PrintDialog({ label, ariaLabel, title, papers, paperKey, hint, file, breaks, make }: PrintDialogProps) {
  const t = useTranslations("print.dialog");
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [paper, setPaper] = useState<Paper>(papers[0] ?? "A4");
  const [broken, setBroken] = useState(false);
  const [built, setBuilt] = useState<Built>(null);
  const url = useRef<string | null>(null); // the built PDF's blob URL, freed on close or when a choice changes
  // Bumped by every reset: a build that ends after one belongs to choices the dialog no longer shows, so it's dropped.
  const generation = useRef(0);

  // Drops the built PDF: a new choice needs a new build.
  const reset = () => {
    generation.current++;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setBuilt(null);
  };

  // PRINT: opens the dialog on the paper this browser picked last.
  const handleOpen = () => {
    reset();
    setPaper(savedPaper({ papers, key: paperKey }));
    dialog.current?.showModal();
  };

  // A paper picked: remembered for next time, and the PDF built again.
  const handlePaper = (p: Paper) => {
    reset();
    setPaper(p);
    try {
      localStorage.setItem(paperKey, p);
    } catch {
      // the pick just isn't remembered
    }
  };

  // The page-break switch: the PDF built again.
  const handleBreaks = () => {
    reset();
    setBroken(!broken);
  };

  // BUILD PDF: the renderer and its face load here, on the first build only, so the app's bundle doesn't carry them.
  const handleBuild = async () => {
    const mine = generation.current;
    setBuilt("building");
    try {
      const { registerFontsOnce } = await import("@/components/print/fonts");
      registerFontsOnce(location.origin);
      const blob = await make({ paper, breaks: broken });
      if (mine !== generation.current) return; // a choice changed or the dialog closed while it built
      url.current = URL.createObjectURL(blob);
      setBuilt({ url: url.current });
    } catch (e) {
      if (mine === generation.current) setBuilt({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <button type="button" className="btn sm" aria-label={ariaLabel} onClick={handleOpen}>
        {label}
      </button>
      <dialog ref={dialog} className="ledger-confirm" aria-labelledby={titleId} onClose={reset}>
        <div className="stack">
          <div className="row between">
            <h2 className="head" id={titleId}>
              {title}
            </h2>
            <button type="button" className="btn sm" onClick={() => dialog.current?.close()}>
              {t("close")}
            </button>
          </div>
          {papers.length > 1 && (
            <div className="row" role="group" aria-label={t("paper")}>
              <span className="small">{t("paper")}</span>
              {papers.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="btn sm"
                  aria-pressed={paper === p}
                  onClick={() => handlePaper(p)}
                >
                  {t(`papers.${p}`)}
                </button>
              ))}
            </div>
          )}
          {breaks && (
            <label className="row" style={{ minHeight: 44 }}>
              <input type="checkbox" checked={broken} onChange={handleBreaks} style={{ minHeight: 24 }} />
              {breaks}
            </label>
          )}
          <p className="small">{hint}</p>
          <div className="row">
            {built && typeof built === "object" && "url" in built ? (
              <>
                {/* Links the reader taps: iPad Safari blocks a window opened after an await. */}
                <a className="btn primary" href={built.url} download={file}>
                  {t("download")}
                </a>
                <a className="btn" href={built.url} target="_blank" rel="noopener">
                  {t("open")}
                </a>
              </>
            ) : (
              <button type="button" className="btn primary" disabled={built === "building"} onClick={handleBuild}>
                {built === "building" ? t("building") : t("build")}
              </button>
            )}
          </div>
          {built && typeof built === "object" && "error" in built && (
            <p className="error" role="alert">
              {t("failed", { error: built.error })}
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
