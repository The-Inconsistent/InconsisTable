"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import {
  AudienceMode,
  CodexVisibility,
  type ActionInput,
  type Actor,
  type CodexEntry,
} from "@inconsistable/core-schema";

import { AUDIENCE_MAX } from "@/lib/codex/codex";

type RevealFormProps = {
  entry: CodexEntry;
  characters: readonly Actor[];
  act: (a: ActionInput) => Promise<{ ok: boolean }>;
};

// REVEAL: who sees the entry's body: nobody (gm), the party or the public, and either everyone at that level or
// only the ticked characters. The server clamps it; the form only asks.
export function RevealForm({ entry, characters, act }: RevealFormProps) {
  const t = useTranslations("codex");
  const [visibility, setVisibility] = useState<CodexVisibility>(entry.visibility);
  const [mode, setMode] = useState<AudienceMode>(entry.audienceMode);
  const [audience, setAudience] = useState<string[]>(entry.audience);
  const listed = visibility !== "gm" && mode === "listed";

  // Visibility picker; only a value from the closed set is taken.
  const handleVisibility = (e: ChangeEvent<HTMLSelectElement>) => {
    const v = CodexVisibility.safeParse(e.target.value);
    if (v.success) setVisibility(v.data);
  };

  // Audience picker: everyone, or the listed characters.
  const handleMode = (e: ChangeEvent<HTMLSelectElement>) => {
    const m = AudienceMode.safeParse(e.target.value);
    if (m.success) setMode(m.data);
  };

  // One character ticked or unticked, up to the listed limit.
  const handleReader = (id: string) => () =>
    setAudience(
      audience.includes(id)
        ? audience.filter((x) => x !== id)
        : audience.length < AUDIENCE_MAX
          ? [...audience, id]
          : audience,
    );

  // REVEAL sends the choice; a hidden entry or an open audience carries no list.
  const handleReveal = async () => {
    await act({
      type: "codex.reveal",
      id: entry.id,
      visibility,
      audienceMode: visibility === "gm" ? "all" : mode,
      audience: listed ? audience : [],
    });
  };

  return (
    <fieldset className="stack">
      <legend className="head">{t("reveal")}</legend>
      <div className="row">
        <select id="codex-visibility" aria-label={t("visibilityLabel")} value={visibility} onChange={handleVisibility}>
          {CodexVisibility.options.map((v) => (
            <option key={v} value={v}>
              {t(`visibility.${v}`)}
            </option>
          ))}
        </select>
        {visibility !== "gm" && (
          <select id="codex-audience" aria-label={t("audienceLabel")} value={mode} onChange={handleMode}>
            {AudienceMode.options.map((m) => (
              <option key={m} value={m}>
                {t(`audience.${m}`)}
              </option>
            ))}
          </select>
        )}
      </div>
      {listed && (
        <div className="row" role="group" aria-label={t("readers")}>
          {characters.length === 0 && <span className="dim">{t("noCharacters")}</span>}
          {characters.map((c) => (
            // The whole label is the touch target (44px); the box itself stays small.
            <label key={c.id} className="row small" style={{ gap: 4, minHeight: 44 }}>
              <input
                type="checkbox"
                id={`codex-reader-${c.id}`}
                checked={audience.includes(c.id)}
                onChange={handleReader(c.id)}
                style={{ minHeight: 24 }}
              />
              {c.name}
            </label>
          ))}
        </div>
      )}
      <button className="btn primary" onClick={handleReveal}>
        {t("revealButton")}
      </button>
    </fieldset>
  );
}
