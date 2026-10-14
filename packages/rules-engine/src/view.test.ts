import assert from "node:assert/strict";
import { test } from "node:test";

import { compileRuleset, type CompiledRuleset } from "./compile.ts";
import { SAMPLE_D20 } from "./fixtures/sample-d20.ts";
import { toViewerView, type ActorView, type Viewer } from "./view.ts";

function compiled(): CompiledRuleset {
  const r = compileRuleset(SAMPLE_D20);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.compiled;
}
const C = compiled();

const HERO: ActorView = {
  id: "pc1",
  entity: "character",
  fields: { name: "Ash", level: 3, "attr.dex": 16, diary: "dear diary", gmNote: "secretly royal", undeclared: 1 },
  resources: { hp: 9, focus: 1 },
  derived: { maxHp: 15, initBonus: 3 },
  conditions: ["dazed", "marked"],
};
const OGRE: ActorView = {
  id: "npc1",
  entity: "creature",
  fields: { name: "Ogre", "attr.con": 18, healthState: "ok" },
  resources: { hp: 30 },
  derived: { maxHp: 31 },
  conditions: ["braced"],
};
const GHOST: ActorView = {
  id: "x",
  entity: "phantom",
  fields: { name: "?" },
  resources: { hp: 1 },
  derived: {},
  conditions: [],
};

function view(viewer: Viewer, actors: ActorView[] = [HERO, OGRE, GHOST]) {
  return toViewerView({ compiled: C, viewer, actors }).actors;
}

test("the public sees public values only", () => {
  const [hero, ogre] = view({ role: "public", characterIds: [] });
  assert.deepEqual(hero?.fields, { name: "Ash" });
  assert.deepEqual(hero?.resources, {});
  assert.deepEqual(hero?.derived, {});
  assert.deepEqual(hero?.conditions, []);
  assert.deepEqual(ogre?.fields, { name: "Ogre" });
});

test("the ruleset's view function runs after the visibility filter", () => {
  const out = toViewerView({
    compiled: C,
    viewer: { role: "player", characterIds: ["pc1"] },
    actors: [HERO, OGRE],
    // A ruleset may transform, not only hide: here enemies' Vigour is shown as bloodied or not.
    rulesetView: (v) => ({
      ...v,
      actors: v.actors.map((a) => {
        if (a.entity !== "creature") return a;
        // It sees the already-filtered actor: the creature's maxHp never reached it.
        assert.equal(a.derived.maxHp, undefined);
        return { ...a, resources: { hp: (a.resources.hp ?? 0) > 15 ? 1 : 0 } };
      }),
    }),
  });
  assert.deepEqual(out.actors[1]?.resources, { hp: 1 });
  assert.deepEqual(out.viewer, { role: "player", characterIds: ["pc1"] });
});
