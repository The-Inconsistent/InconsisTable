"use client";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import type { BuildCatalogue, BuildParams } from "@inconsistable/rules-engine";

import { DRAFT_DELAY_MS } from "@/components/builder/constants";
import type { DraftNote } from "@/components/builder/ledger-build/constants";
import { LedgerBuilder } from "@/components/builder/ledger/ledger-builder";
import type { LedgerBuild, LedgerPlay } from "@/lib/ledger/ledger";

/** Where a build is kept: a room's `build.save` or the character library. `draft` is the autosave and its button. */
export type SaveBuild = (text: string, draft: boolean) => Promise<{ ok: true } | { ok: false; error: string }>;

export type LedgerFormProps = {
  params: BuildParams;
  catalogue: BuildCatalogue;
  initial: LedgerBuild;
  /** The Tier given from outside (the room's); none lets a GM-side builder pick it (the library's owner). */
  tier?: number | undefined;
  play?: LedgerPlay | undefined;
  gm: boolean;
  step?: string | null | undefined;
  save: SaveBuild;
  /** After a ready save went through: where the screen goes. */
  onSaved: () => void;
  /** The draft button's words, and what the save bar says once it went. */
  draftLabel: string;
  sentNote: string;
};

// The ledger builder with its save bar: every change kept as the draft a moment after the last one, the draft button
// keeping it now, and SAVE CHARACTER keeping it ready. Where it is kept is the caller's `save` (a room's socket or the
// character library), so the same builder serves both (house decision #104).
export function LedgerForm({
  params,
  catalogue,
  initial,
  tier,
  play,
  gm,
  step,
  save,
  onSaved,
  draftLabel,
  sentNote,
}: LedgerFormProps) {
  const t = useTranslations("ledgerBuilder.table");
  const [build, setBuild] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<DraftNote>("idle");
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The draft timer: a save still pending when the builder unmounts would fire after the player left.
  useEffect(() => () => clearTimeout(timer.current), []);
  // The build goes as the text JSON.stringify gives, keys in the order they were written (house decision #63).
  const sendDraft = useCallback((next: LedgerBuild) => save(JSON.stringify(next), true), [save]);
  const kept = useCallback((r: { ok: true } | { ok: false; error: string }, as: DraftNote) => {
    setNote(r.ok ? as : "off");
    setError(r.ok ? null : r.error);
  }, []);

  // A tap: keeps the next build, and saves it as the draft a moment after the last change.
  const handleChange = useCallback(
    (next: LedgerBuild) => {
      setBuild(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => kept(await sendDraft(next), "kept"), DRAFT_DELAY_MS);
    },
    [sendDraft, kept],
  );

  // SAVE CHARACTER: resolved again where it is kept and saved only when ready; then on, or its refusal.
  const handleSave = async () => {
    clearTimeout(timer.current);
    setBusy(true);
    const r = await save(JSON.stringify(build), false);
    setBusy(false);
    if (r.ok) return onSaved();
    setError(r.error);
  };

  // The draft button: the build as it stands, as the draft, now.
  const handleDraft = async () => {
    clearTimeout(timer.current);
    setBusy(true);
    const r = await sendDraft(build);
    setBusy(false);
    kept(r, "sent");
  };

  const noteText = { idle: "", kept: t("kept"), sent: sentNote, off: t("notKept") }[note];
  return (
    <>
      <LedgerBuilder
        params={params}
        catalogue={catalogue}
        build={build}
        onChange={handleChange}
        gm={gm}
        tier={tier === undefined ? undefined : (build.tier ?? tier)}
        play={play}
        step={step}
        footer={({ ready }) => (
          <>
            {error && (
              <p className="error lb-refusal" role="alert">
                {error}
              </p>
            )}
            <span className="small dim lb-note" role="status">
              {noteText}
            </span>
            {/* the primary last: the bottom right corner, under the thumb */}
            <span className="lb-buttons">
              <button type="button" className="btn" disabled={busy} onClick={handleDraft}>
                {draftLabel}
              </button>
              <button type="button" className="btn primary" disabled={busy || !ready} onClick={handleSave}>
                {t("save")}
              </button>
            </span>
          </>
        )}
      />
    </>
  );
}
