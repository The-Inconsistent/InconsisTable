import assert from "node:assert/strict";
import { test } from "node:test";

import { locate } from "./json-locate.ts";

const text = `{
  "id": "p",
  "entries": [
    { "key": "a", "cite": "Sample p.1", "body": { "attr.str": 12, "blurb": "x" } },
    { "key": "b", "body": { "attr.dex": 3 } }
  ]
}`;
const at = (path: string) => {
  const r = locate(text, path);
  return { exact: r.exact, text: text.slice(r.start, r.end) };
};

test("a path lands on the value it names", () => {
  assert.deepEqual(at("id"), { exact: true, text: '"p"' });
  assert.deepEqual(at("entries[0].cite"), { exact: true, text: '"Sample p.1"' });
  assert.deepEqual(at("entries[1].key"), { exact: true, text: '"b"' });
});

test("a field id with a dot is one key", () => {
  assert.deepEqual(at("entries[0].body.attr.str"), { exact: true, text: "12" });
  assert.deepEqual(at("entries[1].body.attr.dex"), { exact: true, text: "3" });
});

test("a path that goes past the text stops at the nearest object that exists", () => {
  const missing = locate(text, "entries[1].cite");
  assert.equal(missing.exact, false);
  assert.equal(text.slice(missing.start, missing.start + 1), "{");
  assert.equal(locate(text, "entries[9].cite").exact, false);
});

test("the root, and text that is not valid JSON, do not throw", () => {
  assert.deepEqual(locate(text, "(root)").start, 0);
  assert.equal(locate('{ "a": [1, 2', "a[1]").exact, true);
  assert.equal(locate("not json", "a").exact, false);
});
