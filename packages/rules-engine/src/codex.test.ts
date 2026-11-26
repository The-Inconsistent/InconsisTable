import assert from "node:assert/strict";
import { test } from "node:test";

import { codexReminders, offeredValues, partyReadsReminder, partyReminders, rowTests } from "./codex.ts";
import { compileRuleset } from "./compile.ts";
import { checkFieldValue, fitRows } from "./field-value.ts";
import { SAMPLE_D20_0_1_9 as SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import { SAMPLE_SKIRMISH } from "./fixtures/sample-skirmish.ts";
import type { CodexField, CodexKindDef, RulesetInput } from "./manifest.ts";

// House decision #89: tags, rows, a scene's pick and a kind's reminders, on the invented samples.

const compiled = (() => {
  const r = compileRuleset(SAMPLE_D20);
  assert.ok(r.ok);
  return r.compiled;
})();
const faction = compiled.ruleset.codex?.kinds.faction as CodexKindDef;
const dangers = compiled.ruleset.codex?.kinds.location?.fields.dangers as Extract<CodexField, { type: "rows" }>;

const problems = (codex: RulesetInput["codex"]) => {
  const r = compileRuleset({ ...SAMPLE_D20, codex });
  return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
};

test("both samples compile: the d20's tags, rows, pick and reminder, and the skirmish's party road log", () => {
  assert.equal(dangers.pick?.label, "Noticed");
  assert.equal(faction.reminders?.length, 1);
  const skirmish = compileRuleset(SAMPLE_SKIRMISH);
  assert.ok(skirmish.ok);
  const log = skirmish.compiled.ruleset.codex?.kinds.quest?.fields.log;
  assert.ok(log?.type === "rows" && log.visibility === "party" && log.from === undefined && log.pick === undefined);
});

test("a reminder shows while the entry's values meet it, and never on a value it cannot read", () => {
  const met = (fields: Record<string, unknown>) => codexReminders({ kind: faction, fields }).map((r) => r.id);
  assert.deepEqual(met({ standing: "ally", marks: ["Reedfolk", "Outsider"] }), ["outsiderAlly"]);
  assert.deepEqual(met({ standing: "rival", marks: ["Outsider"] }), []);
  assert.deepEqual(met({ standing: "ally", marks: ["outsider"] }), []);
  // A player's card holds only the party fields it was sent: unset reads meet nothing.
  assert.deepEqual(met({ marks: ["Outsider"] }), []);
  assert.deepEqual(met({}), []);
  assert.deepEqual(codexReminders({ kind: undefined, fields: {} }), []);
});

test("a reminder that reads a gm field is not one a party seat may be shown", () => {
  const reminder = faction.reminders?.[0];
  assert.ok(reminder);
  assert.equal(partyReadsReminder({ kind: faction, reminder }), false);
  const npc = compiled.ruleset.codex?.kinds.npc as CodexKindDef;
  assert.equal(partyReadsReminder({ kind: npc, reminder: { id: "r", if: 'fields.mood == "cold"', text: "T" } }), true);
  assert.equal(partyReadsReminder({ kind: npc, reminder: { id: "r", if: "has(fields.patron)", text: "T" } }), false);
});

test("a rows value is checked against its columns and names the row and column it refuses", () => {
  const check = (value: unknown) => checkFieldValue({ def: dangers, value });
  const row = (values: Record<string, unknown>, extra: object = {}) => [{ id: "d1", values, ...extra }];
  assert.equal(
    check(row({ name: "Wisp", threat: 3, strength: "fierce", check: { testId: "check", inputs: { dc: 12 } } })),
    null,
  );
  assert.equal(check(row({ threat: 21 })), "[0].values.threat: above the maximum of 20");
  assert.equal(check(row({ strength: "mild" })), "[0].values.strength: expected one of faint, fierce");
  assert.equal(
    check(row({ check: { testId: "check", extra: 1 } })),
    "[0].values.check: expected a Test and its inputs",
  );
  assert.equal(check(row({ nope: 1 })), "[0].values.nope: not a column");
  assert.equal(
    check(row({}, { from: { entity: "gear", key: "rope" } })),
    "[0].from.entity: not a type this field is filled from",
  );
  assert.equal(check([...row({}), ...row({})]), '[1].id: "d1" is there twice');
  assert.equal(check(Array.from({ length: 13 }, (_, i) => ({ id: `r${i}`, values: {} }))), "more than 12 rows");
});

test("a stored rows value keeps what still fits, row by row and cell by cell", () => {
  const fit = fitRows({ def: dangers, value: [{ id: "d1", values: { threat: 99, name: "Wisp", gone: 1 } }, "x"] });
  assert.deepEqual(fit, [{ id: "d1", values: { name: "Wisp" } }]);
  assert.equal(fitRows({ def: dangers, value: "x" }), null);
});

test("tags: words under the cap, none empty or twice", () => {
  const marks = faction.fields.marks as CodexField;
  assert.equal(checkFieldValue({ def: marks, value: ["Reedfolk", "Outsider"] }), null);
  assert.equal(checkFieldValue({ def: marks, value: ["a", "a"] }), "a word is there twice");
  assert.equal(checkFieldValue({ def: marks, value: [" "] }), "a word is empty");
  assert.equal(
    checkFieldValue({ def: marks, value: Array.from({ length: 11 }, (_, i) => `w${i}`) }),
    "more than 10 words",
  );
});

test("refused at import, by path: a prefill that does not fit, suggestions from nowhere, a reminder it cannot read", () => {
  const kinds = compiled.ruleset.codex?.kinds ?? {};
  const location = (over: object) => ({
    kinds: { ...kinds, location: { fields: { dangers: { ...dangers, ...over } } } },
  });
  assert.deepEqual(problems(location({ from: [{ entity: "creature", name: "threat" }] })), [
    'codex.kinds.location.fields.dangers.from[0].name: "threat" is not a text column',
  ]);
  assert.deepEqual(problems(location({ from: [{ entity: "creature", values: { strength: "level" } }] })), [
    'codex.kinds.location.fields.dangers.from[0].values.strength: "level" does not fit the column',
  ]);
  assert.deepEqual(problems({ kinds: { faction: { fields: { m: { type: "tags", label: "M" } } } } }), [
    "codex.kinds.faction.fields.m: a tags field needs entities, options or writeIn",
  ]);
  assert.deepEqual(
    problems({ kinds: { faction: { fields: {}, reminders: [{ id: "r", if: "fields.nope", text: "T" }] } } }).length,
    1,
  );
});

test("in a reminder group only the first that holds shows, and a seat is sent none after one it is not (#172)", () => {
  const kind: CodexKindDef = {
    fields: {
      standing: { type: "enum", label: "S", values: ["ally", "rival"], visibility: "gm" },
      size: { type: "int", label: "N", visibility: "party" },
    },
    reminders: [
      { id: "secret", if: 'fields.standing == "rival"', text: "A", group: "mix" },
      { id: "big", if: "fields.size > 3", text: "B", group: "mix" },
      { id: "huge", if: "fields.size > 5", text: "C", group: "mix" },
      { id: "alone", if: "fields.size > 5", text: "D" },
    ],
  };
  const met = (fields: Record<string, unknown>) => codexReminders({ kind, fields }).map((r) => r.id);
  assert.deepEqual(met({ standing: "rival", size: 9 }), ["secret", "alone"]);
  assert.deepEqual(met({ standing: "ally", size: 9 }), ["big", "alone"]);
  assert.deepEqual(met({ size: 2 }), []);
  assert.deepEqual(
    partyReminders({ kind }).map((r) => r.id),
    ["alone"],
  );
  const open = { ...kind, reminders: kind.reminders?.slice(1) };
  assert.deepEqual(
    partyReminders({ kind: open }).map((r) => r.id),
    ["big", "huge", "alone"],
  );
});

test("a rows field rolls a table into rows, offers an enum from its entry and works a Test's inputs out (#173)", () => {
  const withDangers = (over: object) =>
    problems({
      kinds: {
        ...SAMPLE_D20.codex?.kinds,
        location: { fields: { dangers: { ...dangers, ...over } as CodexField } },
      },
    });
  assert.deepEqual(withDangers({ rolls: { table: "nope", into: "threat", times: "nope" } }), [
    'codex.kinds.location.fields.dangers.rolls.table: unknown table "nope"',
    'codex.kinds.location.fields.dangers.rolls.into: "threat" is not a text column',
    'codex.kinds.location.fields.dangers.rolls.times: "nope" is not a whole-number campaign field',
  ]);
  const columns = (c: object) => ({ columns: [...dangers.columns.filter((x) => x.type !== "test"), c] });
  assert.deepEqual(withDangers(columns({ id: "how", label: "H", type: "enum", values: ["a"], offer: "level" })), [
    'codex.kinds.location.fields.dangers.columns[4].offer: "level" is not a list or enum field of "creature"',
  ]);
  assert.deepEqual(
    withDangers(columns({ id: "t", label: "T", type: "test", inputs: { dc: "values.threat + 1" } })),
    [],
  );
  assert.equal(withDangers(columns({ id: "t", label: "T", type: "test", inputs: { dc: "values.nope" } })).length, 1);
  const cell = (inputs: object) =>
    checkFieldValue({
      def: { ...dangers, columns: [{ id: "t", label: "T", type: "test", each: "skill" }] },
      value: [{ id: "r", values: { t: { testId: "x", inputs } } }],
    });
  assert.equal(cell({ skill: ["Climb", "Swim"] }), null);
  assert.equal(cell({ dc: ["Climb"] }), "[0].values.t: an input is not a number, a word or a yes/no");
  assert.equal(cell({ skill: [] }), "[0].values.t: an input is not a number, a word or a yes/no");
});

test("a Test cell's chips: worked-out inputs under the cell's own, one per listed word (#173)", () => {
  const col = {
    id: "t",
    label: "T",
    type: "test" as const,
    inputs: { dc: "10 + campaign.season + values.threat" },
    each: "ability",
  };
  const values = { threat: 2 };
  assert.deepEqual(rowTests({ col, inputs: {}, values, campaign: { season: 3 } }), [{ dc: 15 }]);
  assert.deepEqual(rowTests({ col, inputs: { dc: 9, ability: ["str", "dex"] }, values, campaign: { season: 3 } }), [
    { dc: 9, ability: "str" },
    { dc: 9, ability: "dex" },
  ]);
  assert.deepEqual(rowTests({ col, inputs: {}, values: {} }), [{}], "an unreadable input is left for the GM");
  const strength = { id: "s", label: "S", type: "enum" as const, values: ["faint", "fierce"], offer: "strengths" };
  assert.deepEqual(offeredValues({ col: strength, body: { strengths: ["fierce", "odd"] } }), ["fierce"]);
  assert.deepEqual(offeredValues({ col: strength, body: undefined }), ["faint", "fierce"]);
});
