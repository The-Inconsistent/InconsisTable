import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveLocale } from "./locale.ts";

const resolve = (cookie: string | null, acceptLanguage: string | null) => resolveLocale({ cookie, acceptLanguage });

test("the cookie wins over the browser", () => {
  assert.equal(resolve("vi", "en-US"), "vi");
  assert.equal(resolve("en", "vi"), "en");
});

test("an unknown cookie is ignored", () => {
  assert.equal(resolve("fr", "vi"), "vi");
});

test("Accept-Language is read by weight and by primary subtag", () => {
  assert.equal(resolve(null, "vi-VN,vi;q=0.9,en;q=0.8"), "vi");
  assert.equal(resolve(null, "fr;q=0.9, en;q=0.5, vi;q=0.7"), "vi");
  assert.equal(resolve(null, "en-GB"), "en");
});

test("anything else falls back to English", () => {
  assert.equal(resolve(null, "fr-FR,de;q=0.8"), "en");
  assert.equal(resolve(null, null), "en");
  assert.equal(resolve(null, "vi;q=0"), "en");
});
