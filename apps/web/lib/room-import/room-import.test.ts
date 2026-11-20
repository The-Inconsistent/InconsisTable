import assert from "node:assert/strict";
import { test } from "node:test";

import { readRoomImport } from "./room-import";

const REPLY = {
  campaignId: null,
  name: "Harbour Watch",
  expects: [{ what: "ruleset", slug: "sample-d20", version: "0.1.3", imported: true }],
  counts: { actors: { pc: 1 }, entries: { scene: 2 }, pictures: 1, sessions: 2, clocks: 1 },
};

test("a dry run's reply, a refusal with its path, and anything else", () => {
  assert.deepEqual(readRoomImport({ status: 200, body: REPLY }), { ok: true, reply: REPLY });
  const refusal = { code: "roomNoSuchEntry", message: "No such entry in this document.", path: "codex[2].links[0]" };
  assert.deepEqual(readRoomImport({ status: 422, body: refusal }), { ok: false, refusal });
  assert.deepEqual(readRoomImport({ status: 500, body: null }), { ok: false, refusal: null });
  assert.equal(readRoomImport({ status: 422, body: REPLY }).ok, false, "a reply only counts on success");
});
