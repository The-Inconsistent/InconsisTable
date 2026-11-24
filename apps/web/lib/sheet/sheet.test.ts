import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset, Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_D20, SAMPLE_D20_BEFORE_WIDGETS } from "../../../../packages/rules-engine/src/fixtures/sample-d20.ts";
import { SAMPLE_HARM } from "../../../../packages/rules-engine/src/fixtures/sample-harm.ts";
import {
  canAskToSpend,
  pageOfCite,
  rangeOf,
  restsOf,
  rowsOf,
  sectionsOf,
  showJump,
  stepAction,
  stepsOf,
  timeLeft,
} from "./sheet.ts";

const ruleset = Ruleset.parse(SAMPLE_D20);
const plain = Ruleset.parse(SAMPLE_D20_BEFORE_WIDGETS);
const actor = {
  entity: "character",
  fields: { name: "Ash", level: 3, "attr.str": 14, "attr.dex": 16, "attr.con": 12, guard: 11 },
  resources: { hp: 9, tempHp: 0 },
  derived: { maxHp: 14, defense: 14 },
};

test("the layout for the entity (or the shared one) becomes sections, in its order, of the values the seat holds", () => {
  const sections = sectionsOf({ ruleset: plain, actor });
  assert.deepEqual(
    sections.map((s) => [s.id, s.parts.map((p) => (p.kind === "rows" ? p.rows.map((r) => r.id) : p.model.widget))]),
    [["abilities", [["attr.str", "attr.dex", "attr.con"]]]],
  );
  // A creature has no layout of its own: the shared one.
  const creature = sectionsOf({ ruleset, actor: { ...actor, entity: "creature" } });
  assert.deepEqual(
    creature.map((s) => rowsOf(s).map((r) => r.id)),
    [["attr.str", "attr.dex", "attr.con"]],
  );
});

test("a plain layout draws one run of value rows per section, as it did before widgets (house decision #83)", () => {
  for (const s of sectionsOf({ ruleset: plain, actor }))
    assert.deepEqual(
      s.parts.map((p) => p.kind),
      ["rows"],
    );
  assert.equal(showJump(sectionsOf({ ruleset: plain, actor })), false);
});

test("value rows between widgets run together, and each widget stands alone in its place", () => {
  const sections = sectionsOf({
    ruleset,
    actor: { ...actor, fields: { ...actor.fields, strain: 4, deathSaveSuccesses: 1, deathSaveFailures: 0 } },
  });
  const strain = sections.find((s) => s.id === "strain");
  assert.deepEqual(
    strain?.parts.map((p) => (p.kind === "rows" ? p.rows.map((r) => r.id) : p.model.widget)),
    ["pips", ["deathSaveSuccesses", "deathSaveFailures"]],
  );
  const vigour = sections.find((s) => s.id === "vigour");
  assert.deepEqual(
    vigour?.parts.map((p) => (p.kind === "rows" ? p.rows.map((r) => r.id) : p.model.widget)),
    ["track", ["tempHp"]], // focus is not sent to this seat: its track is not drawn
  );
  assert.equal(showJump(sections), true);
});

test("paths name a field, a derived value or a resource, and a value the seat does not hold is left out", () => {
  const custom = Ruleset.parse({
    ...SAMPLE_D20,
    layout: {
      character: {
        sections: [
          { id: "a", label: "A", show: ["derived.defense", "res.hp", "attr.str", "gmNote", "maxHp", "tempHp", "nope"] },
          { id: "empty", label: "Empty", show: ["gmNote"] },
        ],
      },
    },
  });
  const sections = sectionsOf({ ruleset: custom, actor });
  const rows = sections[0] ? rowsOf(sections[0]) : [];
  assert.deepEqual(
    rows.map((r) => `${r.kind}:${r.id}`),
    ["derived:defense", "resource:hp", "field:attr.str", "derived:maxHp", "resource:tempHp"],
  );
  assert.equal(sections.length, 1); // a section with nothing to show is dropped
  assert.equal(rows[0]?.cite, "Sample p.4");
});

test("without a layout the sheet lists numbers, resources, then details", () => {
  const bare = Ruleset.parse({ ...SAMPLE_D20, layout: {} });
  assert.deepEqual(
    sectionsOf({ ruleset: bare, actor }).map((s) => s.id),
    ["derived", "resources", "fields"],
  );
});

test("a player steps only what the resource lets its owner; the GM steps everything", () => {
  const withEdit = (editableBy: string, id = "focus") =>
    Ruleset.parse({
      ...SAMPLE_D20,
      resources: SAMPLE_D20.resources?.map((r) => (r.id === id ? { ...r, editableBy } : r)),
    });
  assert.deepEqual(stepsOf({ ruleset: withEdit("owner"), resource: "focus", gm: false }), { dec: true, inc: true });
  assert.deepEqual(stepsOf({ ruleset: withEdit("ownerSpendOnly"), resource: "focus", gm: false }), {
    dec: true,
    inc: false,
  });
  assert.deepEqual(stepsOf({ ruleset: withEdit("gm"), resource: "focus", gm: false }), { dec: false, inc: false });
  assert.deepEqual(stepsOf({ ruleset: withEdit("gm"), resource: "focus", gm: true }), { dec: true, inc: true });
  assert.deepEqual(stepsOf({ ruleset, resource: "unknown", gm: true }), { dec: false, inc: false });
  // HP moves only through the health track, which only the GM side runs, whatever its `editableBy`.
  assert.deepEqual(stepsOf({ ruleset: withEdit("owner", "hp"), resource: "hp", gm: false }), {
    dec: false,
    inc: false,
  });
  assert.deepEqual(stepsOf({ ruleset: withEdit("owner", "hp"), resource: "hp", gm: true }), { dec: true, inc: true });
});

