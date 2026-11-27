"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

// How long the TV keeps the card up when nobody is there to dismiss it.
const TV_MS = 30_000;

type XCardOverlayProps = {
  signal: number;
  tv?: boolean;
  /** When it comes down (dismissed, or let go on the TV): a spotlight yields to it until then. */
  onClose?: () => void;
};

// The X-Card, full screen: it names no one, because the event carries no one. Every touch (`signal` counts them) opens
// it; a phone or tablet dismisses it, the TV (no input) lets it go by itself.
export function XCardOverlay({ signal, tv = false, onClose }: XCardOverlayProps) {
  const t = useTranslations("safety.card");
  const dialog = useRef<HTMLDialogElement>(null);
  // External system: the dialog element's top layer.
  useEffect(() => {
    const el = dialog.current;
    if (signal === 0 || !el) return;
    if (!el.open) el.showModal();
    if (!tv) return;
    const timer = setTimeout(() => el.close(), TV_MS);
    return () => clearTimeout(timer);
  }, [signal, tv]);
  return (
    <dialog ref={dialog} className="xcard" data-tv={tv || undefined} aria-labelledby="xcard-title" onClose={onClose}>
      <span className="xcard-mark" aria-hidden="true">
        X
      </span>
      <h2 id="xcard-title" className="xcard-title">
        {t("title")}
      </h2>
      <p className="xcard-text">{t("text")}</p>
      {!tv && (
        <form method="dialog">
          <button className="btn xcard-close" autoFocus>
            {t("dismiss")}
          </button>
        </form>
      )}
    </dialog>
  );
}
