import assert from "node:assert/strict";
import { test } from "node:test";

import { needsRefresh, roomLook } from "./room.ts";
import { SAMPLE_WORLDS } from "./sample.ts";
import { worldLook, worldStyle } from "./world.ts";

const served = {
  versionId: "v1",
  slug: "hoarfrost",
  version: "0.1.0",
  name: "Hoarfrost",
  theme: SAMPLE_WORLDS.hoarfrost,
  handouts: null,
};

test("a room with no World served wears no look", () => {
  assert.equal(roomLook(null), null);
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
