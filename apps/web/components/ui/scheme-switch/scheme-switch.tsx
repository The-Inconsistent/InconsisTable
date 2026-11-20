"use client";
import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { COLOUR_SCHEMES, rememberScheme, resolveScheme, type ColourScheme } from "@/lib/theme/theme";

// The colour set on the root's data-scheme, kept in sync with it; unknown (nothing pressed) before hydration.
const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-scheme"] });
  return () => observer.disconnect();
};
const renderedScheme = (): ColourScheme => resolveScheme(document.documentElement.dataset.scheme);

// SYSTEM | LIGHT | DARK: which of a World's two colour sets this device shows. It lives in a cookie the server reads, so
// the first paint is right; the root's attribute flips at once and the refresh keeps the server render in step.
export function SchemeSwitch() {
  const t = useTranslations("world.scheme");
  const router = useRouter();
  const current = useSyncExternalStore(subscribe, renderedScheme, () => null);

  // Holds the pick on this device and shows it at once.
  const handlePick = (scheme: ColourScheme) => {
    rememberScheme(scheme);
    if (scheme === "system") document.documentElement.removeAttribute("data-scheme");
    else document.documentElement.setAttribute("data-scheme", scheme);
    router.refresh();
  };

  return (
    <span className="seg" role="group" aria-label={t("label")}>
      {COLOUR_SCHEMES.map((scheme) => (
        <button
          key={scheme}
          type="button"
          className="btn sm"
          aria-pressed={current === scheme}
          onClick={() => handlePick(scheme)}
        >
          {t(`name.${scheme}`)}
        </button>
      ))}
    </span>
  );
}
