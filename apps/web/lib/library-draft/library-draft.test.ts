import assert from "node:assert/strict";
import { test } from "node:test";

import { draftKey, newerLocal, sameBuild } from "./library-draft";

test("this browser's copy wins only over the revision it was made on", () => {
  const stored = JSON.stringify({ rev: 4, build: '{"tier":1}' });
  assert.equal(newerLocal({ stored, rev: 4 }), '{"tier":1}', "its last change never reached the server");
  assert.equal(newerLocal({ stored, rev: 5 }), null, "the server saved since: the server's wins");
  assert.equal(newerLocal({ stored: null, rev: 1 }), null);
  assert.equal(newerLocal({ stored: "not json", rev: 1 }), null);
  assert.equal(newerLocal({ stored: '{"rev":"4"}', rev: 1 }), null);
});

test("builds compare as documents, and each user keeps their own copy", () => {
  assert.ok(sameBuild('{"tier":1, "skills":{"Lore":2}}', '{"tier":1,"skills":{"Lore":2}}'));
  assert.ok(!sameBuild('{"tier":1}', '{"tier":2}'));
  assert.ok(!sameBuild('{"tier":1}', null));
  assert.ok(!sameBuild("not json", "not json"));
  assert.notEqual(draftKey({ userId: "a", id: "c" }), draftKey({ userId: "b", id: "c" }));
});
