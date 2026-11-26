"use client";
import { useTranslations } from "next-intl";
import { useRef, type ChangeEvent, type CSSProperties } from "react";

import type { BookSource } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import type { BookServer } from "@/hooks/use-book-server/use-book-server";

type BookShelfProps = { server: BookServer; sources: Ruleset["sources"] };

// BOOKS (house decision #147): this device's own PDFs of the room's sources. While serving, a seat that taps a cite in
// a loaded book sees that one page, drawn here; nothing is uploaded or kept, and it stops when this app closes.
export function BookShelf({ server, sources }: BookShelfProps) {
  const t = useTranslations("books");
  const { files, pick, serving, setServing, served } = server;
  const picker = useRef<HTMLInputElement>(null);
  // The source the open file dialog is for.
  const target = useRef<BookSource | null>(null);
  const loaded = sources.filter((s) => files[s.id]).length;

  // PICK PDF: opens the device's file dialog for this source.
  const handlePickFor = (source: BookSource) => {
    target.current = source;
    picker.current?.click();
  };
  // The file dialog's answer: that file becomes the source's book; the input is cleared so the same file can come again.
  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && target.current) pick(target.current, file);
    e.target.value = "";
  };

  if (sources.length === 0) return <p className="dim">{t("none")}</p>;
  return (
    <div className="stack" style={{ gap: 20, maxWidth: 720 }}>
      <section className="card stack">
        <div className="row">
          <button
            className={`btn ${serving ? "primary" : ""}`}
            aria-pressed={serving}
            disabled={!loaded && !serving}
            onClick={() => setServing(!serving)}
          >
            {serving ? t("stop") : t("start")}
          </button>
          <strong role="status">{serving && loaded ? t("serving", { books: loaded, pages: served }) : t("off")}</strong>
        </div>
        <p className="small">{t("intro")}</p>
      </section>
      <input ref={picker} type="file" accept="application/pdf" hidden onChange={handleFile} />
      <ul className="list rise-list" aria-label={t("listLabel")}>
        {sources.map((s, i) => {
          const file = files[s.id];
          return (
            <li key={s.id} style={{ "--i": i } as CSSProperties}>
              <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                <strong>{s.title}</strong>
                <span className="small dim" style={{ overflowWrap: "anywhere" }}>
                  {file ? t("loaded", { name: file.name }) : t("empty")}
                </span>
              </span>
              <span className="row">
                <button
                  className="btn sm"
                  onClick={() => handlePickFor(s.id)}
                  aria-label={t(file ? "replaceLabel" : "pickLabel", { title: s.title })}
                >
                  {file ? t("replace") : t("pick")}
                </button>
                {file && (
                  <button
                    className="btn sm"
                    onClick={() => pick(s.id, null)}
                    aria-label={t("removeLabel", { title: s.title })}
                  >
                    {t("remove")}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
