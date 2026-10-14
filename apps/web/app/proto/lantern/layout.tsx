import { Fraunces } from "next/font/google";

import "./lantern.css";

// Fraunces: a soft, warm serif for titles and card headings; SOFT and WONK axes give it the candle-lit roundness.
const display = Fraunces({ subsets: ["latin"], axes: ["SOFT", "WONK", "opsz"], variable: "--font-lantern-display" });

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className={`proto-lantern ${display.variable}`}>{children}</div>;
}
