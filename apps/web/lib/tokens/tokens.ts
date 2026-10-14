// Raw colour values for the few places that can't read CSS variables (the QR canvas, the browser theme colour). They
// mirror the base Theme's palette in app/theme/lantern.css; TOKEN_NAMES says which token each one mirrors, and
// tokens.test.ts fails when they drift apart.
export const TOKENS = { ink: "#2a1b10", paper: "#f9f0da", band: "#170d07" } as const;
export const TOKEN_NAMES = { ink: "parchment-ink", paper: "parchment-hi", band: "wood-0" } as const;
