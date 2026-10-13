import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import { SAMPLE_PACK } from "./fixtures/sample-pack.ts";
import { validateRuleset, type Ruleset } from "./manifest.ts";
import {
  MAX_ENTRY_BODY_BYTES,
  MAX_PACK_BYTES,
  MAX_PACK_ENTRIES,
  PRIVATE_TEXT_WARN_CHARS,
  validatePack,
  type PackInput,
  type PackEntry,
} from "./pack.ts";
import { canonicalJson, contentHash, diffHashes, diffPack, sha256Hex } from "./pack-hash.ts";
import type { Problem } from "./problem.ts";

function ruleset(): Ruleset {
  const r = validateRuleset(SAMPLE_D20);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.ruleset;
}
const RULESET = ruleset();

function entryAt(p: PackInput, i: number): PackInput["entries"][number] {
  const e = p.entries[i];
  assert.ok(e !== undefined);
  return e;
}

function pack(): PackInput {
  return structuredClone(SAMPLE_PACK);
}

function problems(input: unknown, rs: Ruleset = RULESET): Problem[] {
  const r = validatePack({ input, ruleset: rs });
  return r.ok ? [] : r.problems;
}

function has(list: readonly Problem[], path: string, pattern: RegExp) {
  assert.ok(
    list.some((p) => p.path === path && pattern.test(p.message)),
    `expected ${path} ~ ${pattern}, got ${JSON.stringify(list)}`,
  );
}

test("the sample pack validates and gets fail-closed defaults", () => {
  const r = validatePack({ input: SAMPLE_PACK, ruleset: RULESET });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  assert.deepEqual(r.warnings, []);
  const bare = pack();
  const [first] = bare.entries;
  assert.ok(first !== undefined);
  const { visibility: _visibility, tags: _tags, ...rest } = first;
  bare.entries = [rest as typeof first];
  const lean = validatePack({ input: bare, ruleset: RULESET });
  assert.ok(lean.ok);
  assert.equal(lean.pack.entries[0]?.visibility, "gm");
  assert.deepEqual(lean.pack.entries[0]?.tags, []);
});

test("an entry without a cite is refused with its path, unless the pack is original or the ruleset homebrew", () => {
  const p = pack();
  delete (p.entries[2] as { cite?: string }).cite;
  has(problems(p), "entries[2].cite", /needs a cite/);
  // The author's own work has no printed page to cite.
  assert.deepEqual(problems({ ...p, license: "original" }), []);
  // A homebrew ruleset has none either.
  const home = structuredClone(SAMPLE_D20);
  home.sources = [{ id: "table", title: "Our table", license: "homebrew" }];
  const hr = validateRuleset(home);
  assert.ok(hr.ok, JSON.stringify(!hr.ok && hr.problems));
  if (hr.ok) assert.deepEqual(problems(p, hr.ruleset), []);
});

test("srd, cc-by and orc packs must name their attribution", () => {
  for (const license of ["srd", "cc-by", "orc"]) {
    has(problems({ ...pack(), license }), "attribution", /attribution/);
    assert.deepEqual(problems({ ...pack(), license, attribution: "Sample Press, CC-BY 4.0" }), []);
  }
  for (const license of ["private", "original"]) assert.deepEqual(problems({ ...pack(), license }), []);
  has(problems({ ...pack(), license: "public-domain" }), "license", /./);
});

test("an entry is checked against its entity type and the FieldDefs", () => {
  const p = pack();
  p.entries[2] = {
    ...entryAt(p, 2),
    type: "creature",
    body: { name: 7, "attr.str": 1.5, guard: "high", level: -1, ghost: 1 },
  };
  p.entries[3] = { ...entryAt(p, 3), type: "vehicle" };
  p.entries[0] = { ...entryAt(p, 0), body: { size: "huge" } };
  const list = problems(p);
  has(list, "entries[2].body.name", /expected text/);
  has(list, "entries[2].body.attr.str", /whole number/);
  has(list, "entries[2].body.guard", /whole number/);
  has(list, "entries[2].body.level", /minimum of 0/);
  has(list, "entries[2].body.ghost", /no field/);
  has(list, "entries[3].type", /unknown entity/);
  has(list, "entries[0].body.size", /one of small, medium/);
});

test("keys are unique, and the pack is written for this ruleset", () => {
  const p = pack();
  p.entries[1] = { ...entryAt(p, 1), key: "reedfolk" };
  p.ruleset = { id: "other-game", range: "^1.0.0" };
  const list = problems(p);
  has(list, "entries[1].key", /duplicate/);
  has(list, "ruleset.id", /other-game/);
  has(problems({ ...pack(), entries: [{ ...entryAt(pack(), 0), key: "Bad Key" }] }), "entries[0].key", /lowercase/);
});

