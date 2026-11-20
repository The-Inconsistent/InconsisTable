import assert from "node:assert/strict";
import { test } from "node:test";

import { SAMPLE_PARAMS } from "./build/fixtures/sample-ledger.ts";
import { buildSchemas } from "./build/schemas.ts";
import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import { SAMPLE_LEDGER_PACK } from "./fixtures/sample-ledger-pack.ts";
import { SAMPLE_LEDGER_RULESET } from "./fixtures/sample-ledger-ruleset.ts";
import { SAMPLE_PACK } from "./fixtures/sample-pack.ts";
import { validateRuleset, type Ruleset } from "./manifest.ts";
import { contentHash } from "./pack-hash.ts";
import { MAX_ENTRY_RECORD_BYTES, validatePack, type PackResult } from "./pack.ts";

// House decision #62: a pack entry carries the ledger builder's catalogue record.

type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- tests break the shape on purpose

function rulesetOf(input: unknown): Ruleset {
  const r = validateRuleset(input);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.ruleset;
}
const LEDGER = rulesetOf(SAMPLE_LEDGER_RULESET);
const D20 = rulesetOf(SAMPLE_D20);

const pack = (): Mutable => structuredClone(SAMPLE_LEDGER_PACK) as Mutable;
const indexOf = (p: Mutable, key: string) => p.entries.findIndex((e: Mutable) => e.key === key);

function refused(r: PackResult, path: string, message: string) {
  const list = r.ok ? [] : r.problems;
  assert.ok(
    list.some((p) => p.path === path && p.message === message),
    `expected ${path}: ${message}, got ${JSON.stringify(list)}`,
  );
}

test("the sample pack validates, each record parsed in its schema's key order", () => {
  const p = pack();
  const at = indexOf(p, "wardens");
  p.entries[at].record = Object.fromEntries(Object.entries(p.entries[at].record).reverse());
  const r = validatePack({ input: p, ruleset: LEDGER });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.problems));
  if (!r.ok) return;
  const record = r.pack.entries[at]?.record;
  const expected = buildSchemas(SAMPLE_PARAMS).Faction.parse(SAMPLE_LEDGER_PACK.entries[at]?.record);
  assert.deepEqual(Object.keys(record ?? {}), Object.keys(expected));
  assert.equal(JSON.stringify(record), JSON.stringify(expected));
  // Defaults filled in, as the builder reads them.
  assert.deepEqual(record?.rules, []);
});

test("an entry without a record hashes as before", () => {
  const r = validatePack({ input: SAMPLE_PACK, ruleset: D20 });
  assert.ok(r.ok);
  if (!r.ok) return;
  for (const e of r.pack.entries) {
    assert.ok(!("record" in e));
    const { tags, ...rest } = e;
    assert.equal(contentHash(e), contentHash({ ...rest, tags }));
  }
});

test("a record changes the entry's hash", () => {
  const r = validatePack({ input: SAMPLE_LEDGER_PACK, ruleset: LEDGER });
  assert.ok(r.ok);
  if (!r.ok) return;
  const [e] = r.pack.entries;
  assert.ok(e !== undefined);
  const { record, ...without } = e;
  assert.ok(record !== undefined);
  assert.notEqual(contentHash(e), contentHash(without));
});

test("a record is read only on a type the builder reads, and needed there", () => {
  const p = pack();
  p.entries.push({ key: "x", type: "hero", name: "X", cite: "Base p.1", record: { id: "x" } });
  const at = indexOf(p, "wardens");
  delete p.entries[at].record;
  const r = validatePack({ input: p, ruleset: LEDGER });
  refused(r, `entries[${p.entries.length - 1}].record`, 'nothing reads a record on a "hero"');
  refused(r, `entries[${at}].record`, 'a "faction" needs its record');
  const d = validatePack({
    input: { ...SAMPLE_PACK, entries: [{ ...SAMPLE_PACK.entries[0], record: { id: "reedfolk" } }] },
    ruleset: D20,
  });
  refused(d, "entries[0].record", 'nothing reads a record on a "lineage"');
});

test("a record parses with its kind's schema, problems under the entry's record", () => {
  const p = pack();
  const at = indexOf(p, "wardens");
  p.entries[at].record.page = 0;
  p.entries[at].record.source = "nope";
  const r = validatePack({ input: p, ruleset: LEDGER });
  refused(r, `entries[${at}].record.page`, "Too small: expected number to be >0");
  refused(r, `entries[${at}].record.source`, 'Invalid option: expected one of "base"|"extra"');
});

test("a record names the entry's key and name", () => {
  const p = pack();
  const at = indexOf(p, "wardens");
  p.entries[at].name = "Wardens of Old";
  p.entries[at].key = "old-wardens";
  const r = validatePack({ input: p, ruleset: LEDGER });
  refused(r, `entries[${at}].record.id`, `must be the entry's key "old-wardens"`);
  refused(r, `entries[${at}].record.name`, `must be the entry's name "Wardens of Old"`);
});

test("a record over the cap is refused", () => {
  const p = pack();
  const at = indexOf(p, "wardens");
  p.entries[at].record.summary = "x".repeat(MAX_ENTRY_RECORD_BYTES);
  const r = validatePack({ input: p, ruleset: LEDGER });
  const bytes = JSON.stringify(p.entries[at].record).length;
  refused(r, `entries[${at}].record`, `${bytes} bytes, over the cap of ${MAX_ENTRY_RECORD_BYTES}`);
});
