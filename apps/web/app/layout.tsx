import type { Viewport } from "next";
import { Be_Vietnam_Pro, Fraunces, Literata } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { AuthProvider } from "@inconsistable/auth/react";

import { TOKENS } from "@/lib/tokens/tokens";

import "./theme/lantern.css";
import "./globals.css";
import "./theme/felt.css";

// Be Vietnam Pro: one body face for both languages, with a Vietnamese subset. (Atkinson Hyperlegible Next, which reads
// well at a distance, has no Vietnamese subset on Google Fonts, so a Vietnamese mark would fall to the system face.)
const text = Be_Vietnam_Pro({
  subsets: ["latin", "latin-ext", "vietnamese"],
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

export async function generateMetadata() {
  const t = await getTranslations("meta");
  return { title: t("title"), description: t("description") };
}
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: TOKENS.band,
};

type RootLayoutProps = { children: React.ReactNode };

export default async function RootLayout({ children }: RootLayoutProps) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${text.variable} ${display.variable} ${feltDisplay.variable} ${theme}`.trim()}>
      <body className="surface-app">
        <NextIntlClientProvider>
          <AuthProvider>{children}</AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
