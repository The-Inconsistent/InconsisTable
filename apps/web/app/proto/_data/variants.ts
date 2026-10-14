// PROTOTYPE (branch prototype/theme, never merged): the variants and the screens each one renders.
export const VARIANTS = {
  lantern: "Candlelit wood table",
  guild: "Iron and brass guild hall",
  felt: "Dark green felt game table",
} as const;
export type Variant = keyof typeof VARIANTS;

export const SCREENS = {
  phone: "Phone: sheet + Test prompt",
  track: "Tablet: TRACK",
  call: "Tablet: Test Call card",
} as const;
export type Screen = keyof typeof SCREENS;