test("in a harm ruleset its wounds, shock and members are read-only for every seat", () => {
  const harm = Ruleset.parse(SAMPLE_HARM);
  for (const resource of ["wounds", "strain", "members"]) {
    assert.deepEqual(stepsOf({ ruleset: harm, resource, gm: true }), { dec: false, inc: false }, resource);
    assert.equal(canAskToSpend({ ruleset: harm, resource }), false, resource);
  }
});

test("a player may ask the GM to spend only what they cannot change themselves, outside a health track", () => {
  const withEdit = (editableBy: string, id = "focus") =>
    Ruleset.parse({
      ...SAMPLE_D20,
      resources: SAMPLE_D20.resources?.map((r) => (r.id === id ? { ...r, editableBy } : r)),
    });
  assert.equal(canAskToSpend({ ruleset: withEdit("gm"), resource: "focus" }), true);
  assert.equal(canAskToSpend({ ruleset: withEdit("ownerSpendOnly"), resource: "focus" }), false);
  assert.equal(canAskToSpend({ ruleset: withEdit("owner"), resource: "focus" }), false);
  assert.equal(canAskToSpend({ ruleset: withEdit("gm", "hp"), resource: "hp" }), false);
  assert.equal(canAskToSpend({ ruleset, resource: "unknown" }), false);
});

test("a step on a health track's resource goes through the track: − is damage, + is heal", () => {
  assert.deepEqual(stepAction({ ruleset, actorId: "a1", resource: "hp", delta: -2 }), {
    type: "rule.op",
    primitive: "health.tracks",
    op: "damage",
    input: { actorId: "a1", amount: 2, track: "hp", critical: false },
  });
  assert.deepEqual(stepAction({ ruleset, actorId: "a1", resource: "hp", delta: 1 }), {
    type: "rule.op",
    primitive: "health.tracks",
    op: "heal",
    input: { actorId: "a1", amount: 1, track: "hp" },
  });
});

test("a step on any other resource is the resource.capped adjust op with a delta", () => {
  assert.deepEqual(stepAction({ ruleset, actorId: "a1", resource: "focus", delta: -1 }), {
    type: "rule.op",
    primitive: "resource.capped",
    op: "adjust",
    input: { actorId: "a1", resource: "focus", delta: -1 },
  });
});

test("only the rests some resource resets on are offered", () => {
  const events = restsOf(ruleset).map((b) => b.event);
  assert.ok(events.includes("shortRest") && events.includes("longRest"));
  const none = Ruleset.parse({ ...SAMPLE_D20, resources: [], health: { tracks: [], states: [] } });
  assert.deepEqual(restsOf(none), []);
});

test("a cite becomes a page of the source it names, or of the only source", () => {
  assert.deepEqual(pageOfCite({ cite: "Sample p.164", ruleset }), { source: "sample", page: 164 });
  assert.deepEqual(pageOfCite({ cite: "Sample d20 p.8-9", ruleset }), { source: "sample", page: 8 });
  assert.deepEqual(pageOfCite({ cite: "p.12", ruleset }), { source: "sample", page: 12 });
  assert.equal(pageOfCite({ cite: "Other p.3", ruleset }), null);
  assert.equal(pageOfCite({ cite: "no page", ruleset }), null);
});

test("a resource's bounds are worked out from the character, or not at all", () => {
  const c = compileRuleset(ruleset);
  assert.ok(c.ok);
  if (!c.ok) return;
  const range = rangeOf({ compiled: c.compiled, resource: "hp", actor, characters: 4 });
  assert.equal(range?.min, 0);
  assert.equal(range?.max, 14);
  assert.equal(
    rangeOf({ compiled: c.compiled, resource: "hp", actor: { ...actor, fields: {}, derived: {} }, characters: 4 }),
    null,
  );
});

test("the time left on a condition reads off its timer, or is empty without a count", () => {
  const timers = [
    { id: "a", expiresOn: "roundEnd", expiresAfter: 2 },
    { id: "b", expiresOn: "ownTurnEnd", expiresAfter: 1 },
    { id: "c", expiresOn: "manual", expiresAfter: null },
  ];
  assert.deepEqual(timeLeft({ timers, id: "a" }), { count: 2, unit: "round" });
  assert.deepEqual(timeLeft({ timers, id: "b" }), { count: 1, unit: "turn" });
  assert.equal(timeLeft({ timers, id: "c" }), null);
  assert.equal(timeLeft({ timers, id: "zzz" }), null);
});

test("a bound that reads the campaign is worked out from the campaign's values in play", () => {
  const tiered = Ruleset.parse({
    ...SAMPLE_D20,
    campaignFields: { danger: { type: "int", label: "Danger", min: 1, max: 5, default: 1, cite: "Sample p.14" } },
    resources: (SAMPLE_D20.resources ?? []).map((r) =>
      r.id === "hp" ? { ...r, max: "derived.maxHp + campaign.danger" } : r,
    ),
  });
  const c = compileRuleset(tiered);
  assert.ok(c.ok);
  if (!c.ok) return;
  assert.equal(rangeOf({ compiled: c.compiled, resource: "hp", actor, characters: 4 }), null);
  assert.equal(
    rangeOf({ compiled: c.compiled, resource: "hp", actor, characters: 4, campaign: { danger: 3 } })?.max,
    17,
  );
});
