import { Big_Shoulders } from "next/font/google";

import "./guild.css";

// PROTOTYPE variant "guild": Big Shoulders (formerly Big Shoulders Display) is the one display face (titles, names, card headings, stamped numbers).
const display = Big_Shoulders({
  subsets: ["latin", "vietnamese"],
  weight: ["600", "800"],
  variable: "--font-guild-display",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className={`proto-guild ${display.variable}`}>{children}</div>;
}
