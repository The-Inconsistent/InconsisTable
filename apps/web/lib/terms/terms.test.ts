import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createTranslator } from "next-intl";

import { LANGUAGES, localRuleset } from "@inconsistable/rules-engine";

import { LOCALES } from "@/lib/locale/locale";

import { SAMPLE_WORDS, SAMPLE_WORLD_WORDS } from "../../../../packages/rules-engine/src/fixtures/sample-words.ts";
import {
  appTerms,
  changedMessages,
  escapeIcu,
  fillTerms,
  mergeMessages,
  roomTerms,
  type TermSet,
  tokenOf,
  withTerms,
} from "./terms";

const load = (locale: string) =>
  JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8")) as { terms: TermSet };
const en = appTerms(load("en"));
const vi = appTerms(load("vi"));

test("the app's languages are the ones a document may give its words in", () => {
  assert.deepEqual(LOCALES, LANGUAGES);
});

test("the lookup: the World in the viewer's language, the ruleset in it, then in its own, then the app's", () => {
  const world = SAMPLE_WORLD_WORDS.terms;
  const inVi = roomTerms({ app: vi, world, ruleset: localRuleset(SAMPLE_WORDS, "vi"), lang: "vi" });
  assert.equal(inVi.character, "Lữ khách"); // the World's, in Vietnamese
  assert.equal(inVi.party, "Thuỷ thủ đoàn"); // the ruleset's, in Vietnamese
  assert.equal(inVi.foe, "Opposition"); // the ruleset's, given for every language
  assert.deepEqual(inVi.fight, vi.fight); // the World gives it in English alone, the ruleset not at all
  assert.equal(inVi.session, "Chuyến"); // the ruleset's, in Vietnamese only
  const inEn = roomTerms({ app: en, world, ruleset: localRuleset(SAMPLE_WORDS, "en"), lang: "en" });
  assert.deepEqual(inEn.fight, { one: "Skirmish", other: "Skirmishes" });
  assert.deepEqual(inEn.party, { one: "Crew", other: "Crews" });
  // Given in Vietnamese alone, a ruleset's term is never shown to an English reader: the app's word is.
  assert.deepEqual(inEn.session, en.session);
  assert.deepEqual(roomTerms({ app: en, world: null, ruleset: null, lang: "en" }), en);
});

test("a term a ruleset gives in its own language alone is its word for every reader; in another, only for that one", () => {
  const ruleset = { terms: { gm: { en: "Keeper" } }, language: "en" as const };
  assert.equal(roomTerms({ app: vi, world: null, ruleset, lang: "vi" }).gm, "Keeper");
  assert.deepEqual(roomTerms({ app: vi, world: null, ruleset: { ...ruleset, language: "vi" }, lang: "vi" }).gm, vi.gm);
});

test("a token names a term as written, with a capital, in capitals, and in the plural", () => {
  const words = { ...en, character: { one: "wayfarer", other: "wayfarers" } };
  assert.equal(fillTerms("No [character] yet", words), "No wayfarer yet");
  assert.equal(fillTerms("[Character*] at the table", words), "Wayfarers at the table");
  assert.equal(fillTerms("ADD [CHARACTER]", words), "ADD WAYFARER");
  assert.equal(fillTerms("Ask your [gm]", words), "Ask your GM");
  assert.equal(fillTerms("[TableScreen] on", words), "Table screen on");
  // Brackets that name no term stay as they are.
  assert.equal(fillTerms("[06:40] [nope] [cHaracter]", words), "[06:40] [nope] [cHaracter]");
  assert.equal(tokenOf("GM")?.write("Game Master"), "GAME MASTER");
});

test("a plural message counts with the term's own plural, and a word with ICU's characters reads as written", () => {
  const words: TermSet = { ...en, creature: { one: "Thing {x}", other: "Things #'s <b>" } };
  const messages = withTerms(
    { terms: en, m: { count: "{count, plural, one {# [creature]} other {# [creature*]}}" } },
    words,
  );
  const t = createTranslator({ locale: "en", messages, namespace: "m" });
  assert.equal(t("count", { count: 1 }), "1 Thing {x}");
  assert.equal(t("count", { count: 3 }), "3 Things #'s <b>");
  assert.equal(escapeIcu("it's", { inPlural: false }), "it''s");
  // The terms namespace becomes the room's words, for useTerm.
  assert.deepEqual(messages.terms.creature, words.creature);
});

test("a # is the count only inside a plural, and a | is never special", () => {
  const words: TermSet = { ...en, party: "Crew #1", foe: "A|B" };
  const messages = withTerms(
    {
      terms: en,
      m: {
        plain: "[Party] meets [foe] ({name})",
        counted: "{n, plural, one {# [party], {name}} other {# [party] of [foe]}}",
        ordinal: "{n, selectordinal, other {#th [party]}}",
        chosen: "{g, select, a {[party]} other {[foe]}}",
      },
    },
    words,
  );
  assert.equal(messages.m.plain, "Crew #1 meets A|B ({name})");
  const t = createTranslator({ locale: "en", messages, namespace: "m" });
  assert.equal(t("plain", { name: "x" }), "Crew #1 meets A|B (x)");
  assert.equal(t("counted", { n: 1, name: "x" }), "1 Crew #1, x");
  assert.equal(t("counted", { n: 2, name: "x" }), "2 Crew #1 of A|B");
  assert.equal(t("ordinal", { n: 3 }), "3th Crew #1");
  assert.equal(t("chosen", { g: "a" }), "Crew #1");
});

test("a room sends only the messages it words differently, laid over the page's", () => {
  const base = { a: "x", g: { b: "y", c: "z" }, terms: { party: { one: "party", other: "parties" } } };
  const next = { a: "x", g: { b: "y", c: "Z" }, terms: { party: "Crew" } };
  const changes = changedMessages(base, next);
  assert.deepEqual(changes, { g: { c: "Z" }, terms: { party: "Crew" } });
  assert.deepEqual(mergeMessages(base, changes), next);
  assert.deepEqual(changedMessages(base, base), {});
});

test("every token in both message files names a term, and en and vi have a word for every term", () => {
  for (const locale of ["en", "vi"]) {
    const text = readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8");
    for (const [token, name] of text.matchAll(/\[([A-Za-z]+)\*?\]/g))
      assert.notEqual(tokenOf(name ?? ""), null, `${locale}: ${token} names no term`);
  }
  assert.deepEqual(Object.keys(vi).toSorted(), Object.keys(en).toSorted());
});
