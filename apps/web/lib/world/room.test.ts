import assert from "node:assert/strict";
import { test } from "node:test";

import { needsRefresh, roomBand, roomLook } from "./room.ts";
import { SAMPLE_WORLDS } from "./sample.ts";
import { worldLook, worldStyle } from "./world.ts";

const served = {
  versionId: "v1",
  slug: "hoarfrost",
  version: "0.1.0",
  name: "Hoarfrost",
  theme: SAMPLE_WORLDS.hoarfrost,
  handouts: null,
  terms: null,
};

test("a room with no World served wears no look", () => {
  assert.equal(roomLook(null), null);
  assert.equal(roomBand({ world: null }), null);
});

test("the browser's colour is the World's band: one colour for one set, one per system setting for two", () => {
  const one = { ...served, theme: { ...served.theme, schemes: { dark: { band: "#101820" } } } };
  assert.equal(roomBand({ world: one }), "#101820");
  assert.equal(roomBand({ world: one, picked: "light" }), "#101820", "a World with one set always shows it");
  const two = { ...served, theme: { ...served.theme, schemes: { light: { "wood-0": "#203040" }, dark: {} } } };
  assert.deepEqual(roomBand({ world: two }), [
    { media: "(prefers-color-scheme: light)", color: "#203040" },
    { media: "(prefers-color-scheme: dark)", color: "#170d07" },
  ]);
  assert.equal(roomBand({ world: two, picked: "light" }), "#203040", "the device's own pick wins");
  assert.equal(roomBand({ world: two, picked: "dark" }), "#170d07");
});

test("a room's served World is worn as the World's attributes and style", () => {
  const look = worldLook(SAMPLE_WORLDS.hoarfrost);
  assert.deepEqual(roomLook(served), { attributes: look.attributes, style: worldStyle(look) });
});

test("the first snapshot, or a snapshot with the World the page was rendered with, refreshes nothing", () => {
  assert.equal(needsRefresh({ rendered: "v1", live: undefined, refreshed: undefined }), false);
  assert.equal(needsRefresh({ rendered: "v1", live: "v1", refreshed: undefined }), false);
  assert.equal(needsRefresh({ rendered: null, live: null, refreshed: undefined }), false);
});

test("a World pinned, changed or taken off refreshes the page", () => {
  assert.equal(needsRefresh({ rendered: null, live: "v1", refreshed: undefined }), true);
  assert.equal(needsRefresh({ rendered: "v1", live: "v2", refreshed: "v1" }), true);
  assert.equal(needsRefresh({ rendered: "v1", live: null, refreshed: "v1" }), true);
});

test("a pin the page still renders without (not served) is refreshed for once, not again", () => {
  assert.equal(needsRefresh({ rendered: null, live: "v1", refreshed: "v1" }), false);
  // Taken off and pinned again: a new value, so one more refresh.
  assert.equal(needsRefresh({ rendered: null, live: "v2", refreshed: "v1" }), true);
});
