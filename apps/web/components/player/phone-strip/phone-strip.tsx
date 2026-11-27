"use client";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import type { Actor, PoolState } from "@inconsistable/core-schema";
import type { LayoutRow, Ruleset } from "@inconsistable/rules-engine";

import { ValueCells } from "@/components/ui/value-cells/value-cells";
import { heldChips } from "@/lib/held/held";
import { stripCellsOf, stripPools } from "@/lib/phone-strip/phone-strip";

type PhoneStripProps = {
  ruleset: Ruleset;
  actor: Actor;
  /** The ruleset's `phoneStrip` rows for this character's type. */
  rows: readonly LayoutRow[];
  maxOf: (resource: string) => number | null;
  /** The shared pools this seat was sent, which a `pools.<id>` row draws (house decision #180). */
  pools: readonly PoolState[];
};

// The strip under the phone's header on every tab (house decision #115): the character's name and the short values its
// ruleset names, with its conditions and what it holds up. It sticks to the top and, once the page scrolls, folds to one
// line of the name and the values, so the tab below keeps the screen.
export function PhoneStrip({ ruleset, actor, rows, maxOf, pools }: PhoneStripProps) {
  const t = useTranslations("phoneStrip");
  const mark = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState(false);

  // Syncs with the page's scroll (an IntersectionObserver): the strip folds once the mark above it leaves the screen.
  useEffect(() => {
    const el = mark.current;
    if (el === null || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setFolded(entry?.isIntersecting === false));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const cells = stripCellsOf({ ruleset, actor, rows });
  const shared = stripPools({ rows, pools });
  const conditions = actor.conditions.flatMap((id) => ruleset.conditions.find((c) => c.id === id)?.label ?? []);
  const held = heldChips({ ruleset, actor });
  return (
    <>
      <div ref={mark} className="phone-strip-mark" aria-hidden="true" />
      <section className="phone-strip" data-folded={folded} aria-label={t("label", { name: actor.name })}>
        <strong className="phone-strip-name">{actor.name}</strong>
        <ValueCells actor={actor} cells={cells} maxOf={maxOf} />
        {shared.length > 0 && (
          <dl className="value-cells">
            {shared.map((p) => (
              <div key={p.id} className="value-cell" data-pool={p.id}>
                <dt>{p.label}</dt>
                <dd>
                  {p.value}
                  {p.max !== null && <span className="value-max"> / {p.max}</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {(conditions.length > 0 || held.length > 0) && (
          <ul className="row phone-strip-chips" aria-label={t("chips")}>
            {conditions.map((label) => (
              <li key={`c-${label}`} className="chip">
                {label}
              </li>
            ))}
            {held.map((h) => (
              <li key={`h-${h.label}-${h.item}`} className="chip" data-held="true">
                {h.item}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
