"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import { LocaleSwitch } from "@/components/ui/locale-switch/locale-switch";
import { ThemeSwitch } from "@/components/ui/theme-switch/theme-switch";

// The table's settings, one tap away in the header band and folded away otherwise, so it takes the room of a single
// button. Today it holds the language of this device; it closes on Escape or a tap anywhere else.
export function SettingsMenu() {
  const t = useTranslations("settingsMenu");
  const menu = useRef<HTMLDetailsElement>(null);

  // Syncs with the page: a tap outside, or Escape, folds the menu.
  useEffect(() => {
    const close = (e: Event) => {
      const el = menu.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={menu} className="menu">
      <summary className="btn" aria-label={t("label")}>
        <span aria-hidden="true">⋯</span>
      </summary>
      <div className="menu-pop card">
        <span className="small dim">{t("language")}</span>
        <LocaleSwitch />
        <ThemeSwitch />
      </div>
    </details>
  );
}
