"use client";
import { useTranslations } from "next-intl";
import { useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { MAX_TAG_CHARS, MAX_TAGS, type CodexField } from "@inconsistable/rules-engine";

import { readEntries } from "@/hooks/use-pack-entry/use-pack-entry";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { tagSuggestions, tagToAdd, tagWord } from "@/lib/entry-fields/entry-fields";
import { rulesUrl } from "@/lib/rules-reader/rules-reader";

import { PICKER_ROWS } from "../../constants";

type TagsPickerProps = {
  id: string;
  def: Extract<CodexField, { type: "tags" }>;
  campaignId: string;
  value: readonly string[];
  disabled: boolean;
  onChange: (words: string[]) => void;
};

// A tags field in the GM's editor (house decision #89): the words as chips that remove on tap, and a box that offers the
// declared options and the names of the pack entries it suggests from, ranked exact, then starting with, then holding
// what was typed; a word of the GM's own when the field takes write-ins. Enter adds the suggestion spelled exactly so,
// else the write-in, never the first partial match.
export function TagsPicker({ id, def, campaignId, value, disabled, onChange }: TagsPickerProps) {
  const t = useTranslations("entryFields");
  const tr = useRefusal();
  const [q, setQ] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef("");
  const max = Math.min(def.maxItems ?? MAX_TAGS, MAX_TAGS);
  const full = value.length >= max;
  const suggestions = q.trim() === "" ? [] : tagSuggestions({ def, names, picked: value, q });
  const exact = tagToAdd({ def: { ...def, writeIn: false }, suggestions, q }) !== null;
  const writeIn = def.writeIn && q.trim() !== "" && !exact && !value.includes(q.trim()) ? q.trim() : null;

  // Typing asks the room's packs for entries of the suggested types by name; an answer to an older search is dropped.
  const handleType = async (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setQ(text);
    latest.current = text;
    if (text.trim() === "" || (def.entities ?? []).length === 0) return;
    try {
      const found = await Promise.all(
        (def.entities ?? []).map((type) =>
          readEntries({ url: rulesUrl({ campaignId, type, q: text, offset: 0 }), fallback: t("readFailed"), tr }),
        ),
      );
      if (latest.current !== text) return;
      setNames(found.flat().map((x) => x.name));
      setError(null);
    } catch (err) {
      if (latest.current === text) setError(err instanceof Error ? err.message : t("readFailed"));
    }
  };

  // One word added, and the box cleared.
  const add = (word: string) => {
    if (full || value.includes(word)) return;
    onChange([...value, word]);
    setQ("");
  };

  // Enter takes the suggestion spelled exactly as typed, else the write-in.
  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const word = tagToAdd({ def, suggestions, q });
    if (word !== null) add(word);
  };

  return (
    <div className="stack" style={{ minWidth: 0 }} data-field="tags">
      <span>{def.label}</span>
      {value.length > 0 && (
        <div className="row" role="group" aria-label={def.label}>
          {value.map((tag) => (
            <button
              key={tag}
              type="button"
              className="btn sm"
              disabled={disabled}
              aria-label={t("removeWord", { word: tagWord({ def, tag }) })}
              onClick={() => onChange(value.filter((x) => x !== tag))}
            >
              {tagWord({ def, tag })} ×
            </button>
          ))}
        </div>
      )}
      {!disabled && (
        <input
          id={id}
          value={q}
          onChange={handleType}
          onKeyDown={handleKey}
          disabled={full}
          maxLength={MAX_TAG_CHARS}
          aria-label={t("wordFor", { label: def.label })}
          placeholder={full ? t("wordsFull", { max }) : t("wordFor", { label: def.label })}
        />
      )}
      {error && <p className="error">{error}</p>}
      {!disabled && !full && (suggestions.length > 0 || writeIn) && (
        <div className="row" role="group" aria-label={t("suggestions", { label: def.label })}>
          {suggestions.slice(0, PICKER_ROWS).map((s) => (
            <button key={s.tag} type="button" className="btn sm" onClick={() => add(s.tag)}>
              {s.word}
            </button>
          ))}
          {writeIn && (
            <button type="button" className="btn sm" onClick={() => add(writeIn)}>
              {t("writeIn", { word: writeIn })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
