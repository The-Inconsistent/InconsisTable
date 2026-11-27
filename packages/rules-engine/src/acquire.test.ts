import assert from "node:assert/strict";
import { test } from "node:test";

import { planAcquire, withFittedCard, withFittings, type AcquireItem } from "./acquire.ts";
import { compileRuleset } from "./compile.ts";
import { SAMPLE_LEDGER_PACK } from "./fixtures/sample-ledger-pack.ts";
import { SAMPLE_LEDGER_RULESET } from "./fixtures/sample-ledger-ruleset.ts";
import type { RulesetInput } from "./manifest.ts";
import type { ActorState } from "./primitives/primitive.ts";

// Acquiring an item by a Test (house decision #102), on the ledger sample: procured against 8 + the gear's rating,
// eased by every keyword the hero shares with it past the first.

const ruleset = (() => {
  const r = compileRuleset(SAMPLE_LEDGER_RULESET);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.compiled.ruleset;
})();
const entry = (key: string): AcquireItem => {
  const e = SAMPLE_LEDGER_PACK.entries.find((x) => x.key === key);
  assert.ok(e);
  return { type: e.type, key: e.key, name: e.name, tags: e.tags ?? [], body: e.body ?? {} };
};
const hero = (keywords: string[]): ActorState => ({
  id: "h",
  entity: "hero",
  fields: {},
  resources: {},
  scope: { keywords },
});

test("the target reads the gear's rating and the keywords the hero shares with it, each a part", () => {
  const plan = planAcquire({
    ruleset,
    actor: hero(["WARDEN", "BOW"]),
    item: entry("wargear.hunting-bow"),
    picks: { push: 1 },
  });
  assert.ok(!("code" in plan));
  assert.equal(plan.kind, "arms");
  assert.deepEqual(plan.inputs.dn, {
    total: 10,
    parts: [
      { label: "Base", value: 8 },
      { label: "Rating", value: 3 },
      { label: "Matched tags", value: -1 },
    ],
    label: "Number to beat",
  });
  assert.deepEqual(plan.inputs.bonus, { total: 1, parts: [{ label: "Push", value: 1 }], label: "Push" });
  // House decision #175: a yes-or-no input is its one part's answer.
  assert.deepEqual(plan.inputs.rare, {
    total: true,
    parts: [{ label: "Rated 3 or more", value: true }],
    label: "Rare",
  });
  assert.deepEqual(plan.topUp, { resource: "coin", max: 3 });
  assert.equal(plan.quantity, null);
});

test("a weapon that names its stores brings one; stores come three at a time to any hero", () => {
  const sling = planAcquire({ ruleset, actor: hero(["WARDEN"]), item: entry("wargear.sling"), picks: { push: 0 } });
  // The sling shares no keyword with this hero: not now.
  assert.deepEqual(sling, { code: "acquireNotNow", message: '"Sling" cannot be acquired now' });
  const stores = planAcquire({ ruleset, actor: hero([]), item: entry("supply.pellets"), picks: { push: 0 } });
  assert.ok(!("code" in stores));
  assert.deepEqual([stores.kind, stores.quantity, stores.load], ["stores", 3, null]);
  const open = structuredClone(entry("wargear.sling"));
  open.tags = [...open.tags, "open"];
  const loaded = planAcquire({ ruleset, actor: hero([]), item: open, picks: { push: 0 } });
  assert.ok(!("code" in loaded));
  assert.deepEqual(loaded.load, { key: "supply.pellets", quantity: 1 });
});

test("a yes-or-no input reads no; one whose part reads a number is refused by the validator", () => {
  const staff = planAcquire({
    ruleset,
    actor: hero(["WARDEN"]),
    item: entry("wargear.lantern-staff"),
    picks: { push: 0 },
  });
  assert.ok(!("code" in staff));
  assert.equal(staff.inputs.rare?.total, false);
  const input = structuredClone(SAMPLE_LEDGER_RULESET) as RulesetInput & { items: { acquire: { inputs: object } } };
  input.items.acquire.inputs = { ...input.items.acquire.inputs, rare: [{ label: "R", value: "1" }] };
  const r = compileRuleset(input);
  assert.ok(!r.ok);
  assert.deepEqual(
    r.problems.map((p) => p.path),
    ["items.acquire.inputs.rare[0].value"],
  );
});

