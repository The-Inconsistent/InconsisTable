"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { saveFromRoom } from "@/lib/character-library/character-library";

// SAVE TO MY LIBRARY (house decision #104): a copy of the character this seat plays, saved build and all, for another
// room; the room's character stays the room's.
export function SaveToLibrary({ campaignId, actorId }: { campaignId: string; actorId: string }) {
  const t = useTranslations("characterLibrary.save");
  const tr = useRefusal();
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSave = async () => {
    setBusy(true);
    const r = await saveFromRoom(campaignId, actorId);
    setBusy(false);
    setLine(r.ok ? { ok: true, text: t("saved") } : { ok: false, text: r.error ? tr(r.error) : t("failed") });
  };
  return (
    <section className="stack">
      <div className="row">
        <button type="button" className="btn" onClick={handleSave} disabled={busy} aria-busy={busy}>
          {t("button")}
        </button>
      </div>
      {line && (
        <p className={line.ok ? "small" : "error"} role={line.ok ? "status" : "alert"}>
          {line.text}
        </p>
      )}
    </section>
  );
}
