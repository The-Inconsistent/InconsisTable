"use client";
import { splitMentions, type CodexEntry } from "@inconsistable/core-schema";

type MentionTextProps = {
  body: string;
  /** The entries this seat holds: a mention opens only one of these. */
  entries: readonly CodexEntry[];
  /** Opens an entry. Without it (the TV) a mention is plain, marked text. */
  onOpen?: (entryId: string) => void;
};

// A body with its `@[Title](id)` mentions. One the seat can read becomes a link (a mark on the TV); a hidden or deleted
// one is plain text: the server already sent `…` for what this seat may not see.
export function MentionText({ body, entries, onOpen }: MentionTextProps) {
  return (
    <>
      {splitMentions(body).map((part, i) => {
        if ("text" in part) return part.text;
        const known = entries.some((e) => e.id === part.id);
        if (!known) return part.title;
        return onOpen ? (
          <button key={i} type="button" className="mention" onClick={() => onOpen(part.id)}>
            {part.title}
          </button>
        ) : (
          <span key={i} className="mention">
            {part.title}
          </span>
        );
      })}
    </>
  );
}
