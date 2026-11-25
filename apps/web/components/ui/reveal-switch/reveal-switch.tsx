"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ActionInput, CodexEntry } from "@inconsistable/core-schema";

type RevealSwitchProps = {
  entry: CodexEntry;
  act: (a: ActionInput) => Promise<{ ok: boolean }>;
  disabled?: boolean;
};

// SHOW / SEAL: one tap makes the entry visible to the whole party or hides it from every seat again, as a `codex.reveal`
// does. Finer audiences (the listed characters, the public) stay in the codex editor's reveal form. The state is a word
// and a mark, and the button names the action it will do.
export function RevealSwitch({ entry, act, disabled = false }: RevealSwitchProps) {
  const t = useTranslations("scene.reveal");
  const [busy, setBusy] = useState(false);
  const shown = entry.visibility !== "gm";

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
      <button
        className="btn"
        aria-label={t(shown ? "sealName" : "showName", { name: entry.title })}
        aria-busy={busy}
        disabled={disabled || busy}
        onClick={handleToggle}
      >
        {shown ? t("seal") : t("show")}
      </button>
    </span>
  );
}
