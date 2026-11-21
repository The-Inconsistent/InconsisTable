"use client";
import { useFormatter, useTranslations } from "next-intl";

/** A weapon's or an armour's numbers, as a build line or an entry's record prints them. */
export type CardValues = {
  damage?: unknown;
  ed?: unknown;
  ap?: unknown;
  range?: unknown;
  salvo?: unknown;
  traits?: unknown;
  ar?: unknown;
  /** The fitted items that changed a number (house decision #102). */
  by?: readonly string[];
};

const num = (v: unknown): v is number => typeof v === "number";

// One line of a weapon's or an armour's numbers, worded as the build's own lines are (damage and ED, AP, range, salvo,
// traits; or AR), then what is fitted to it that changed them. Values that are not there are left out.
export function CardNumbers({ card }: { card: CardValues }) {
  const t = useTranslations("sheet.ledger");
  const ti = useTranslations("sheet.items");
  const format = useFormatter();
  const traits = Array.isArray(card.traits) ? card.traits.filter((x): x is string => typeof x === "string") : [];
  const range = Array.isArray(card.range) ? card.range.filter(num) : [];
  const parts = [
    num(card.damage) ? t("damage", { damage: card.damage, ed: String(card.ed ?? 0) }) : null,
    num(card.ap) && card.ap !== 0 ? t("ap", { ap: card.ap }) : null,
    range.length > 0 ? t("range", { range: range.join(" / ") }) : null,
    num(card.salvo) ? t("salvo", { salvo: card.salvo }) : null,
    num(card.ar) ? t("armour", { ar: card.ar }) : null,
    ...traits,
  ].filter((x) => x !== null);
  if (parts.length === 0) return null;
  return (
    <span className="small" data-card-numbers="true">
      {parts.join(" · ")}
      {card.by && card.by.length > 0 && <span className="dim"> · {ti("with", { list: format.list(card.by) })}</span>}
    </span>
  );
}
