"use client";
import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { THEMES, applyTheme, rememberTheme, themeOf, type AppTheme } from "@/lib/theme/theme";

// The Theme on the root class, kept in sync with it; unknown (nothing pressed) before hydration.
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
};
const renderedTheme = (): AppTheme => themeOf(document.documentElement.classList);

// LANTERN | FELT | VELVET: the device's Theme. Like the language, it lives in a cookie the server reads; the root class flips at
// once and the refresh keeps the server render in step.
export function ThemeSwitch() {
  const t = useTranslations("themeSwitch");
  const router = useRouter();
  const current = useSyncExternalStore(subscribe, renderedTheme, () => null);

  // Remembers the picked Theme, puts it on the page at once and re-renders the server side in step.
  const handlePick = (theme: AppTheme) => {
    rememberTheme(theme);
    applyTheme(theme);
    router.refresh();
  };

  return (
    <span className="seg seg-wrap" role="group" aria-label={t("label")}>
      {THEMES.map((theme) => (
        <button
          key={theme}
          type="button"
          className="btn sm"
          aria-pressed={current === theme}
          onClick={() => handlePick(theme)}
        >
          {t(`name.${theme}`)}
        </button>
      ))}
    </span>
  );
}
