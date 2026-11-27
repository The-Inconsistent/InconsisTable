import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset } from "./compile.ts";
import { SAMPLE_DUEL } from "./fixtures/sample-duel.ts";
import { SAMPLE_HARM } from "./fixtures/sample-harm.ts";
import { SAMPLE_SKIRMISH } from "./fixtures/sample-skirmish.ts";
import type { Panel, RulesetInput } from "./manifest.ts";
import type { TurnState } from "./primitives/primitive.ts";
import { fightOf } from "./spend.ts";
import { LAYOUT_TARGETS, widgetSpec } from "./widgets.ts";

const problems = (input: RulesetInput) => {
  const r = compileRuleset(input);
  return r.ok ? [] : r.problems.map((p) => `${p.path}: ${p.message}`);
};
const incoming = SAMPLE_HARM.panels![0]!;
const withPanel = (over: Partial<Panel> & Record<string, unknown>) =>
  problems({ ...SAMPLE_HARM, panels: [{ ...incoming, ...over }, ...SAMPLE_HARM.panels!.slice(1)] as Panel[] });

test("the three invented games compile with their panels and strips (house decisions #114, #115)", () => {
  for (const r of [SAMPLE_HARM, SAMPLE_SKIRMISH, SAMPLE_DUEL]) assert.deepEqual(problems(r), [], r.id);
  assert.ok(LAYOUT_TARGETS.includes("phoneStrip"));
  assert.equal(widgetSpec("panel")?.panel, true);
  assert.deepEqual(widgetSpec("spends")?.slots, []);
});

test("the validator checks what a panel names and that it shows something", () => {
  const one = (over: Record<string, unknown>) =>
    problems({ ...SAMPLE_HARM, layout: {}, panels: [{ ...incoming, ...over }] as Panel[] });
  assert.deepEqual(problems({ ...SAMPLE_HARM, layout: {}, panels: [incoming, incoming] }), [
    'panels[1].id: duplicate id "incoming"',
  ]);
  assert.deepEqual(withPanel({ cite: undefined }), ["panels[0].cite: a rule entry needs a cite"]);
  assert.deepEqual(one({ entities: ["nope", "growth"] }), [
    'panels[0].entities[0]: unknown entity "nope"',
    'panels[0].entities[1]: "growth" is not an actor entity',
  ]);
  assert.deepEqual(one({ holds: "nope", unless: "hurt" }), ['panels[0].holds: unknown state "nope"']);
  assert.deepEqual(one({ opensOn: { rises: "nope" } }), ['panels[0].opensOn: unknown resource "nope"']);
  assert.deepEqual(one({ spends: ["endure", "nope"] }), ['panels[0].spends[1]: unknown spend "nope"']);
  assert.deepEqual(one({ options: { entry: "nope" } }), ['panels[0].options.entry: unknown entity "nope"']);
  assert.deepEqual(one({ options: { entry: "stance", group: "kind", needs: "nope" } }), [
    'panels[0].options.group: "kind" is not a field of "stance"',
    'panels[0].options.needs: "nope" is not a text field of "stance"',
  ]);
  assert.deepEqual(one({ lines: undefined, figures: undefined }), ["panels[0]: a panel shows nothing"]);
  assert.deepEqual(
    problems({
      ...SAMPLE_SKIRMISH,
      layout: {},
      resources: [...(SAMPLE_SKIRMISH.resources ?? [])],
      panels: [{ ...SAMPLE_SKIRMISH.panels![0]!, opensOn: { rises: "momentum" } }],
    }),
    ['panels[0].opensOn: "momentum" must be an entity-scoped resource'],
  );
});

