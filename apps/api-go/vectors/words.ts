// What the TypeScript side answers for words in more than one language (packages/rules-engine/src/words.ts, issue
// #159), for internal/engine/words.go and internal/schema (Words, ParseIn) to match: the lists, and rulesets with labels
// and terms per language, valid and refused, each as stored and as read in every language. generate.ts writes these
// under `words`. Every word here is invented.
import { SAMPLE_WORDS, SAMPLE_WORDS_VI } from "../../../packages/rules-engine/src/fixtures/sample-words.ts";
import { localRuleset, RulesetDocument, validateRuleset } from "../../../packages/rules-engine/src/manifest.ts";
import { LANGUAGES, MAX_TERM, TERM_IDS } from "../../../packages/rules-engine/src/words.ts";

type Doc = Record<string, unknown>;
const base = SAMPLE_WORDS as Doc;
const resources = SAMPLE_WORDS.resources ?? [];

// One label of the first resource set to `label`.
const withLabel = (label: unknown): Doc => ({
  ...base,
  resources: resources.map((r, i) => (i === 0 ? { ...r, label } : r)),
});
const withTerm = (term: unknown): Doc => ({ ...base, terms: { party: term } });

function inputs(): unknown[] {
  return [
    SAMPLE_WORDS,
    SAMPLE_WORDS_VI,
    { ...base, language: undefined },
    { ...base, language: "fr" },
    { ...base, language: 5 },
    // Labels: every language, one, none, unknown ones, empty and long words, the wrong kinds.
    withLabel({ en: "A", vi: "B" }),
    withLabel({ vi: "B" }),
    withLabel({}),
    withLabel({ fr: "x" }),
    withLabel({ en: "A", fr: "x" }),
    withLabel({ en: "A", fr: "x", vi: "" }),
    // Unknown keys in sorted order: Go reads the vectors into a map that has lost the input's.
    withLabel({ en: "A", de: "y", fr: "x" }),
    withLabel({ vi: "B", fr: 3 }),
    withLabel({ en: "" }),
    withLabel({ en: "A", vi: "" }),
    withLabel({ en: "x".repeat(80) }),
    withLabel({ en: "x".repeat(81) }),
    withLabel({ en: 5 }),
    withLabel({ en: { vi: "B" } }),
    withLabel(5),
    withLabel(null),
    withLabel([]),
    withLabel(""),
    // Terms: a word, a word and its plural, per language, and broken ones.
    withTerm("Band"),
    withTerm({ one: "Band", other: "Bands" }),
    withTerm({ en: { one: "Band", other: "Bands" }, vi: "Đoàn" }),
    withTerm({ one: "Band" }),
    withTerm({ one: "Band", other: "" }),
    withTerm({ one: "Band", other: "Bands", vi: "Đoàn" }),
    withTerm({ en: { one: "Band" } }),
    withTerm({}),
    withTerm({ xx: "Band" }),
    withTerm({ en: "x".repeat(MAX_TERM + 1) }),
    withTerm(7),
    withTerm([]),
    // Other labels: an enum's words, a Test's input options, a sheet section, a table entry.
    {
      ...base,
      tests: Object.fromEntries(
        Object.entries(SAMPLE_WORDS.tests ?? {}).map(([id, t]) => [
          id,
          { ...t, label: { en: "Check", vi: "Kiểm tra" }, inputLabels: { dc: { vi: "Độ khó" } } },
        ]),
      ),
    },
    // A choice the taker makes while reporting (house decision #170) is labelled per language too.
    {
      ...base,
      tests: Object.fromEntries(
        Object.entries(SAMPLE_WORDS.tests ?? {}).map(([id, t]) => [
          id,
          { ...t, choices: { push: { label: { en: "Push", vi: "Gắng" }, cite: "Sample p.9" } } },
        ]),
      ),
    },
    {
      ...base,
      layout: {
        ...SAMPLE_WORDS.layout,
        character: {
          ...SAMPLE_WORDS.layout?.character,
          sheet: { sections: [{ id: "abilities", label: { en: "Abilities", vi: "Năng lực" }, show: ["attr.str"] }] },
        },
      },
    },
  ];
}

export function wordsVectors() {
  return {
    languages: LANGUAGES,
    termIds: TERM_IDS,
    maxTerm: MAX_TERM,
    cases: inputs().map((input) => {
      const r = validateRuleset(input);
      if (!r.ok) return { input, ok: false, problems: r.problems };
      return {
        input,
        ok: true,
        document: JSON.parse(JSON.stringify(RulesetDocument.parse(input))) as unknown,
        local: Object.fromEntries(LANGUAGES.map((lang) => [lang, localRuleset(input, lang)])),
      };
    }),
  };
}
