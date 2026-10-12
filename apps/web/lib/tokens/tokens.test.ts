import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOKENS } from "./tokens.ts";

// The raw values must match the CSS variables they mirror, or the QR and the page drift apart.
test("tokens mirror globals.css", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  for (const [name, value] of Object.entries(TOKENS)) assert.match(css, new RegExp(`--${name}: ${value};`), name);
});
