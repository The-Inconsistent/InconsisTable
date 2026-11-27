"use client";
import { splitMentions, type CodexEntry } from "@inconsistable/core-schema";

import { nameLinker } from "@/lib/codex/codex";

type MentionTextProps = {
  body: string;
  /** The entries this seat holds: a mention opens only one of these. */
  entries: readonly CodexEntry[];
  /** Opens an entry. Without it (the TV) a mention is plain, marked text and no plain name links. */
  onOpen?: (entryId: string) => void;
  /** The entry this text belongs to, which never links itself. */
  self?: string;
};

// A body with its `@[Title](id)` mentions. One the seat can read becomes a link with the entry's title as it stands now
// (a mark on the TV); a hidden or deleted one is plain text: the server already sent `…` for what this seat may not see.
// Where a link can open, a plain name that spells an entry this seat holds links too (#218).
export function MentionText({ body, entries, onOpen, self }: MentionTextProps) {
  const link = nameLinker(entries);
  const button = (key: string, entry: CodexEntry, open: (id: string) => void) => (
    <button key={key} type="button" className="mention" onClick={() => open(entry.id)}>
      {entry.title}
    </button>
  );
  return (
    <>
      {splitMentions(body).flatMap((part, i) => {
        if ("text" in part) {
          if (!onOpen) return [part.text];
          return link({ text: part.text, self }).map((p, j) =>
            "text" in p ? p.text : button(`${i}.${j}`, p.entry, onOpen),
          );
        }
        const known = entries.find((e) => e.id === part.id);
        if (!known) return [part.title];
        return [
          onOpen ? (
            button(String(i), known, onOpen)
          ) : (
            <span key={i} className="mention">
              {known.title}
            </span>
          ),
        ];
      })}
    </>
  );
}
