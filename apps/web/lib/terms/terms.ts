import {
  type Lang,
  type Term,
  TERM_IDS,
  type TermId,
  termIn,
  termWord,
  type TermWords,
} from "@inconsistable/rules-engine";

// The term lookup (issue #159): which word the app shows for each of its terms in a room, and the messages with those
// words written in. A message names a term as `[party]` (the word as written), `[Party]` (with a capital letter) or
// `[PARTY]` (in capitals); `[party*]` is its plural. The app's own words are the `terms` namespace of each message file.

/** One word for every term. */
export type TermSet = Record<TermId, Term>;

const TOKEN = /\[([A-Za-z]+)(\*?)\]/g;

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** The term a token names, and how it writes the word; null when the brackets hold something else. */
export function tokenOf(name: string): { id: TermId; write: (word: string) => string } | null {
  const id = TERM_IDS.find((t) => t.toLowerCase() === name.toLowerCase());
  if (id === undefined) return null;
  if (name === id) return { id, write: (word) => word };
  if (name === id.toUpperCase()) return { id, write: (word) => word.toUpperCase() };
  if (name === capital(id)) return { id, write: capital };
  return null;
}

// ICU reads { } # < > | and the apostrophe in a message, so a word is written for them to stand for themselves.
export const escapeIcu = (word: string): string => word.replace(/'/g, "''").replace(/[{}#<>|]+/g, (run) => `'${run}'`);

/** One message with its terms written in. A token naming no term stays as it is. */
export function fillTerms(message: string, words: TermSet): string {
  return message.replace(TOKEN, (token, name: string, star: string) => {
    const found = tokenOf(name);
    if (found === null) return token;
    return escapeIcu(found.write(termWord(words[found.id], star === "*")));
  });
}

/**
 * Every message of a tree with its terms written in, and its `terms` namespace the words themselves, so `useTerm`
 * reads the room's word where a component needs one outside a message.
 */
export function withTerms<T extends object>(messages: T, words: TermSet): T {
  const walk = (v: unknown): unknown =>
    typeof v === "string"
      ? fillTerms(v, words)
      : typeof v === "object" && v !== null
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "terms" && v === messages ? words : walk(x)]))
        : v;
  return walk(messages) as T;
}

/** The app's own words: the `terms` namespace of a message file. */
export const appTerms = (messages: { terms: TermSet }): TermSet => messages.terms;

/**
 * The lookup, for one room and the viewer's language: the room's World in that language, then the pinned ruleset's
 * terms in that language, then in the ruleset's own language, then the app's own word.
 */
export function roomTerms({
  app,
  world,
  ruleset,
  lang,
}: {
  app: TermSet;
  world: Partial<Record<TermId, TermWords>> | null | undefined;
  ruleset: { terms: Record<string, TermWords>; language?: Lang | undefined } | null | undefined;
  lang: Lang;
}): TermSet {
  const own = (id: TermId) => (ruleset && Object.hasOwn(ruleset.terms, id) ? ruleset.terms[id] : undefined);
  const word = (id: TermId) =>
    termIn(world?.[id], lang) ?? termIn(own(id), lang) ?? termIn(own(id), ruleset?.language ?? "en") ?? app[id];
  return Object.fromEntries(TERM_IDS.map((id) => [id, word(id)])) as TermSet;
}
