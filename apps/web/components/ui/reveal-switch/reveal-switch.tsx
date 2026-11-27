"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ActionInput, CodexEntry } from "@inconsistable/core-schema";

import { useVisibilities } from "@/lib/table-mode/table-mode";

type RevealSwitchProps = {
  entry: CodexEntry;
  act: (a: ActionInput) => Promise<{ ok: boolean }>;
  disabled?: boolean;
  /** An entry shown to listed characters: its reach is changed in the reveal form, which this opens. */
  onListed?: () => void;
};

// SHOW / SEAL: one tap makes the entry visible to the whole party or hides it from every seat again, as a `codex.reveal`
// does. Finer audiences (the listed characters, the public) stay in the codex editor's reveal form, and a listed entry's
// button opens it. A room without a GM has no way back to `gm` (house decision #137). The state is a word and a mark,
// and the button names the action it will do.
export function RevealSwitch({ entry, act, disabled = false, onListed }: RevealSwitchProps) {
  const t = useTranslations("scene.reveal");
  const [busy, setBusy] = useState(false);
  const canSeal = useVisibilities(["gm"]).length > 0;
  const shown = entry.visibility !== "gm";
  const listed = shown && entry.audienceMode === "listed" && onListed !== undefined;

  // Sends the opposite of what the entry is now: the party sees it, or nobody does.
  const handleToggle = async () => {
    setBusy(true);
    await act({
      type: "codex.reveal",
      id: entry.id,
      visibility: shown ? "gm" : "party",
      audienceMode: "all",
      audience: [],
    });
    setBusy(false);
  };

  return (
    <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
      <span className="chip" data-state={shown ? "on" : undefined}>
        <span aria-hidden="true">{shown ? "●" : "○"}</span> {shown ? t("shown") : t("sealed")}
      </span>
      {listed ? (
        <button className="btn sm" aria-label={t("readersName", { name: entry.title })} onClick={onListed}>
          {t("readers")}
        </button>
      ) : (
        (!shown || canSeal) && (
          <button
            className="btn"
            aria-label={t(shown ? "sealName" : "showName", { name: entry.title })}
            aria-busy={busy}
            disabled={disabled || busy}
            onClick={handleToggle}
          >
            {shown ? t("seal") : t("show")}
          </button>
        )
      )}
    </span>
  );
}
