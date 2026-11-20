import assert from "node:assert/strict";
import { test } from "node:test";

import { fitWithin, pictureUrl } from "./entry-picture.ts";

test("a picture's long side is brought down to 1024, never up, never under a pixel", () => {
  assert.deepEqual(fitWithin({ width: 4000, height: 3000 }), { width: 1024, height: 768 });
  assert.deepEqual(fitWithin({ width: 900, height: 2700 }), { width: 341, height: 1024 });
  assert.deepEqual(fitWithin({ width: 640, height: 480 }), { width: 640, height: 480 });
  assert.deepEqual(fitWithin({ width: 5000, height: 2 }), { width: 1024, height: 1 });
});

test("the picture's address is the room's, with both ids escaped", () => {
  assert.equal(pictureUrl({ campaignId: "c 1", imageId: "p/2" }), "/api/campaigns/c%201/images/p%2F2");
});
