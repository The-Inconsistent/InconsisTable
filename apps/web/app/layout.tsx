import type { Viewport } from "next";
import { Be_Vietnam_Pro, Cinzel, Crimson_Pro, Fraunces, IBM_Plex_Mono, Literata } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import Script from "next/script";

import {
  SCHEME_COOKIE,
  THEME_COOKIE,
  resolveScheme,
  resolveTheme,
  schemeAttribute,
  themeClass,
} from "@/lib/theme/theme";
import { TOKENS } from "@/lib/tokens/tokens";

import "./theme/lantern.css";
import "./theme/motion.css";
import "./globals.css";
import "./theme/felt.css";
import "./theme/world.css";

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
// Literata, felt's display face and a World's pick for any role (the variable font, so it serves as body text too).
// Only fetched when a page uses it. Covers Vietnamese.
const feltDisplay = Literata({
  subsets: ["latin", "latin-ext", "vietnamese"],
  variable: "--font-display-felt",
  preload: false,
});
// The faces only a World picks (WORLD_TYPEFACES; theme/world.css maps each pick to one), fetched only when a page uses
// them. Cinzel, inscriptional capitals, has no Vietnamese: no metric fallback of its own, so a missing letter falls to
// the World's body face next in the stack, and a Vietnamese page sets its display text in that face outright.
const cinzel = Cinzel({
  subsets: ["latin", "latin-ext"],
  variable: "--font-cinzel",
  preload: false,
  adjustFontFallback: false,
});
// Crimson Pro, an old-style book serif, with its italic. Covers Vietnamese.
const crimsonPro = Crimson_Pro({
  subsets: ["latin", "latin-ext", "vietnamese"],
  style: ["normal", "italic"],
  variable: "--font-crimson-pro",
  preload: false,
});
// IBM Plex Mono, for printed-out and machine text. Covers Vietnamese.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "latin-ext", "vietnamese"],
  weight: ["400", "700"],
  variable: "--font-ibm-plex-mono",
  preload: false,
});
const FONT_VARIABLES = [text, display, feltDisplay, cinzel, crimsonPro, plexMono].map((f) => f.variable).join(" ");

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

// Runs before the first frame. html.motion turns on the entrances that start at opacity 0, so a page whose frames never
// run (frozen, scriptless) shows everything. A step back through history mirrors the page change: a cross-document one
// gets the "back" type at pagereveal, a client one (the Navigation API sees it first) the data-back attribute.
const MOTION_SCRIPT = `requestAnimationFrame(() => document.documentElement.classList.add("motion"));
if (window.navigation) {
  const back = (to, from) => !!from && to.index < from.index;
  addEventListener("pagereveal", (e) => {
    const a = navigation.activation;
    if (e.viewTransition && a?.navigationType === "traverse" && back(a.entry, a.from)) e.viewTransition.types.add("back");
  });
  navigation.addEventListener("navigate", (e) => {
    const traverseBack = e.navigationType === "traverse" && back(e.destination, navigation.currentEntry);
    document.documentElement.toggleAttribute("data-back", traverseBack);
  });
}`;

type RootLayoutProps = { children: React.ReactNode };

export default async function RootLayout({ children }: RootLayoutProps) {
  const locale = await getLocale();
  // Each device picks its Theme (the switch beside the language one); felt proves a World can re-map the tokens.
  // Inside a room whose World is on the page, the World's look replaces it (theme/world.css, lib/world, RoomWorld).
  const jar = await cookies();
  const theme = themeClass(resolveTheme(jar.get(THEME_COOKIE)?.value));
  // The colour set a World's room shows on this device, when the World brings both (theme/world.css reads it).
  const scheme = schemeAttribute(resolveScheme(jar.get(SCHEME_COOKIE)?.value));
  return (
    // suppressHydrationWarning: the motion script adds its class before React hydrates
    // ponytail: a Theme switch rewrites the class and drops "motion" until the next full load, entrances then just show
    <html lang={locale} className={`${FONT_VARIABLES} ${theme}`.trim()} data-scheme={scheme} suppressHydrationWarning>
      <body className="surface-app">
        <Script id="motion" strategy="beforeInteractive">
          {MOTION_SCRIPT}
        </Script>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