test("a panel widget names a panel every type of its layout shows", () => {
  const rows = (...phoneTurn: object[]) =>
    problems({ ...SAMPLE_HARM, layout: { hero: { sections: [], phoneTurn } } } as RulesetInput);
  assert.deepEqual(rows({ widget: "panel" }), ["layout.hero.phoneTurn[0].variant: a panel widget names a panel"]);
  assert.deepEqual(rows({ widget: "panel", variant: "nope" }), [
    'layout.hero.phoneTurn[0].variant: unknown panel "nope"',
  ]);
  assert.deepEqual(
    problems({ ...SAMPLE_HARM, layout: { sheet: { sections: [], phoneTurn: [{ widget: "panel", variant: "hit" }] } } }),
    ['layout.sheet.phoneTurn[0].variant: not every type here shows "hit"'],
  );
  assert.deepEqual(rows({ widget: "spends" }, { widget: "spends", bind: { x: "grit" } }), [
    'layout.hero.phoneTurn[1].bind.x: unknown slot "x"',
  ]);
  assert.deepEqual(
    problems({
      ...SAMPLE_HARM,
      layout: { hero: { sections: [], phoneStrip: [{ widget: "frames", bind: { values: ["nope"] } }] } },
    }),
    ['layout.hero.phoneStrip[0].bind.values[0]: unknown value "nope"'],
  );
});

test("a panel's expressions read the holder, ctx.self and ctx.fight; its options also the entry", () => {
  assert.deepEqual(withPanel({ when: "ctx.fight.acting && ctx.fight.held && !ctx.fight.foeActing" }), []);
  assert.deepEqual(withPanel({ when: "ctx.fight.nope" }), ['panels[0].when: unknown identifier "ctx.fight.nope"']);
  assert.deepEqual(withPanel({ when: "grit" }), ["panels[0].when: must be bool, got int"]);
  assert.deepEqual(withPanel({ lines: [{ text: "x", when: "hide > 0" }] }), [
    'panels[0].lines[0].when: unknown identifier "hide"',
  ]);
  assert.deepEqual(withPanel({ figures: [{ label: "F", expr: "gone" }] }), [
    "panels[0].figures[0].expr: must be int, got bool",
  ]);
  const moves = SAMPLE_SKIRMISH.panels![3]!;
  const skirmish = (usable: string) =>
    problems({
      ...SAMPLE_SKIRMISH,
      panels: [...SAMPLE_SKIRMISH.panels!.slice(0, 3), { ...moves, options: { ...moves.options!, usable } }],
    });
  assert.deepEqual(skirmish('entry.nerve <= res.nerve && entry.kind == "strike"'), []);
  assert.deepEqual(skirmish("entry.nope"), ['panels[3].options.usable: unknown identifier "entry.nope"']);
});

test("ctx.fight says who acts, who holds, and whether a foe acts (house decision #116)", () => {
  const turn = (over: Partial<TurnState>): { turn: TurnState } => ({
    turn: { round: 2, currentId: null, order: ["a", "b", "f"], sideOf: { a: "party", b: "party", f: "foe" }, ...over },
  });
  assert.deepEqual(fightOf({ turn: null }, "a"), {
    on: false,
    in: false,
    round: 0,
    barred: false,
    acting: false,
    held: false,
    foeActing: false,
  });
  const foe = fightOf(turn({ currentId: "f", held: ["a"] }), "a");
  assert.deepEqual([foe.acting, foe.held, foe.foeActing], [false, true, true]);
  const ally = fightOf(turn({ currentId: "b" }), "a");
  assert.deepEqual([ally.acting, ally.foeActing], [false, false]);
  const self = fightOf(turn({ currentId: "a" }), "a");
  assert.deepEqual([self.acting, self.foeActing], [true, false]);
  // Someone not in the order (a hidden one the seat is not sent) acts: another side's.
  assert.equal(fightOf(turn({ currentId: "?" }), "a").foeActing, true);
  // An actor outside the fight never has a foe acting.
  assert.equal(fightOf(turn({ currentId: "f" }), "x").foeActing, false);
  // A side is read only where the map holds it: `constructor` is no side.
  assert.equal(
    fightOf(turn({ currentId: "constructor", order: ["a", "constructor"], sideOf: {} }), "a").foeActing,
    false,
  );
});
