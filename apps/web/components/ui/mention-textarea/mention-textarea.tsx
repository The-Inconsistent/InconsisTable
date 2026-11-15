"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { mentionOf, type CodexEntry } from "@inconsistable/core-schema";

type MentionTextareaProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** The entries the writer can see; the entry being written is left out of the picker. */
  entries: readonly CodexEntry[];
  selfId: string;
  rows: number;
  maxLength: number;
  disabled?: boolean;
};

const PICKER_ROWS = 6;
// `@` at the start of a word, then what has been typed of a title.
const TRIGGER = /(^|\s)@([^\s@[\]()]*)$/;

// A text box where typing `@` opens a picker over the codex; picking inserts `@[Title](id)` (docs/house-decisions.md #46).
export function MentionTextarea({
  id,
  value,
  onChange,
  entries,
  selfId,
  rows,
  maxLength,
  disabled,
}: MentionTextareaProps) {
  const t = useTranslations("mention");
  const ref = useRef<HTMLTextAreaElement>(null);
  const [trigger, setTrigger] = useState<{ at: number; query: string } | null>(null);
  const caret = useRef<number | null>(null);
  const matches = trigger
    ? entries
        .filter((e) => e.id !== selfId && e.title.toLowerCase().includes(trigger.query.toLowerCase()))
        .slice(0, PICKER_ROWS)
    : [];

  // External system: the DOM caret, put after an inserted mention once React has written the new value.
  useEffect(() => {
    if (caret.current === null) return;
    ref.current?.focus();
    ref.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    const found = TRIGGER.exec(text.slice(0, e.target.selectionStart));
    setTrigger(found ? { at: e.target.selectionStart - found[2]!.length - 1, query: found[2]! } : null);
    onChange(text);
  };

  const handlePick = (entry: CodexEntry) => {
    if (!trigger || !ref.current) return;
    const end = trigger.at + 1 + trigger.query.length;
    const inserted = `${mentionOf(entry)} `;
    onChange(value.slice(0, trigger.at) + inserted + value.slice(end));
    caret.current = trigger.at + inserted.length;
    setTrigger(null);
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && trigger) {
      e.preventDefault();
      setTrigger(null);
    }
  };

  return (
    <>
      <textarea
        ref={ref}
        id={id}
        rows={rows}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKey}
        maxLength={maxLength}
        disabled={disabled}
      />
      {trigger && (
        <ul className="list mention-picker" role="listbox" aria-label={t("pick")}>
          {matches.length === 0 && <li className="dim">{t("none")}</li>}
          {matches.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="btn sm"
                onClick={() => handlePick(e)}
              >
                {e.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