test("size limits: entries per pack, bytes per body, bytes per file", () => {
  const entry = (i: number) => ({ key: `gear-${i}`, type: "gear", name: "Rope", cite: "Sample p.50", body: {} });
  const many = { ...pack(), entries: Array.from({ length: MAX_PACK_ENTRIES + 1 }, (_, i) => entry(i)) };
  has(problems(many), "entries", /5000/);
  const fits = { ...pack(), entries: Array.from({ length: MAX_PACK_ENTRIES }, (_, i) => entry(i)) };
  assert.deepEqual(problems(fits), []);

  // A body over 16 KB: a list field is the one that can hold it (a text field has its own cap).
  const p = structuredClone(SAMPLE_D20);
  const gear = p.entities.find((e) => e.id === "gear");
  assert.ok(gear?.fields !== undefined);
  gear.fields.notes = { type: "list", label: "Notes" };
  const big = validateRuleset(p);
  assert.ok(big.ok);
  if (!big.ok) return;
  const fat = {
    ...pack(),
    entries: [{ ...entry(1), body: { notes: Array.from({ length: 40 }, () => "x".repeat(500)) } }],
  };
  assert.ok(JSON.stringify(fat.entries[0]?.body).length > MAX_ENTRY_BODY_BYTES);
  has(problems(fat, big.ruleset), "entries[0].body", /over the cap of 16384/);

  const huge = { ...pack(), sources: [], entries: [{ ...entry(1), name: "x".repeat(MAX_PACK_BYTES) }] };
  has(problems(huge), "(root)", /over the cap/);
  has(problems("not a pack"), "(root)", /./);
});

test("a long text in a private pack is a warning, not an error, and only there", () => {
  const long = "w".repeat(PRIVATE_TEXT_WARN_CHARS + 1);
  const p = pack();
  p.entries[0] = { ...entryAt(p, 0), body: { blurb: long } };
  const priv = validatePack({ input: p, ruleset: RULESET });
  assert.ok(priv.ok);
  assert.equal(priv.warnings.length, 1);
  assert.equal(priv.warnings[0]?.path, "entries[0].body.blurb");
  // At the threshold: no warning.
  p.entries[0] = { ...entryAt(p, 0), body: { blurb: "w".repeat(PRIVATE_TEXT_WARN_CHARS) } };
  const exact = validatePack({ input: p, ruleset: RULESET });
  assert.ok(exact.ok && exact.warnings.length === 0);
  // Your own work and attributed open content are not warned about.
  p.entries[0] = { ...entryAt(p, 0), body: { blurb: long } };
  for (const extra of [{ license: "original" }, { license: "srd", attribution: "Sample Press" }]) {
    const r = validatePack({ input: { ...p, ...extra }, ruleset: RULESET });
    assert.ok(r.ok && r.warnings.length === 0, JSON.stringify(extra));
  }
  // Warnings come with errors too, so the importer can show both at once.
  const both = validatePack({
    input: { ...p, license: "private", entries: [{ ...entryAt(p, 0), cite: undefined }] },
    ruleset: RULESET,
  });
  assert.ok(!both.ok);
  assert.equal(both.warnings.length, 1);
});

// contentHash and diffPack

test("sha256Hex agrees with node:crypto, across the block boundaries", () => {
  for (const text of ["", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(1000), "thanh máu ⚔"]) {
    assert.equal(sha256Hex(text), createHash("sha256").update(text).digest("hex"), JSON.stringify(text.slice(0, 20)));
  }
});

function entry(partial: Partial<PackEntry> = {}): PackEntry {
  const r = validatePack({ input: SAMPLE_PACK, ruleset: RULESET });
  assert.ok(r.ok);
  const [first] = r.pack.entries;
  assert.ok(first !== undefined);
  return { ...first, ...partial };
}

test("contentHash is stable under key order and tag order, and moves with any content change", () => {
  const e = entry({ tags: ["a", "b"], body: { size: "small", blurb: "x" } });
  const reordered = entry({ tags: ["b", "a"], body: { blurb: "x", size: "small" } });
  assert.equal(contentHash(e), contentHash(reordered));
  assert.equal(contentHash(e), contentHash(structuredClone(e)));
  assert.match(contentHash(e), /^[0-9a-f]{64}$/);
  for (const change of [
    { name: "Other" },
    { cite: "Sample p.11" },
    { visibility: "gm" as const },
    { level: 3 },
    { body: { size: "medium", blurb: "x" } },
    { tags: ["a"] },
  ]) {
    assert.notEqual(contentHash({ ...e, ...change }), contentHash(e), JSON.stringify(change));
  }
  // An omitted default and a written one are the same content once parsed; undefined is not content.
  assert.equal(
    contentHash({ ...e, level: undefined }),
    contentHash(entry({ tags: ["a", "b"], body: e.body, level: undefined })),
  );
  assert.equal(canonicalJson({ b: 1, a: [2, { d: undefined, c: 3 }] }), '{"a":[2,{"c":3}],"b":1}');
});

test("diffPack lists added, changed and removed keys, sorted", () => {
  const base = [entry({ key: "a" }), entry({ key: "b" }), entry({ key: "c" })];
  const next = [entry({ key: "c" }), entry({ key: "b", name: "Renamed" }), entry({ key: "d" }), entry({ key: "e" })];
  assert.deepEqual(diffPack({ prev: { entries: base }, next: { entries: next } }), {
    added: ["d", "e"],
    changed: ["b"],
    removed: ["a"],
  });
  // First import: everything is new. Same content again: nothing.
  assert.deepEqual(diffPack({ prev: null, next: { entries: base } }).added, ["a", "b", "c"]);
  assert.deepEqual(diffPack({ prev: { entries: base }, next: { entries: [...base].reverse() } }), {
    added: [],
    changed: [],
    removed: [],
  });
  // The importer diffs the hashes it stored, without loading bodies.
  assert.deepEqual(diffHashes({ prev: new Map([["k", "1"]]), next: new Map([["k", "2"]]) }).changed, ["k"]);
});
