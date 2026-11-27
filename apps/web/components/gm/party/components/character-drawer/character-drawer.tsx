"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Actor } from "@inconsistable/core-schema";

import { DRAWER_TABS, type DrawerTab } from "./constants";

type CharacterDrawerProps = {
  actor: Actor;
  /** The card's line, who plays it and its rank, as the sub-line. */
  line: string | null;
  /** Who plays it ("Played by Ana", "Open seat"). */
  seat: string;
  /** "Rank 2"-like, from its XP; null when the ruleset keeps none. */
  rank: string | null;
  /** The ADVANCE tab's count ("12 XP"), or null. */
  xp: string | null;
  /** Each tab's body; a tab without one is not drawn. */
  tabs: Partial<Record<DrawerTab, ReactNode>>;
  error: string | null;
  onClose: () => void;
};

// The character drawer (house decision #222, as Auspex's dossier): one panel from the right edge with the character's
// name, a sub-line, and its tabs. Like the bottom sheet it has no backdrop and holds no focus, so the table stays in reach;
// focus goes to CLOSE when it opens and back to the card when it closes, and Escape puts it away.
export function CharacterDrawer({ actor, line, seat, rank, xp, tabs, error, onClose }: CharacterDrawerProps) {
  const t = useTranslations("party");
  const [tab, setTab] = useState<DrawerTab>("status");
  const close = useRef<HTMLButtonElement>(null);
  const [trigger] = useState(() => (typeof document === "undefined" ? null : document.activeElement));
  // External system: the document's focus, into the drawer and back to the card that opened it.
  useEffect(() => {
    close.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [trigger]);
  // External system: the document's keys. Escape closes the drawer wherever focus is (a button that went away leaves it
  // on the page); a sheet above it stops its own Escape first.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  const shown = DRAWER_TABS.filter((id) => tabs[id] !== undefined);
  const current = shown.includes(tab) ? tab : (shown[0] ?? "status");
  const sub = [line, seat, rank].filter(Boolean).join(" · ");
  const label = (id: DrawerTab) => (id === "advance" && xp ? t("drawer.advanceXp", { xp }) : t(`drawer.${id}`));

  return (
    <aside className="party-drawer" role="dialog" aria-label={actor.name}>
      <header className="party-drawer-head">
        <h2 className="head">{actor.name}</h2>
        <p className="small">{sub}</p>
        <nav className="tabs" role="tablist" aria-label={t("drawer.tabs", { name: actor.name })}>
          {shown.map((id) => (
            <button key={id} className="tab" role="tab" aria-selected={current === id} onClick={() => setTab(id)}>
              {label(id)}
            </button>
          ))}
        </nav>
      </header>
      <div className="party-drawer-body stack" role="tabpanel" aria-label={label(current)}>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {tabs[current]}
      </div>
      <footer className="party-drawer-foot">
        <button ref={close} className="btn" onClick={onClose} aria-label={t("drawer.closeLabel", { name: actor.name })}>
          {t("drawer.close")}
        </button>
      </footer>
    </aside>
  );
}
