import assert from "node:assert/strict";
import { test } from "node:test";

import { WorldTheme } from "@inconsistable/rules-engine";

import { worldLook, worldStyle } from "./world.ts";

const BASE_ATTRIBUTES = {
  "data-world": "",
  "data-texture": "wood",
  "data-corners": "soft",
  "data-card-edge": "torn",
  "data-card-crest": "none",
  "data-band-edge": "straight",
  "data-heading-rule": "none",
  "data-heading-case": "normal",
  "data-button-frame": "plate",
};

test("one set: its tokens only, the first of every list for the picks left out, no typeface written", () => {
  const look = worldLook(WorldTheme.parse({ schemes: { dark: { paper: "#101820", ink: "#e8eef4" } } }));
  assert.deepEqual(look, {
    attributes: { ...BASE_ATTRIBUTES, "data-schemes": "dark" },
    schemes: { dark: { "--paper": "#101820", "--ink": "#e8eef4" } },
  });
  assert.equal(worldStyle(look), ":root:has([data-world]){color-scheme:dark;--paper:#101820;--ink:#e8eef4;}");
});

test("both sets: each declared alone, the device's pick first and the system setting without one", () => {
  const look = worldLook(
    WorldTheme.parse({ schemes: { light: { paper: "#f4f1ea", accent: "#8a2b2b" }, dark: { paper: "#16161a" } } }),
  );
  assert.equal(look.attributes["data-schemes"], "light dark");
  assert.deepEqual(look.schemes, {
    light: { "--paper": "#f4f1ea", "--accent": "#8a2b2b" },
    dark: { "--paper": "#16161a" },
  });
  const style = worldStyle(look);
  assert.equal(
    style,
    [
      '@media (prefers-color-scheme: light){:root:not([data-scheme="dark"]):has([data-world]){color-scheme:light;--paper:#f4f1ea;--accent:#8a2b2b;}}',
      ':root[data-scheme="light"]:has([data-world]){color-scheme:light;--paper:#f4f1ea;--accent:#8a2b2b;}',
      '@media (prefers-color-scheme: dark){:root:not([data-scheme="light"]):has([data-world]){color-scheme:dark;--paper:#16161a;}}',
      ':root[data-scheme="dark"]:has([data-world]){color-scheme:dark;--paper:#16161a;}',
    ].join("\n"),
  );
  // the dark set leaves accent out: no dark rule names it, so the base Theme's stands
  assert.doesNotMatch(style.split("\n")[2]!, /--accent/);
});

test("a partial theme: the picks it makes are written, the rest take the first of their list", () => {
  const look = worldLook(
    WorldTheme.parse({
      schemes: { light: { band: "#20242a" } },
      typefaces: { display: "cinzel", mono: "ibm-plex-mono" },
      texture: "paper",
      shapes: { cardCrest: "spiked", headingRule: "quill", headingCase: "caps" },
    }),
  );
  assert.deepEqual(look.attributes, {
    ...BASE_ATTRIBUTES,
    "data-schemes": "light",
    "data-texture": "paper",
    "data-card-crest": "spiked",
    "data-heading-rule": "quill",
    "data-heading-case": "caps",
    "data-font-display": "cinzel",
    "data-font-mono": "ibm-plex-mono",
  });
  assert.equal(worldStyle(look), ":root:has([data-world]){color-scheme:light;--band:#20242a;}");
});

test("only the contract's tokens and plain hex values reach the style text", () => {
  // as an unparsed document could hold them: the function never trusts its caller with CSS
  const theme = {
    schemes: { light: { paper: "red;}body{display:none", ink: "#123456", "not-a-token": "#000000" } },
    typefaces: {},
    shapes: {},
  } as unknown as WorldTheme;
  assert.deepEqual(worldLook(theme).schemes, { light: { "--ink": "#123456" } });
});
