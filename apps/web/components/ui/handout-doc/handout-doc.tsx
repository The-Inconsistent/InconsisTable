"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry, HandoutLayout } from "@inconsistable/core-schema";

import { MentionText } from "@/components/ui/mention-text/mention-text";
import { transcriptLines } from "@/lib/handout/handout";

type HandoutDocProps = {
  layout: HandoutLayout;
  /** The line above the body; "" draws none. */
  header: string;
  /** The handout's name: the document's accessible name (the page around it shows the title itself). */
  title: string;
  body: string;
  /** The entries this seat holds, for the mentions in the body. */
  entries: readonly CodexEntry[];
  /** Opens a mentioned entry; without it (the TV) a mention is a mark. */
  onOpen?: (entryId: string) => void;
};

// A handout drawn in its layout (house decision #72), with the room's Theme: every seat that reads a handout reads it
// through this. The body keeps its line breaks and mentions, and grows with the page; nothing scrolls inside it.
// `plain` is the body alone on the surface it lies on; the other four are a sheet of paper in both colour sets.
export function HandoutDoc({ layout, header, title, body, entries, onOpen }: HandoutDocProps) {
  const t = useTranslations("handout");
  const head = header.trim();
  const text = (b: string) => <MentionText body={b} entries={entries} onOpen={onOpen} />;
  const paper = layout === "plain" ? "handout" : "handout parchment";
  const headLine = head && <p className="handout-head">{head}</p>;

  if (layout === "transcript") {
    const lines = transcriptLines(body);
    return (
      <article className={paper} data-layout={layout} aria-label={title}>
        {headLine}
        <div className="handout-noise" aria-hidden />
        <div className="handout-lines" data-stamped={lines.some((l) => l.stamp !== null) || undefined}>
          {lines.map((l, i) => (
            <p key={i} className="handout-line">
              {l.stamp !== null && <span className="handout-stamp">{l.stamp}</span>}
              <span className="handout-said">{text(l.text)}</span>
            </p>
          ))}
        </div>
        <div className="handout-noise" aria-hidden />
      </article>
    );
  }
  return (
    <article className={paper} data-layout={layout} aria-label={title}>
      {layout === "form" ? (
        <div className="handout-bar">
          <p className="handout-head">{head}</p>
          <span className="handout-box" aria-hidden />
        </div>
      ) : (
        layout !== "plain" && headLine
      )}
      <p className="handout-text">{text(body)}</p>
      {layout === "proclamation" && (
        <div className="handout-foot">
          <svg className="handout-seal" viewBox="0 0 52 52" aria-hidden>
            <circle cx="26" cy="26" r="21" strokeWidth="6" strokeDasharray="3 2.2" />
            <circle cx="26" cy="26" r="13" className="handout-seal-ring" />
          </svg>
          <span className="handout-sign">{t("signed")}</span>
        </div>
      )}
    </article>
  );
}
