"use client";
import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { SchemeSwitch } from "@/components/ui/scheme-switch/scheme-switch";
import { THEMES, rememberTheme, type AppTheme } from "@/lib/theme/theme";

// The Theme on the root class, kept in sync with it; unknown (nothing pressed) before hydration.
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
};
const renderedTheme = (): AppTheme => (document.documentElement.classList.contains("theme-felt") ? "felt" : "lantern");

// The colour sets of the World the page wears ("light dark", "light" or "dark"), or null on a page without one.
const subscribeWorld = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { subtree: true, attributeFilter: ["data-schemes"] });
  return () => observer.disconnect();
};
const worldSchemes = () => document.querySelector("[data-world]")?.getAttribute("data-schemes") ?? null;

// LANTERN | FELT: the device's Theme. Like the language, it lives in a cookie the server reads; the root class flips at
// once and the refresh keeps the server render in step. In a room that wears a World the World is the look, so the
// switch gives its place to the World's colour sets (nothing, when the World brings one).
export function ThemeSwitch() {
  const t = useTranslations("themeSwitch");
  const router = useRouter();
  const current = useSyncExternalStore(subscribe, renderedTheme, () => null);
  const schemes = useSyncExternalStore(subscribeWorld, worldSchemes, () => null);

  const handlePick = (theme: AppTheme) => {
    rememberTheme(theme);
    document.documentElement.classList.toggle("theme-felt", theme === "felt");
    router.refresh();
  };

  if (schemes !== null) return schemes.includes(" ") ? <SchemeSwitch /> : null;
  return (
    <span className="seg" role="group" aria-label={t("label")}>
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
