"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import type { ActionInput, Actor, CodexEntry } from "@inconsistable/core-schema";

import { FloatingSheet } from "@/components/ui/bottom-sheet/bottom-sheet";

type ShowButtonProps = {
  entry: CodexEntry;
  /** The room's characters, to show it to some of them only. */
  characters: readonly Actor[];
  act: (a: ActionInput) => Promise<{ ok: boolean }>;
};

// SHOW (#2, house decision #139): puts the entry full-screen in front of the table, everyone or the ticked characters,
// which reveals it to them for good. A new SHOW replaces the one up.
export function ShowButton({ entry, characters, act }: ShowButtonProps) {
  const t = useTranslations("spotlight");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);

  // Sends the SHOW to the audience chosen ([] for everyone) and puts the chooser away once it is up.
  const show = async (audience: string[]) => {
    setBusy(true);
    const r = await act({ type: "spotlight.show", entryId: entry.id, audience });
    setBusy(false);
    if (r.ok) setOpen(false);
  };
  // A character's tick: adds it to the audience or takes it out.
  const handlePick = (e: ChangeEvent<HTMLInputElement>) => {
    const next = new Set(picked);
    if (!next.delete(e.target.value)) next.add(e.target.value);
    setPicked(next);
  };

  return (
    <>
      <button
        className="btn sm"
        aria-haspopup="dialog"
        aria-label={t("showLabel", { title: entry.title })}
        onClick={() => setOpen(true)}
      >
        {t("show")}
      </button>
      {open && (
        <FloatingSheet title={t("showLabel", { title: entry.title })} onClose={() => setOpen(false)}>
          <button className="btn primary" disabled={busy} aria-busy={busy} onClick={() => show([])}>
            {t("everyone")}
          </button>
          {characters.length > 0 && (
            <fieldset className="stack">
              <legend className="small dim">{t("only")}</legend>
              {characters.map((c) => (
                <label key={c.id} className="row" style={{ minHeight: 44 }}>
                  <input type="checkbox" value={c.id} checked={picked.has(c.id)} onChange={handlePick} />
                  {c.name}
                </label>
              ))}
              <button
                className="btn"
                disabled={busy || picked.size === 0}
                aria-busy={busy}
                onClick={() => show([...picked])}
              >
                {t("toThem", { count: picked.size })}
              </button>
            </fieldset>
          )}
        </FloatingSheet>
      )}
    </>
  );
}
