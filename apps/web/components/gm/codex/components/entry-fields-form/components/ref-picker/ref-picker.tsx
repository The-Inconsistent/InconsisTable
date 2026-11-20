"use client";
import { useTranslations } from "next-intl";
import { useRef, useState, type ChangeEvent } from "react";

import { readEntries } from "@/hooks/use-pack-entry/use-pack-entry";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import type { RulesEntry } from "@/lib/library/library";
import { rulesUrl } from "@/lib/rules-reader/rules-reader";

import { PICKER_ROWS } from "../../constants";

type RefPickerProps = {
  id: string;
  label: string;
  campaignId: string;
  /** The entity type the field names; only entries of it are offered. */
  entity: string;
  /** The picked entry's key, or null. */
  value: string | null;
  /** What to show for the picked key: its name when this seat has read it. */
  name: string | null;
  disabled: boolean;
  onPick: (entry: RulesEntry | null) => void;
  onOpen: () => void;
};

// A ref field in the GM's editor: a search over the entries of the field's type in the room's packs, as this seat reads
// them; the picked one shows with a way to open it and a way to clear it.
export function RefPicker({ id, label, campaignId, entity, value, name, disabled, onPick, onOpen }: RefPickerProps) {
  const t = useTranslations("entryFields");
  const tr = useRefusal();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<RulesEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef("");

  // Typing searches the served entries of the type by name; an answer to an older search is dropped.
  const handleSearch = async (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setQ(text);
    latest.current = text;
    if (text.trim() === "") {
      setFound(null);
      return;
    }
    try {
      const url = rulesUrl({ campaignId, type: entity, q: text, offset: 0 });
      const entries = await readEntries({ url, fallback: t("readFailed"), tr });
      if (latest.current !== text) return;
      setFound(entries.filter((x) => x.type === entity).slice(0, PICKER_ROWS));
      setError(null);
    } catch (err) {
      if (latest.current === text) setError(err instanceof Error ? err.message : t("readFailed"));
    }
  };

  // A found entry is picked, and the search closes.
  const handlePick = (entry: RulesEntry) => () => {
    onPick(entry);
    setQ("");
    setFound(null);
  };

  return (
    <div className="stack" style={{ minWidth: 0 }}>
      <span>{label}</span>
      {value !== null && (
        <div className="row">
          <button type="button" className="btn sm" onClick={onOpen} aria-label={t("open", { name: name ?? value })}>
            {name ?? value}
          </button>
          {!disabled && (
            <button
              type="button"
              className="btn sm"
              onClick={() => onPick(null)}
              aria-label={t("clearLabel", { label })}
            >
              {t("clear")}
            </button>
          )}
        </div>
      )}
      {!disabled && (
        <input
          id={id}
          type="search"
          value={q}
          onChange={handleSearch}
          aria-label={t("search", { label })}
          placeholder={t("search", { label })}
          maxLength={100}
        />
      )}
      {error && <p className="error">{error}</p>}
      {found && (
        <ul className="list" aria-label={t("results", { label })}>
          {found.length === 0 && <li className="dim">{t("noMatch")}</li>}
          {found.map((x) => (
            <li key={`${x.pack}/${x.key}`}>
              <button type="button" className="found" onClick={handlePick(x)}>
                <strong>{x.name}</strong>
                <span className="small dim">{x.pack}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
