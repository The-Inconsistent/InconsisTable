import { z } from "zod";

// Words in more than one language (issue #159). A ruleset's labels and terms, and a World's terms, are written once per
// language in the one document: a value is either the words themselves, for every language, or a map from language to
// words. The Go twin is internal/schema (Words) and internal/engine/words.go.

/** The languages a document may give its words in, in the order a missing one falls back through. The web's LOCALES. */
export const LANGUAGES = ["en", "vi"] as const;
export const Lang = z.enum(LANGUAGES);
export type Lang = z.infer<typeof Lang>;

/**
 * Words given per language, as a parsed ruleset holds them until it is read in one language (`localize`). A class, so
 * the reader tells them apart from any other object with an `en` key. JSON writes the map back as it came in.
 */
export class Words<T> {
  readonly byLang: Partial<Record<Lang, T>>;
  constructor(byLang: Partial<Record<Lang, T>>) {
    this.byLang = byLang;
  }
  /** The words in `lang`, else in `fallback` (the document's default), else in the first language they are given in. */
  pick(lang: Lang, fallback: Lang): T {
    const found = [lang, fallback, ...LANGUAGES].find((l) => this.byLang[l] !== undefined);
    return this.byLang[found ?? "en"] as T;
  }
  toJSON(): Partial<Record<Lang, T>> {
    return this.byLang;
  }
}

/** A type read in one language: every `Words<T>` in it is a `T`. */
export type Localized<T> =
  T extends Words<infer U>
    ? Localized<U>
    : T extends readonly (infer E)[]
      ? Localized<E>[]
      : T extends object
        ? { [K in keyof T]: Localized<T[K]> }
        : T;

/** A parsed document read in `lang`, falling back to `fallback`. Every other value is copied as it is. */
export function localize<T>(value: T, { lang, fallback }: { lang: Lang; fallback: Lang }): Localized<T> {
  const walk = (v: unknown): unknown => {
    if (v instanceof Words) return walk(v.pick(lang, fallback));
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "object" && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as Localized<T>;
}

/**
 * A part of a ruleset parsed again where it is used (a primitive's params): it comes from a ruleset already read in one
 * language, so it holds no `Words`; one left over is read in English.
 */
export const readIn = <S extends z.ZodType>(schema: S) =>
  schema.transform((v) => localize(v, { lang: "en", fallback: "en" }));

const NO_LANGUAGE = "give the words in at least one language";
const byLanguage = <T extends z.ZodType>(words: T) =>
  z.partialRecord(Lang, words).refine((m) => Object.keys(m).length > 0, NO_LANGUAGE);

/**
 * A value that may be given per language, marked so `localize` reads it: the words themselves (every language), or a
 * map from language to words. For a ruleset, whose labels are read in the viewer's language.
 */
export const Words$ = <T extends z.ZodType>(words: T) =>
  z.union([words, byLanguage(words).transform((m) => new Words<z.output<T>>(m as Partial<Record<Lang, z.output<T>>>))]);

/** A label a ruleset may give per language: the label for every language, or one per language. */
export const Text = (max: number) => Words$(z.string().min(1).max(max));

/** The longest word or plural a term holds. */
export const MAX_TERM = 60;

/**
 * A word that replaces one of the app's (decision (b) of 2026-11-27): the word, or the word and its plural as ICU calls
 * them (`one`, `other`). Classifiers and articles stay in the app's own sentences.
 */
export const Term = z.union([
  z.string().min(1).max(MAX_TERM),
  z.object({ one: z.string().min(1).max(MAX_TERM), other: z.string().min(1).max(MAX_TERM) }),
]);
export type Term = z.infer<typeof Term>;

/** A term as a World or a ruleset writes it: for every language, or one per language. Never read by `localize`: the
 * lookup reads it per language itself (a term missing in a language is the app's own word, not another language's). */
export const TermWords = z.union([Term, byLanguage(Term)]);
export type TermWords = z.infer<typeof TermWords>;

/**
 * The words the platform shows that a World or a ruleset may replace (issue #159), each the app's own word until one
 * does. A closed list: the app reads these ids and no other. The marker words are the six colours of house decision #92.
 */
export const TERM_IDS = [
  "party",
  "foe",
  "gm",
  "player",
  "session",
  "fight",
  "round",
  "turn",
  "character",
  "creature",
  "mob",
  "scene",
  "mission",
  "handout",
  "codex",
  "tableScreen",
  "markerRed",
  "markerAmber",
  "markerGreen",
  "markerBlue",
  "markerPurple",
  "markerWhite",
] as const;
export const TermId = z.enum(TERM_IDS);
export type TermId = z.infer<typeof TermId>;

const isTerm = (v: unknown): v is Term => typeof v === "string" || (typeof v === "object" && v !== null && "one" in v);

/** A term as written in a World or a ruleset, read in `lang` alone: undefined when it has no words in that language. */
export function termIn(words: TermWords | undefined, lang: Lang): Term | undefined {
  if (words === undefined) return undefined;
  return isTerm(words) ? words : words[lang];
}

/** The word of a term, or its plural (`other`). A term given as one word is its own plural. */
export const termWord = (term: Term, plural: boolean): string =>
  typeof term === "string" ? term : plural ? term.other : term.one;
