import assert from "node:assert/strict";
import { test } from "node:test";

import { SAMPLE_WORLD } from "./fixtures/sample-world.ts";
import { canonicalJson, sha256Hex } from "./pack-hash.ts";
import {
  contrastHundredths,
  MAX_WORLD_BYTES,
  validateWorld,
  WORLD_BASE_COLOURS,
  WORLD_COLOUR_SOURCES,
  WORLD_COLOUR_TOKENS,
  worldColours,
  worldHash,
  type WorldInput,
} from "./world.ts";

const world = (schemes: WorldInput["theme"]["schemes"]): WorldInput => ({
  id: "w",
  version: "1.0.0",
  core: "^1.0.0",
  name: "W",
  theme: { schemes },
});

const problems = (input: unknown) => {
  const r = validateWorld(input);
  return r.ok ? [] : r.problems.map((p) => `${p.path} | ${p.message}`);
};

test("the sample World and the base Theme itself pass", () => {
  assert.deepEqual(problems(SAMPLE_WORLD), []);
  assert.deepEqual(problems(world({ light: {}, dark: {} })), []);
});

test("the base table covers every token in both sets, and every source is a token the set holds", () => {
  for (const scheme of ["light", "dark"] as const) {
    assert.deepEqual(Object.keys(WORLD_BASE_COLOURS[scheme]).sort(), [...WORLD_COLOUR_TOKENS].sort());
    for (const [semantic, source] of Object.entries(WORLD_COLOUR_SOURCES[scheme])) {
      assert.equal(WORLD_BASE_COLOURS[scheme][semantic as "paper"], WORLD_BASE_COLOURS[scheme][source]);
    }
  }
});

test("a palette name moves the semantic names that read it; a semantic name set directly wins", () => {
  const moved = worldColours({ scheme: "light", colours: { parchment: "#ffffff" } });
  assert.equal(moved.paper, "#ffffff");
  assert.equal(worldColours({ scheme: "dark", colours: { parchment: "#ffffff" } }).paper, "#2a1a10");
  const won = worldColours({ scheme: "light", colours: { parchment: "#ffffff", paper: "#eeeeee" } });
  assert.equal(won.paper, "#eeeeee");
  // The dark ink is a value of its own, not the palette's.
  assert.equal(worldColours({ scheme: "dark", colours: { "parchment-ink": "#000000" } }).ink, "#f4e8cd");
});

test("contrast is exact at the floors: just under fails, exactly at and just over pass", () => {
  assert.equal(contrastHundredths("#ffffff", "#000000"), 2100);
  assert.equal(contrastHundredths("#000000", "#ffffff"), 2100);
  assert.equal(contrastHundredths("#bb17fe", "#ffffff"), 449); // 4.4999996
  assert.equal(contrastHundredths("#4966cd", "#ffecdd"), 450); // exactly 4.5 in the integer arithmetic
  assert.equal(contrastHundredths("#936c7a", "#ffffff"), 450); // 4.5000001
  assert.equal(contrastHundredths("#45a93f", "#ffffff"), 299);
  assert.equal(contrastHundredths("#e85934", "#84ffff"), 300); // exactly 3
  assert.equal(contrastHundredths("#989a30", "#ffffff"), 300);

  assert.deepEqual(problems(world({ dark: { "band-ink": "#bb17fe", band: "#ffffff" } })), [
    'theme.schemes.dark | "band-ink" on "band" is 4.49:1, under 4.5:1',
  ]);
  assert.deepEqual(problems(world({ dark: { "band-ink": "#4966cd", band: "#ffecdd" } })), []);
  assert.deepEqual(problems(world({ light: { "band-ink": "#936c7a", band: "#ffffff" } })), []);
  const focus = (fg: string, halo: string) => world({ light: { paper: "#ffffff", focus: fg, "focus-halo": halo } });
  assert.deepEqual(problems(focus("#45a93f", "#ffffff")), [
    'theme.schemes.light | "focus" on "paper" is 2.99:1, under 3:1',
    'theme.schemes.light | "focus" on "focus-halo" is 2.99:1, under 3:1',
  ]);
  assert.deepEqual(problems(focus("#e85934", "#84ffff")), []);
});

