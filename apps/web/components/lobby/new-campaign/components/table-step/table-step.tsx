"use client";
import { useTranslations } from "next-intl";

import { MAX_SAFETY_ITEMS, SAFETY_LINE_MAX, type TableMode } from "@inconsistable/core-schema";

import { toLines } from "@/lib/games/room-document";

/** The limits as typed: lines and veils one per line, and the X-Card's switch. */
export type SafetyDraft = { lines: string; veils: string; xCard: boolean };

type TableStepProps = {
  modes: readonly TableMode[];
  mode: TableMode;
  onMode: (mode: TableMode) => void;
  safety: SafetyDraft;
  onSafety: (safety: SafetyDraft) => void;
  /** The book's suggested lines to leave out (house decision #145), and their page. */
  examples: { lines: readonly string[]; cite: string | null };
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// TABLE: how the table sits, and what it leaves out, as the room's lines and veils (the safety panel's lists, here
// before the room exists). The book's suggested lines toggle in and out of the typed lines.
export function TableStep({ modes, mode, onMode, safety, onSafety, examples }: TableStepProps) {
  const t = useTranslations("newCampaign");
  const tPanel = useTranslations("safety.panel");
  const tLobby = useTranslations("lobby");
  const tModes = useTranslations("tableModes");
  const lines = toLines(safety.lines);
  const veils = toLines(safety.veils);
  const tooMany = lines.length > MAX_SAFETY_ITEMS || veils.length > MAX_SAFETY_ITEMS;
  const tooLong = [...lines, ...veils].some((l) => l.length > SAFETY_LINE_MAX);

  // A suggested line: in the lines when it is not there yet, out of them when it is.
  const handleExample = (line: string) => {
    const has = lines.some((l) => same(l, line));
    onSafety({ ...safety, lines: (has ? lines.filter((l) => !same(l, line)) : [...lines, line]).join("\n") });
  };

  return (
    <div className="stack">
      {modes.length > 1 && (
        <fieldset className="stack" style={{ border: 0, margin: 0, padding: 0 }}>
          <legend className="head">{tLobby("sits")}</legend>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {modes.map((m) => (
              <label key={m} className="row">
                <input type="radio" name="wizard-mode" checked={mode === m} onChange={() => onMode(m)} />
                {tModes(m)}
              </label>
            ))}
          </div>
          {mode !== "gm" && <p className="small dim">{tLobby("sitsHint")}</p>}
        </fieldset>
      )}
      <h3 className="head">{tPanel("title")}</h3>
      <p className="dim small">{t("limitsHint", { items: MAX_SAFETY_ITEMS, chars: SAFETY_LINE_MAX })}</p>
      {examples.lines.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="small">
            {t("examples")}
            {examples.cite && <span className="dim"> · {examples.cite}</span>}
          </span>
          <div className="row" role="group" aria-label={t("examples")} style={{ flexWrap: "wrap" }}>
            {examples.lines.map((line) => (
              <button
                key={line}
                type="button"
                className="btn sm"
                aria-pressed={lines.some((l) => same(l, line))}
                onClick={() => handleExample(line)}
              >
                {line}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="stack">
        {tPanel("lines")}
        <textarea rows={4} value={safety.lines} onChange={(e) => onSafety({ ...safety, lines: e.target.value })} />
      </label>
      <label className="stack">
        {tPanel("veils")}
        <textarea rows={3} value={safety.veils} onChange={(e) => onSafety({ ...safety, veils: e.target.value })} />
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={safety.xCard}
          onChange={(e) => onSafety({ ...safety, xCard: e.target.checked })}
        />
        {tPanel("xCard")}
      </label>
      {(tooMany || tooLong) && (
        <p className="error" role="alert">
          {tooMany ? tPanel("tooMany", { items: MAX_SAFETY_ITEMS }) : tPanel("tooLong", { chars: SAFETY_LINE_MAX })}
        </p>
      )}
    </div>
  );
}
