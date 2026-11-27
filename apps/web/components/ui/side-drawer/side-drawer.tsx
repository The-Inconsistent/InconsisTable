"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

type SideDrawerProps = {
  /** The dialog's name. */
  label: string;
  /** The head's content: a heading, a sub-line, tabs or a picker. */
  head: ReactNode;
  /** The body: the caller's `.side-drawer-body`, which scrolls. */
  children: ReactNode;
  /** Buttons in the foot, before CLOSE. */
  actions?: ReactNode;
  /** CLOSE's accessible name, naming what it closes. */
  closeLabel: string;
  onClose: () => void;
  /** A sheet opened from the drawer is up: Escape is that sheet's, not the drawer's. */
  paused?: boolean;
};

// The side drawer (house decision #222, as Auspex's dossier): one parchment panel from the right edge with a head, a
// body and a foot. Like the bottom sheet it has no backdrop and holds no focus, so the table stays in reach; focus goes to
// CLOSE when it opens and back to what opened it when it closes, and Escape puts it away.
export function SideDrawer({ label, head, children, actions, closeLabel, onClose, paused = false }: SideDrawerProps) {
  const t = useTranslations("bottomSheet");
  const close = useRef<HTMLButtonElement>(null);
  const [trigger] = useState(() => (typeof document === "undefined" ? null : document.activeElement));
  // External system: the document's focus, into the drawer and back to what opened it.
  useEffect(() => {
    close.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [trigger]);
  // External system: the document's keys. Escape closes the drawer wherever focus is (a button that went away leaves it
  // on the page), unless a sheet opened from it is up; a sheet above it stops its own Escape first.
  const closeRef = useRef(onClose);
  const pausedRef = useRef(paused);
  useEffect(() => {
    closeRef.current = onClose;
    pausedRef.current = paused;
  });
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pausedRef.current) closeRef.current();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <aside className="side-drawer" role="dialog" aria-label={label}>
      <header className="side-drawer-head">{head}</header>
      {children}
      <footer className="side-drawer-foot">
        {actions}
        <button ref={close} className="btn" onClick={onClose} aria-label={closeLabel}>
          {t("close")}
        </button>
      </footer>
    </aside>
  );
}
