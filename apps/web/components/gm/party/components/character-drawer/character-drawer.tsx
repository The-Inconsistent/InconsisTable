"use client";
import { useTranslations } from "next-intl";
import { useId, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import type { Actor } from "@inconsistable/core-schema";

import { SideDrawer } from "@/components/ui/side-drawer/side-drawer";

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
  /** A sheet opened from the drawer (a QR, a whisper) is up: Escape is that sheet's, not the drawer's. */
  paused?: boolean;
};

// The character drawer (house decision #222, as Auspex's dossier): the side drawer with the character's name, a
// sub-line, and its tabs.
export function CharacterDrawer({
  actor,
  line,
  seat,
  rank,
  xp,
  tabs,
  error,
  onClose,
  paused = false,
}: CharacterDrawerProps) {
  const t = useTranslations("party");
  const ids = useId();
  const [tab, setTab] = useState<DrawerTab>("status");
  const shown = DRAWER_TABS.filter((id) => tabs[id] !== undefined);
  const current = shown.includes(tab) ? tab : (shown[0] ?? "status");
  const sub = [line, seat, rank].filter(Boolean).join(" · ");
  const label = (id: DrawerTab) => (id === "advance" && xp ? t("drawer.advanceXp", { xp }) : t(`drawer.${id}`));
  const tabId = (id: DrawerTab) => `${ids}-tab-${id}`;

  // ← and → move between the tabs, as a tablist's keys do; focus follows the tab picked.
  const handleTabKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    const next = shown[(shown.indexOf(current) + step + shown.length) % shown.length] ?? current;
    setTab(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <SideDrawer
      label={actor.name}
      closeLabel={t("drawer.closeLabel", { name: actor.name })}
      onClose={onClose}
      paused={paused}
      head={
        <>
          <h2 className="head">{actor.name}</h2>
          <p className="small">{sub}</p>
          <nav
            className="tabs"
            role="tablist"
            aria-label={t("drawer.tabs", { name: actor.name })}
            onKeyDown={handleTabKey}
          >
            {shown.map((id) => (
              <button
                key={id}
                id={tabId(id)}
                className="tab"
                role="tab"
                aria-selected={current === id}
                aria-controls={`${ids}-panel`}
                tabIndex={current === id ? 0 : -1}
                onClick={() => setTab(id)}
              >
                {label(id)}
              </button>
            ))}
          </nav>
        </>
      }
    >
      <div className="side-drawer-body stack" role="tabpanel" id={`${ids}-panel`} aria-labelledby={tabId(current)}>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {tabs[current]}
      </div>
    </SideDrawer>
  );
}