test("a pick out of its range, or one not declared, is refused", () => {
  const ask = (picks: Record<string, unknown>) =>
    planAcquire({ ruleset, actor: hero(["TOOL"]), item: entry("wargear.hand-axe"), picks });
  assert.equal((ask({ push: 3 }) as { code: string }).code, "badInput");
  assert.equal((ask({}) as { code: string }).code, "badInput");
  assert.equal((ask({ push: 0, more: 1 }) as { code: string }).code, "badInput");
  assert.ok(!("code" in ask({ push: 2 })));
});

test("overlap() counts the distinct items of a list another holds", () => {
  const input = structuredClone(SAMPLE_LEDGER_RULESET) as RulesetInput & { entities: { derived?: unknown[] }[] };
  input.entities[0]!.derived = [
    ...(input.entities[0]!.derived ?? []),
    { id: "shared", label: "S", expr: "overlap(keywords, keywords)", visibility: "party" as const },
  ];
  assert.ok(compileRuleset(input).ok);
});

test("a fitted item's effects on its host's card, in order, naming the items that changed it", () => {
  const card = withFittings({
    values: { damage: 3, ed: 1 },
    fitted: [
      { name: "Lens", effects: [{ path: "host.ed", mode: "add", value: "1" }] },
      { name: "Guard", effects: [{ path: "derived.guard", mode: "add", value: "1" }] },
      {
        name: "Edge",
        effects: [
          { path: "host.ap", mode: "add", value: "-1" },
          { path: "host.damage", mode: "override", value: "5" },
        ],
      },
    ],
  });
  assert.deepEqual(card, { values: { damage: 5, ed: 2, ap: -1 }, by: ["Lens", "Edge"] });
});

test("an acquisition names a non-reported Test, sets every input of it, and its kinds exist", () => {
  const problems = (over: object) => {
    const m = structuredClone(SAMPLE_LEDGER_RULESET) as RulesetInput & { items: { acquire: object } };
    m.items.acquire = { ...m.items.acquire, ...over };
    const r = compileRuleset(m);
    return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
  };
  assert.deepEqual(problems({}), []);
  assert.deepEqual(problems({ test: "nope" }), ['items.acquire.test: unknown test "nope"']);
  assert.deepEqual(problems({ inputs: { dn: [{ label: "D", value: "1" }] } }), [
    'items.acquire.inputs: the Test\'s input "bonus" is not set',
    'items.acquire.inputs: the Test\'s input "rare" is not set',
  ]);
  assert.deepEqual(problems({ limits: [{ kinds: ["nope"], max: 1 }] }), [
    'items.acquire.limits[0].kinds[0]: unknown item kind "nope"',
  ]);
  assert.deepEqual(problems({ topUp: { resource: "wealth" } }), []);
  assert.deepEqual(problems({ load: { field: "nope", quantity: "1" } }), [
    'items.acquire.load.field: wargear has no field "nope"',
  ]);
});

test("a fitting gains, re-rates, sets and takes off its host's Traits, matched by word in any case (#198)", () => {
  const card = { damage: 5, traits: ["Rapid Fire (2)", "Heavy", "Keen (1)"] };
  const fit = (name: string, path: string, mode: string, value: string) => ({
    name,
    effects: [{ path: `host.trait.${path}`, mode, value }],
  });
  const { card: out, by } = withFittedCard({
    card,
    fitted: [
      fit("Drum", "Rapid Fire", "add", "-1"), // 2 → 1
      fit("Brace", "Heavy", "override", "0"), // off
      fit("Edge", "keen", "upgrade", "1"), // has 1: the better stands, the word as the fitting writes it
      fit("Spikes", "Brutal", "upgrade", "0"), // gained, unrated
      fit("Spare", "Sniper", "add", "2"), // not there: untouched
      fit("Odd", "Bulky", "multiply", "2"), // not a Trait mode: nothing
    ],
  });
  assert.deepEqual(out.traits, ["Rapid Fire (1)", "keen (1)", "Brutal"]);
  assert.deepEqual(by, ["Drum", "Brace", "Edge", "Spikes"]);
  // Comma text is read as words; a fitting that moves a rating to 0 takes the Trait off.
  const sling = withFittedCard({ card: { traits: "Far, Light (1)" }, fitted: [fit("Cut", "Light", "add", "-1")] });
  assert.deepEqual(sling.card.traits, ["Far"]);
  // No Trait effect: the card is as it was.
  assert.deepEqual(withFittedCard({ card, fitted: [] }).card, card);
});
