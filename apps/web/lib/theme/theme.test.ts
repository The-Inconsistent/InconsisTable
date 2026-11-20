import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveScheme, resolveTheme, schemeAttribute, themeClass } from "./theme.ts";

test("a device's Theme comes from its cookie, lantern for anything else", () => {
  assert.equal(resolveTheme("felt"), "felt");
  assert.equal(resolveTheme("lantern"), "lantern");
  assert.equal(resolveTheme(undefined), "lantern");
  assert.equal(resolveTheme("neon"), "lantern");
  assert.equal(themeClass("felt"), "theme-felt");
  assert.equal(themeClass("lantern"), "");
});

test("a device's colour set comes from its cookie, the system's for anything else", () => {
  assert.equal(resolveScheme("light"), "light");
  assert.equal(resolveScheme("dark"), "dark");
  assert.equal(resolveScheme("system"), "system");
  assert.equal(resolveScheme(undefined), "system");
  assert.equal(resolveScheme("sepia"), "system");
  assert.equal(schemeAttribute("dark"), "dark");
  assert.equal(schemeAttribute("system"), undefined);
});
