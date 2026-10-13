// The importer's size cap as the api enforces it (MAX_PACK_BYTES in the rules engine). The client refuses early so a
// file that is too big isn't uploaded just to be turned away; the api's check is the one that counts.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Shown at the input, before anything is pasted (CLAUDE.md, principle 2: no book text). */
export const SUMMARY_REMINDER = "Summarize in your own words, with the page. Don't paste text from a book.";

/** How many keys of a diff are listed before "and N more". */
export const DIFF_KEYS_SHOWN = 40;

export const IMPORT_ERRORS = {
  tooBig: "That file is over 5 MB. Split the pack into two.",
  notJson: "That isn't a JSON document.",
  unknownShape: "Not a ruleset (it needs entities) or a pack (it needs entries).",
  signedOut: "You're signed out. Sign in again and retry.",
  failed: "Couldn't import. Check the connection and retry.",
  readFailed: "Couldn't read that file.",
} as const;
