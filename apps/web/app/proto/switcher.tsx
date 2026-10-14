"use client";
// PROTOTYPE: floating switcher. Collapsed to one button so it never covers the bottom tabs on a phone.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { SCREENS, VARIANTS, type Screen, type Variant } from "./_data/variants";

export function Switcher() {
  const path = usePathname().split("/").filter(Boolean);
  const variant = path[1] as Variant | undefined;
  const screen = path[2] as Screen | undefined;
  const [open, setOpen] = useState(false);
  if (process.env.NODE_ENV === "production" || !variant || !(variant in VARIANTS)) return null;
  return (
    <div className="proto-bar" data-open={open}>
      <button className="proto-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Close" : `${variant} · ${screen ?? ""}`}
      </button>
      {open && (
        <div className="proto-panel">
          <div className="proto-row" role="group" aria-label="Variant">
            {(Object.keys(VARIANTS) as Variant[]).map((v) => (
              <Link key={v} href={`/proto/${v}/${screen ?? "phone"}`} aria-current={v === variant}>
                {v}
              </Link>
            ))}
          </div>
          <div className="proto-row" role="group" aria-label="Screen">
            {(Object.keys(SCREENS) as Screen[]).map((s) => (
              <Link key={s} href={`/proto/${variant}/${s}`} aria-current={s === screen}>
                {s}
              </Link>
            ))}
          </div>
          <div className="proto-row">
            <Link href="/proto">index</Link>
          </div>
        </div>
      )}
    </div>
  );
}
