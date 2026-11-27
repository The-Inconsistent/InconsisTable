import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SAMPLE_WORDS, SAMPLE_WORDS_VI, SAMPLE_WORLD_WORDS } from "./fixtures/sample-words.ts";
import { localRuleset, RulesetDocument, validateRuleset } from "./manifest.ts";
import { termIn, termWord } from "./words.ts";
import { validateWorld } from "./world.ts";

const label = (r: { resources: { id: string; label: string }[] } | null, id: string) =>
  r?.resources.find((x) => x.id === id)?.label;
const condition = (r: { conditions: { id: string; label: string }[] } | null, id: string) =>
  r?.conditions.find((x) => x.id === id)?.label;

describe("a ruleset's labels per language", () => {
  test("validates, and reads in its own language", () => {
    const r = validateRuleset(SAMPLE_WORDS);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(label(r.ruleset, "hp"), "Vigour");
    assert.equal(label(r.ruleset, "menace"), "Menace");
  });

  test("reads in the viewer's language, then the ruleset's, then the first one given", () => {
    const vi = localRuleset(SAMPLE_WORDS, "vi");
    assert.equal(label(vi, "hp"), "Sinh lực");
    assert.equal(label(vi, "luck"), "May mắn");
    assert.equal(label(vi, "tempHp"), "Spare Vigour");
    const en = localRuleset(SAMPLE_WORDS, "en");
    assert.equal(label(en, "luck"), "Luck");
    // Given in Vietnamese alone: an English reader still gets a word.
    assert.equal(condition(en, "marked"), "Bị đánh dấu");
    // Written in Vietnamese first: a label with no Vietnamese falls back to its English.
    assert.equal(label(localRuleset(SAMPLE_WORDS_VI, "vi"), "tempHp"), "Spare Vigour");
    assert.equal(label(localRuleset(SAMPLE_WORDS_VI, "en"), "hp"), "Vigour");
  });

  test("the stored document keeps every language", () => {
    const doc = JSON.parse(JSON.stringify(RulesetDocument.parse(SAMPLE_WORDS))) as {
      resources: { id: string; label: unknown }[];
    };
    assert.deepEqual(doc.resources.find((x) => x.id === "hp")?.label, { en: "Vigour", vi: "Sinh lực" });
  });

  test("refuses a label with no language, or one it does not know", () => {
    const withLabel = (l: unknown) => ({
      ...SAMPLE_WORDS,
      resources: SAMPLE_WORDS.resources?.map((x, i) => (i === 0 ? { ...x, label: l } : x)),
    });
    for (const bad of [{}, { fr: "Vigueur" }, { en: "" }, 5]) assert.equal(validateRuleset(withLabel(bad)).ok, false);
  });

  test("keeps terms as written, for the lookup to read per language", () => {
    const vi = localRuleset(SAMPLE_WORDS, "vi");
    assert.equal(termIn(vi?.terms.party, "vi"), "Thuỷ thủ đoàn");
    assert.deepEqual(termIn(vi?.terms.party, "en"), { one: "Crew", other: "Crews" });
    assert.equal(termIn(vi?.terms.session, "en"), undefined);
    assert.equal(termIn(vi?.terms.foe, "vi"), "Opposition");
  });
});

describe("terms", () => {
  test("a word is its own plural; a word and plural pick by count", () => {
    assert.equal(termWord("Đoàn", true), "Đoàn");
    assert.equal(termWord({ one: "Crew", other: "Crews" }, false), "Crew");
    assert.equal(termWord({ one: "Crew", other: "Crews" }, true), "Crews");
  });

  test("a World's terms validate, and an unknown term or a missing language is refused", () => {
    assert.equal(validateWorld(SAMPLE_WORLD_WORDS).ok, true);
    assert.equal(validateWorld({ ...SAMPLE_WORLD_WORDS, terms: { crew: "Crew" } }).ok, false);
    assert.equal(validateWorld({ ...SAMPLE_WORLD_WORDS, terms: { party: {} } }).ok, false);
    assert.equal(validateWorld({ ...SAMPLE_WORLD_WORDS, terms: { party: { one: "Crew" } } }).ok, false);
  });
});
