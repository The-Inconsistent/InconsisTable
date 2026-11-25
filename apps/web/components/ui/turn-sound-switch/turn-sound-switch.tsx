"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import { SOUND_CLASS, SOUND_KEY, turnSoundOn, unlockTone } from "@/lib/turn-tone/turn-tone";

// Storage can throw (private mode, blocked site data); the tone then stays off for this page.
const stored = (): boolean => {
  try {
    return localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
};

const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
  return () => observer.disconnect();
};

// ON | OFF beside the turn alerts: one short tone when a turn starts on this phone. Off until chosen.
export function TurnSoundSwitch() {
  const t = useTranslations("turnSoundSwitch");
  const on = useSyncExternalStore(subscribe, turnSoundOn, () => null);

  // Syncs with storage: the root class follows what this device chose last time.
  useEffect(() => {
    document.documentElement.classList.toggle(SOUND_CLASS, stored());
  }, []);

  // Picking is a tap, so it also unlocks the audio.
  const handlePick = (next: boolean) => {
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {}
    document.documentElement.classList.toggle(SOUND_CLASS, next);
    if (next) unlockTone();
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
