import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible } from "next/font/google";

import { AuthProvider } from "@inconsistable/auth/react";

import { TOKENS } from "@/lib/tokens/tokens";

import "./globals.css";

// Atkinson Hyperlegible: made to stay readable at a distance and in poor light, which is a game table at night.
const text = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-text" });

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
    <html lang="en" className={text.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
