import type { WorldInput } from "../world.ts";

/**
 * An invented World for tests: a tide-washed harbour town. Every name and colour is made up; it dresses no real book.
 * It brings both colour sets, moves the light card through the palette (`parchment`) and the rest by semantic name,
 * and picks every look a World can (#235): its own side colours, light handouts at night, slate readouts, a GM crest,
 * banded table heads, printed stat blocks and a chapter rail.
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
        "side-ally": "#1d4f9e",
        "side-foe": "#a8461a",
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
        "side-ally": "#8fb6ff",
        "side-foe": "#f0a060",
      },
    },
    typefaces: { display: "cinzel", body: "literata" },
    texture: "paper",
    shapes: {
      corners: "square",
      cardEdge: "rounded",
      headingRule: "line",
      headingCase: "caps",
      handoutPaper: "light",
      readout: "slate",
      gmSeal: "crest",
      tableHead: "band",
      statBlock: "printed",
      gmNav: "rail",
    },
  },
  // Three of the five layouts, in its own order and under its own names (ADR 0012, decision 6).
  handouts: {
    layouts: ["proclamation", "transcript", "plain"],
    names: { proclamation: "Harbour notice", transcript: "Signal log", plain: "Note" },
  },
};
