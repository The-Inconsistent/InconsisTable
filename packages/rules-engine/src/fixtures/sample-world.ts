import type { WorldInput } from "../world.ts";

/**
 * An invented World for tests: a tide-washed harbour town. Every name and colour is made up; it dresses no real book.
 * It brings both colour sets, moves the light card through the palette (`parchment`) and the rest by semantic name.
 */
export const SAMPLE_WORLD: WorldInput = {
  id: "sample-tidewater",
  version: "0.1.0",
  core: "^1.0.0",
  name: "Tidewater",
  theme: {
    schemes: {
      light: {
        parchment: "#eef3f0",
        "parchment-2": "#dbe6e1",
        ink: "#14302b",
        "ink-2": "#3d5a54",
        accent: "#1f6f78",
        "accent-ink": "#f4fbfa",
        link: "#1f5f8b",
        ok: "#2f6b3a",
        focus: "#1d3f9e",
      },
      dark: {
        wood: "#0f2326",
        "wood-2": "#173338",
        "wood-0": "#08181a",
        ink: "#e3f1ee",
        "ink-2": "#b5ccc7",
        accent: "#5fc1c9",
        "accent-ink": "#0b1a1c",
        link: "#8fd3ff",
        ok: "#9fd8a6",
        focus: "#ffd166",
        "focus-halo": "#0a1416",
      },
    },
    typefaces: { display: "cinzel", body: "literata" },
    texture: "paper",
    shapes: { corners: "square", cardEdge: "rounded", headingRule: "line", headingCase: "caps" },
  },
};
