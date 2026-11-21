"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { LiveState } from "@inconsistable/core-schema";

import { WhisperPanel } from "@/components/gm/whisper-button/components/whisper-panel/whisper-panel";
import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import type { Send } from "@/hooks/use-table/use-table";
import { replyKeys } from "@/lib/whispers/whispers";

type WhisperButtonProps = { campaignId: string; state: LiveState; send: Send };

// The replies this tablet has shown, kept in its storage so a reload keeps the count (house decision #93).
const storageKey = (campaignId: string) => `it:whisper-replies:${campaignId}`;
const storedSeen = (campaignId: string): ReadonlySet<string> => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey(campaignId)) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
};

// WHISPER in the GM's header: opens the panel, and counts the replies this tablet has not shown yet.
export function WhisperButton({ campaignId, state, send }: WhisperButtonProps) {
  const t = useTranslations("whisper");
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => storedSeen(campaignId));
  const keys = replyKeys(state.whispers);
  // The open panel shows every reply, so it counts none.
  const unseen = open ? 0 : keys.filter((k) => !seen.has(k)).length;

  // Every reply on the list now counts as shown: on opening, and again on closing for those that came in meanwhile.
  const markSeen = () => {
    setSeen(new Set(keys));
    try {
      localStorage.setItem(storageKey(campaignId), JSON.stringify(keys));
    } catch {
      // No storage: the count resets when the page reloads.
    }
  };
  const handleOpen = () => {
    markSeen();
    setOpen(true);
  };
  const handleClose = () => {
    markSeen();
    setOpen(false);
  };

  return (
    <>
      <button
        className={unseen > 0 ? "btn primary" : "btn"}
        aria-label={t("openLabel", { count: unseen })}
        aria-expanded={open}
        onClick={open ? handleClose : handleOpen}
      >
        {unseen > 0 ? t("openUnseen", { count: unseen }) : t("open")}
      </button>
      {open && (
        <BottomSheet title={t("title")} onClose={handleClose}>
          <WhisperPanel state={state} send={send} />
        </BottomSheet>
      )}
    </>
  );
}
