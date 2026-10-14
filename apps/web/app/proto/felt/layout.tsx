import { Young_Serif } from "next/font/google";

import "./felt.css";

// Young Serif: a sturdy, friendly old-style serif for titles, character names and the rank numerals on the cards.
const display = Young_Serif({ subsets: ["latin"], weight: "400", variable: "--font-young" });

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className={`proto-felt ${display.variable}`}>{children}</div>;
}
