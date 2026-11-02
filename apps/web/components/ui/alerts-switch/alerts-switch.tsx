"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

const KEY = "it-turn-alerts";
const QUIET = "quiet";

// Storage can throw (private mode, blocked site data); alerts then stay on for this page.
const stored = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
};

/** Whether this device buzzes and flashes when a turn starts (the root class, set from storage on load). */
export const turnAlertsOn = (): boolean => !document.documentElement.classList.contains(QUIET);

const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
};

// ON | OFF: the turn-start buzz and flash on this device. The "Your turn" banner itself always shows.
export function AlertsSwitch() {
  const t = useTranslations("alertsSwitch");
  const on = useSyncExternalStore(subscribe, turnAlertsOn, () => null);

  // Syncs with storage: the root class follows what this device chose last time.
  useEffect(() => {
    document.documentElement.classList.toggle(QUIET, !stored());
  }, []);

  const handlePick = (next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {}
    document.documentElement.classList.toggle(QUIET, !next);
  };

  return (
    <span className="seg" role="group" aria-label={t("label")}>
      {[true, false].map((value) => (
        <button
          key={String(value)}
          type="button"
          className="btn sm"
          aria-pressed={on === value}
          onClick={() => handlePick(value)}
        >
          {t(value ? "on" : "off")}
        </button>
      ))}
    </span>
  );
}