test("a set the World does not bring is not checked; one it brings is checked on its values over the base", () => {
  // Black ink on the dark base paper fails, but only when the dark set is brought.
  assert.deepEqual(problems(world({ light: { ink: "#2a1b10" } })), []);
  assert.deepEqual(problems(world({ dark: { ink: "#000000" } })), [
    'theme.schemes.dark | "ink" on "paper" is 1.25:1, under 4.5:1',
    'theme.schemes.dark | "ink" on "paper-2" is 1.46:1, under 4.5:1',
  ]);
  // Through the palette: a dark parchment sinks the light page's ink pairs and the card's.
  assert.ok(
    problems(world({ light: { parchment: "#2a1b10" } })).includes(
      'theme.schemes.light | "ink" on "paper" is 1.00:1, under 4.5:1',
    ),
  );
});

test("schema problems carry their paths; no set at all is refused", () => {
  assert.deepEqual(problems(world({})), ["theme.schemes | a World brings at least one colour set"]);
  assert.deepEqual(problems(world({ light: { ink: "red" } })), [
    "theme.schemes.light.ink | expected a colour like #1c1b1a",
  ]);
  assert.deepEqual(problems(world({ light: { ink: "#12345" } })), [
    "theme.schemes.light.ink | expected a colour like #1c1b1a",
  ]);
  assert.deepEqual(problems({ ...world({ light: {} }), name: "" }), [
    "name | Too small: expected string to have >=1 characters",
  ]);
  assert.deepEqual(problems({ ...world({ light: {} }), core: "one" }), ["core | use a semver range"]);
  assert.ok(
    problems({ ...world({ light: {} }), theme: { schemes: { light: { glow: "#ffffff" } } } })[0]?.startsWith(
      "theme.schemes.light |",
    ),
  );
  assert.deepEqual(problems(undefined), ["(root) | not a JSON document"]);
  assert.deepEqual(problems(null), ["(root) | Invalid input: expected object, received null"]);
});

test("a document over the cap is refused by its size alone", () => {
  const big = { ...world({ light: {} }), pad: "x".repeat(MAX_WORLD_BYTES) };
  const r = validateWorld(big);
  assert.ok(!r.ok);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0]?.message ?? "", /over the cap of 65536$/);
});

test("the hash is of the canonical parsed document: key order and written defaults do not change it", () => {
  const r = validateWorld(SAMPLE_WORLD);
  assert.ok(r.ok);
  const hash = worldHash(r.world);
  assert.equal(hash, sha256Hex(canonicalJson(r.world)));
  const again = validateWorld(Object.fromEntries(Object.entries(SAMPLE_WORLD).reverse()));
  assert.ok(again.ok);
  assert.equal(worldHash(again.world), hash);
  const plain = validateWorld(world({ light: {} }));
  const written = validateWorld({
    ...world({ light: {} }),
    theme: { schemes: { light: {} }, typefaces: {}, shapes: {} },
  });
  assert.ok(plain.ok && written.ok);
  assert.equal(worldHash(plain.world), worldHash(written.world));
  assert.notEqual(worldHash(plain.world), hash);
});

test("handout layouts: an unknown layout, a repeat and a name too long are refused at their paths", () => {
  const withHandouts = (handouts: unknown) => ({ ...world({ light: {} }), handouts });
  assert.deepEqual(problems(withHandouts({ layouts: ["plain", "form"], names: { form: "Ledger" } })), []);
  assert.deepEqual(problems(withHandouts({ layouts: ["scroll"] })), [
    'handouts.layouts[0] | Invalid option: expected one of "plain"|"tablet"|"form"|"transcript"|"proclamation"',
  ]);
  assert.deepEqual(problems(withHandouts({ layouts: ["form", "form"] })), [
    "handouts.layouts | a layout is listed twice",
  ]);
  assert.deepEqual(problems(withHandouts({ layouts: ["form"], names: { form: "n".repeat(41) } })), [
    "handouts.names.form | Too big: expected string to have <=40 characters",
  ]);
  assert.ok(
    problems(withHandouts({ layouts: ["form"], names: { scroll: "Scroll" } }))[0]?.startsWith("handouts.names |"),
  );
});

test("a World without handouts hashes as it did before the part existed", () => {
  const { handouts: _, ...before } = SAMPLE_WORLD;
  const r = validateWorld(before);
  assert.ok(r.ok);
  assert.equal(worldHash(r.world), "e880b4daac6decc62673b27326037fefa7b1475309cae24603ce4f058d8194e1");
  const listed = validateWorld({ ...before, handouts: { layouts: ["form"] } });
  assert.ok(listed.ok);
  assert.deepEqual(listed.world.handouts, { layouts: ["form"], names: {} });
});
