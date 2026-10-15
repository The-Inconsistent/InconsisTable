"use client";
import { useTranslations } from "next-intl";
import type { KeyboardEvent, ReactNode } from "react";

type BottomSheetProps = { title: string; onClose: () => void; children: ReactNode };

// A panel that rises from the bottom edge. It never covers the page with a backdrop or holds focus: the table stays
// in reach behind it, and the close button (or Escape) puts it away.
export function BottomSheet({ title, onClose, children }: BottomSheetProps) {
  const t = useTranslations("bottomSheet");
  // Escape puts the panel away.
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };
  return (
    <aside className="bottom-sheet" role="dialog" aria-label={title} onKeyDown={handleKey}>
      <div className="row between">
        <h2 className="head">{title}</h2>
        <button className="btn" onClick={onClose} aria-label={t("closeLabel", { title })}>
          {t("close")}
        </button>
      </div>
      {children}
    </aside>
  );
}
