import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveTheme, themeClass } from "./theme.ts";

test("a device's Theme comes from its cookie, lantern for anything else", () => {
  assert.equal(resolveTheme("felt"), "felt");
  assert.equal(resolveTheme("velvet"), "velvet");
  assert.equal(resolveTheme("lantern"), "lantern");
  assert.equal(resolveTheme(undefined), "lantern");
  assert.equal(resolveTheme("neon"), "lantern");
  assert.equal(themeClass("felt"), "theme-felt");
  assert.equal(themeClass("velvet"), "theme-velvet");
  assert.equal(themeClass("lantern"), "");
});
