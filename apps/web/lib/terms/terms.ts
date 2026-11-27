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

/**
 * A word written into a message so it stands for itself: the apostrophe doubled, braces and tags quoted, and `#` quoted
 * only inside a plural, the one place ICU reads it as the count.
 */
export function escapeIcu(word: string, { inPlural }: { inPlural: boolean }): string {
  const special = inPlural ? /[{}<>#]+/g : /[{}<>]+/g;
  return word.replace(/'/g, "''").replace(special, (run) => `'${run}'`);
}

const COUNTED = /^\{\s*\w+\s*,\s*(plural|selectordinal)\s*,/;

/** For each position of a message, whether it is inside a branch of a plural or selectordinal argument. */
function pluralAt(message: string): boolean[] {
  // Each open brace: an argument (counted when plural or selectordinal) or a branch of the argument around it.
  const stack: { counted: boolean; branch: boolean }[] = [];
  const inside = () => stack.some((f) => f.branch && f.counted);
  return message.split("").map((ch, i) => {
    if (ch === "{") {
      const top = stack.at(-1);
      if (top !== undefined && !top.branch) stack.push({ counted: top.counted, branch: true });
      else stack.push({ counted: COUNTED.test(message.slice(i)), branch: false });
    } else if (ch === "}") stack.pop();
    return inside();
  });
}

/** One message with its terms written in. A token naming no term stays as it is. */
export function fillTerms(message: string, words: TermSet): string {
  const counted = message.includes("{") ? pluralAt(message) : [];
  return message.replace(TOKEN, (token, name: string, star: string, at: number) => {
    const found = tokenOf(name);
    if (found === null) return token;
    return escapeIcu(found.write(termWord(words[found.id], star === "*")), { inPlural: counted[at] === true });
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

/** A tree of messages: strings, and groups of them. */
export type MessageTree = { [key: string]: string | MessageTree };

const isGroup = (v: unknown): v is MessageTree => typeof v === "object" && v !== null && !Array.isArray(v);

/** The messages of `next` that differ from `base`, as a tree of their own: what a room sends beside the page's. */
export function changedMessages(base: MessageTree, next: MessageTree): MessageTree {
  const out: MessageTree = {};
  for (const [key, value] of Object.entries(next)) {
    const was = base[key];
    if (isGroup(value)) {
      const inner = changedMessages(isGroup(was) ? was : {}, value);
      if (Object.keys(inner).length > 0) out[key] = inner;
    } else if (value !== was) out[key] = value;
  }
  return out;
}

/** `base` with `changes` laid over it, group by group. */
export function mergeMessages(base: MessageTree, changes: MessageTree): MessageTree {
  const out: MessageTree = { ...base };
  for (const [key, value] of Object.entries(changes)) {
    const was = base[key];
    out[key] = isGroup(value) && isGroup(was) ? mergeMessages(was, value) : value;
  }
  return out;
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
