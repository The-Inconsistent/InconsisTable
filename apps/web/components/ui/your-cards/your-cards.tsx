"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Actor, DealtRow } from "@inconsistable/core-schema";

type YourCardsProps = {
  dealt: readonly DealtRow[];
  /** The characters this seat holds. */
  held: readonly string[];
  actors: readonly Actor[];
  /** Table titles by id, for the back of a card; a table the seat cannot read has none. */
  titles: Readonly<Record<string, string>>;
};

// The cards dealt to this phone's characters (house decision #49), each face down until it is tapped, so a neighbour
// glancing over does not read it by accident. Tapping again turns it back. The seat was only sent its own cards.
export function YourCards({ dealt, held, actors, titles }: YourCardsProps) {
  const t = useTranslations("tables");
  const [up, setUp] = useState<ReadonlySet<string>>(new Set());
  const mine = dealt.filter((d) => held.includes(d.actorId));
  if (mine.length === 0) return null;
  const names = new Map(actors.map((a) => [a.id, a.name]));
  const showName = held.length > 1;

  // FLIP: turns one card face up or face down.
  const handleFlip = (key: string) =>
    setUp((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <section className="stack" aria-label={t("yourCards")}>
      <h2 className="head">{t("yourCards")}</h2>
      <ul className="hand">
        {mine.map((d) => {
          const key = `${d.tableId}:${d.actorId}`;
          const faceUp = up.has(key);
          const title = titles[d.tableId] ?? t("aCard");
          const who = showName ? (names.get(d.actorId) ?? "") : "";
          return (
            <li key={key}>
              <button className="playing-card" aria-pressed={faceUp} data-up={faceUp} onClick={() => handleFlip(key)}>
                {faceUp ? (
                  <span className="card-front">
                    <span className="dim">{who ? `${title} · ${who}` : title}</span>
                    <strong className="card-label">{d.label}</strong>
                    <span className="dim">{t("tapToHide")}</span>
                  </span>
                ) : (
                  <span className="card-back">
                    <span className="card-title">{title}</span>
                    {who && <span className="dim">{who}</span>}
                    <span className="dim">{t("tapToLook")}</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
