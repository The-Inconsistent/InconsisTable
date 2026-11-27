import assert from "node:assert/strict";
import { test } from "node:test";

import { exportName, exportReport, pictureCount } from "./room-export";

test("the export's report, and nothing when it is missing or not one", () => {
  const report = { pictures: 2, packs: 1, items: 3, sources: 0 };
  assert.deepEqual(exportReport(JSON.stringify(report)), report);
  assert.equal(exportReport(null), null);
  assert.equal(exportReport("not json"), null);
  assert.equal(exportReport('{"pictures":2}'), null);
});

test("the file's name, or a plain one", () => {
  assert.equal(exportName('attachment; filename="harbour-watch.room.json"'), "harbour-watch.room.json");
  assert.equal(exportName(null), "room.room.json");
});

test("pictures are counted once each", () => {
  assert.equal(pictureCount([{ imageId: "a" }, { imageId: null }, { imageId: "a" }, { imageId: "b" }]), 2);
  assert.equal(pictureCount([]), 0);
});
