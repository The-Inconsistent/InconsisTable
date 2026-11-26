"use client";
import { useTranslations } from "next-intl";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

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

// The same panel mounted on the table's surface instead of in place. Opened from inside a card or a combatant row, which
// are transformed or filtered and so would pin a fixed child to themselves, not to the screen. The surface (not the
// body) keeps the World's and the table's look. Only rendered after a tap, so `document` exists.
export function FloatingSheet(props: BottomSheetProps) {
  return createPortal(<BottomSheet {...props} />, document.querySelector(".surface-table") ?? document.body);
}
