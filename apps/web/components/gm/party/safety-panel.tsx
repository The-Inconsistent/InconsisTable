"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { MAX_SAFETY_ITEMS, SAFETY_LINE_MAX, type Safety } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";

type SafetyPanelProps = { safety: Safety; send: Send };

const toLines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

// SAFETY (Session Zero): the table's lines and veils, one per line, and the X-Card's switch. Suggestions from the phones
// arrive in the same lists, with no name, so the form follows the table until the one editing it starts typing.
export function SafetyPanel({ safety, send }: SafetyPanelProps) {
  const t = useTranslations("safety.panel");
  const fromTable = { lines: safety.lines.join("\n"), veils: safety.veils.join("\n"), xCard: safety.xCard };
  const key = JSON.stringify(fromTable);
  const [draft, setDraft] = useState(fromTable);
  const [seen, setSeen] = useState(key);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (seen !== key && !dirty) {
    setSeen(key);
    setDraft(fromTable);
  }
  const lines = toLines(draft.lines);
  const veils = toLines(draft.veils);
  const tooMany = lines.length > MAX_SAFETY_ITEMS || veils.length > MAX_SAFETY_ITEMS;
  const tooLong = [...lines, ...veils].some((l) => l.length > SAFETY_LINE_MAX);

  const edit = (patch: Partial<typeof draft>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
  };
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const r = await send({ type: "campaign.setSafety", lines, veils, xCard: draft.xCard });
    setError(r.ok ? null : r.error);
    if (r.ok) {
      setDirty(false);
      setSeen(JSON.stringify({ lines: lines.join("\n"), veils: veils.join("\n"), xCard: draft.xCard }));
    }
  };

  return (
    <form className="stack" onSubmit={handleSave}>
      <h2 className="head">{t("title")}</h2>
      <p className="dim small">{t("hint", { items: MAX_SAFETY_ITEMS, chars: SAFETY_LINE_MAX })}</p>
      <label className="stack">
        {t("lines")}
        <textarea rows={4} value={draft.lines} onChange={(e) => edit({ lines: e.target.value })} />
      </label>
      <label className="stack">
        {t("veils")}
        <textarea rows={4} value={draft.veils} onChange={(e) => edit({ veils: e.target.value })} />
      </label>
      <label className="row">
        <input type="checkbox" checked={draft.xCard} onChange={(e) => edit({ xCard: e.target.checked })} />
        {t("xCard")}
      </label>
      {(tooMany || tooLong) && (
        <p className="error" role="alert">
          {tooMany ? t("tooMany", { items: MAX_SAFETY_ITEMS }) : t("tooLong", { chars: SAFETY_LINE_MAX })}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" disabled={!dirty || tooMany || tooLong} style={{ justifySelf: "start" }}>
        {t("save")}
      </button>
    </form>
  );
}
