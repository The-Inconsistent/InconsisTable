"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";

type BottomSheetProps = { title: string; onClose: () => void; children: ReactNode };
type SheetProps = BottomSheetProps & { closeRef?: Ref<HTMLButtonElement> };

// A panel that rises from the bottom edge. It never covers the page with a backdrop or holds focus: the table stays
// in reach behind it, and the close button (or Escape) puts it away.
export function BottomSheet({ title, onClose, children, closeRef }: SheetProps) {
  const t = useTranslations("bottomSheet");
  // Escape puts the panel away.
  const handleKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation(); // a sheet opened from inside another (a page from a term card) goes alone
    onClose();
  };
  return (
    <aside className="bottom-sheet" role="dialog" aria-label={title} onKeyDown={handleKey}>
      <div className="row between">
        <h2 className="head">{title}</h2>
        <button ref={closeRef} className="btn" onClick={onClose} aria-label={t("closeLabel", { title })}>
          {t("close")}
        </button>
      </div>
      {children}
    </aside>
  );
}

// The same panel mounted on the table's surface instead of in place. Opened from inside a card or a combatant row, which
// are transformed or filtered and so would pin a fixed child to themselves, not to the screen. The surface (not the
// body) keeps the World's and the table's look. Only rendered after a tap, so `document` exists: focus moves to its
// close button, so Escape reaches it, and goes back to what was tapped when it closes.
export function FloatingSheet(props: BottomSheetProps) {
  const close = useRef<HTMLButtonElement>(null);
  const [trigger] = useState(() => document.activeElement);
  // External system: the document's focus, into the sheet and back to its trigger.
  useEffect(() => {
    close.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [trigger]);
  return createPortal(
    <BottomSheet {...props} closeRef={close} />,
    document.querySelector(".surface-table") ?? document.body,
  );
}
