import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Fraunces, Literata } from "next/font/google";

import { AuthProvider } from "@inconsistable/auth/react";

import { TOKENS } from "@/lib/tokens/tokens";

import "./theme/lantern.css";
import "./globals.css";
import "./theme/felt.css";

// Atkinson Hyperlegible: made to stay readable at a distance and in poor light, which is a game table at night. It has
// no Vietnamese subset, so a Vietnamese mark falls back to the system face (see --font-body).
const text = Atkinson_Hyperlegible({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "700"],
  variable: "--font-text",
});
// Fraunces, the base Theme's display face: a soft, warm serif for titles, character names and card headings. Its
// SOFT and WONK axes give the candle-lit roundness. Covers Vietnamese.
const display = Fraunces({
  subsets: ["latin", "latin-ext", "vietnamese"],
  axes: ["SOFT", "WONK", "opsz"],
  variable: "--font-display-face",
});
// Literata, felt's display face. Only fetched when the felt Theme uses it. Covers Vietnamese.
const feltDisplay = Literata({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["600"],
  variable: "--font-display-felt",
  preload: false,
});

// felt is a second Theme that proves a World can re-map the tokens. It is chosen by the environment in dev and test
// only, never in production and never from the UI.
// ponytail: one Theme per deployment, upgrade: the World a room belongs to picks its Theme (P2).
const theme = process.env.NODE_ENV !== "production" && process.env.INCONSISTABLE_THEME === "felt" ? "theme-felt" : "";

export const metadata: Metadata = {
  title: "InconsisTable",
  description: "A table companion for in-person tabletop RPGs",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: TOKENS.band,
};

type RootLayoutProps = { children: React.ReactNode };

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className={`${text.variable} ${display.variable} ${feltDisplay.variable} ${theme}`.trim()}>
      <body className="surface-app">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
