"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import type { CodexEntry, CodexKind } from "@inconsistable/core-schema";

import { linkedEntry, linkOptions } from "@/lib/entry-fields/entry-fields";

import { LINK_SEARCH_FROM } from "../../constants";

type EntryPickerProps = {
  id: string;
  label: string;
  /** The kind the field links to; only entries of it are offered. */
  kind: CodexKind;
  /** Every entry this seat reads. */
  entries: readonly CodexEntry[];
  /** The entry being edited, which may not link to itself. */
  self: string;
  /** The linked entry's id, or null. */
  value: string | null;
  disabled: boolean;
  onPick: (entryId: string | null) => void;
  onOpen: (entryId: string) => void;
};

// A link field in the GM's editor (house decision #76): a select of the room's entries of the field's kind, "nothing"
// first, with a search above it once there are many; the linked entry opens from beside it.
export function EntryPicker({ id, label, kind, entries, self, value, disabled, onPick, onOpen }: EntryPickerProps) {
  const t = useTranslations("entryFields");
  const [q, setQ] = useState("");
  const all = linkOptions({ entries, kind, self });
  const shown = linkOptions({ entries, kind, self, q });
  const picked = value === null ? undefined : linkedEntry({ entries, id: value });
  // The linked entry stays a choice while a search hides it, so the select never shows a value it lacks.
  const options = picked && !shown.includes(picked) ? [picked, ...shown] : shown;

  // The select: "nothing" clears the link.
  const handlePick = (e: ChangeEvent<HTMLSelectElement>) => onPick(e.target.value === "" ? null : e.target.value);

  return (
    <div className="stack" style={{ minWidth: 0 }}>
      <label htmlFor={id}>{label}</label>
      {!disabled && all.length >= LINK_SEARCH_FROM && (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("search", { label })}
          placeholder={t("search", { label })}
          maxLength={100}
        />
      )}
      <div className="row" style={{ minWidth: 0 }}>
        <select
          id={id}
          value={picked?.id ?? ""}
          onChange={handlePick}
          disabled={disabled}
          style={{ flex: 1, minWidth: 0 }}
        >
          <option value="">{t("none")}</option>
          {options.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
        </select>
        {picked && (
          <button
            type="button"
            className="btn sm"
            onClick={() => onOpen(picked.id)}
            aria-label={t("open", { name: picked.title })}
          >
            {t("openShort")}
          </button>
        )}
      </div>
      {q.trim() !== "" && shown.length === 0 && <p className="dim small">{t("noMatch")}</p>}
    </div>
  );
}
