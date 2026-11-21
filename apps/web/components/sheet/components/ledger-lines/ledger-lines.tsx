"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { ActorItem, BookSource } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { CardNumbers, type CardValues } from "@/components/sheet/components/card-numbers/card-numbers";
import { Cite } from "@/components/ui/cite/cite";
import type { RequestPage } from "@/hooks/use-table/use-table";
import { withFitted } from "@/lib/items/items";
import { sheetLinesOf } from "@/lib/ledger/table";

type LedgerLinesProps = {
  /** The saved sheet the ledger builder resolved (`actor.ledger.sheet`), when this seat receives it. */
  sheet: Record<string, unknown> | null | undefined;
  ruleset: Ruleset;
  books: readonly BookSource[];
  requestPage: RequestPage;
  /** The kinds of line the layout already draws through its widgets (`weapons`, `armour`, `talents` ...). */
  skip?: ReadonlySet<string>;
  /** The items the character holds, for what is fitted to a weapon or the armour (house decision #102). */
  items?: readonly ActorItem[];
  /** Takes a fitted item off its line; absent where the seat may not. */
  onTakeOff?: (item: ActorItem, host: string) => void;
};

type Line = {
  key: string;
  name: string;
  cite?: string | undefined;
  numbers?: string;
  summary?: string | undefined;
  /** A weapon or the armour: its numbers with what is fitted to its line, and those items. */
  card?: CardValues;
  fitted?: ActorItem[];
};

// What a character bought with the ledger builder carries that its field rows do not: talents, abilities, weapons,
// gear and powers. Each line is a name, its cite, its numbers and the importer's summary; never the books' wording,
// which is not in the data. Read-only.
export function LedgerLines({ sheet, ruleset, books, requestPage, skip, items = [], onTakeOff }: LedgerLinesProps) {
  const t = useTranslations("sheet.ledger");
  const ti = useTranslations("sheet.items");
  // A line's numbers with what is fitted to it, as the server names a line (`<card>/<name>`).
  const fittedOn = (ref: string) => items.filter((x) => x.fittedLine === ref);
  const carded = (ref: string, card: CardValues) => {
    const fitted = fittedOn(ref);
    return { card: withFitted({ card, fitted }), fitted };
  };
  const read = sheetLinesOf(sheet);
  if (!read) return null;
  const drop = (kind: string) => skip?.has(kind) ?? false;
  const lines = {
    talents: drop("talents") ? [] : read.talents,
    abilities: drop("abilities") ? [] : read.abilities,
    weapons: drop("weapons") ? [] : read.weapons,
    armour: drop("armour") ? null : read.armour,
    gear: drop("gear") ? [] : read.gear,
    powers: drop("powers") ? [] : read.powers,
  };
  const rule =
    (prefix: string) => (r: { name: string; page?: string | undefined; summary?: string | undefined }, i: number) => ({
      key: `${prefix}-${i}`,
      name: r.name,
      cite: r.page,
      summary: r.summary,
    });
  const sections: { id: string; title: string; lines: Line[] }[] = [
    { id: "talents", title: t("talents"), lines: lines.talents.map(rule("t")) },
    { id: "abilities", title: t("abilities"), lines: lines.abilities.map(rule("a")) },
    {
      id: "weapons",
      title: t("weapons"),
      lines: lines.weapons.map((w, i) => ({
        key: `w-${i}`,
        name: w.count && w.count > 1 ? t("count", { name: w.name, count: w.count }) : w.name,
        ...carded(`weapons/${w.name}`, w),
      })),
    },
    {
      id: "gear",
      title: t("gear"),
      lines: [
        ...(lines.armour
          ? [
              {
                key: "armour",
                name: lines.armour.name,
                ...carded(`armour/${lines.armour.name}`, lines.armour),
              },
            ]
          : []),
        ...lines.gear.map((g, i) => ({ key: `g-${i}`, name: g })),
      ],
    },
    {
      id: "powers",
      title: t("powers"),
      lines: lines.powers.map((p, i) => ({
        key: `p-${i}`,
        name: p.name,
        cite: p.page,
        numbers: t("power", { dn: String(p.dn), activation: p.activation, duration: p.duration, range: p.range }),
        summary: p.summary,
      })),
    },
  ];
  const cite = (c: string | undefined): ReactNode => c && <Cite cite={c} {...{ ruleset, books, requestPage }} />;
  return sections
    .filter((s) => s.lines.length > 0)
    .map((s) => (
      <section key={s.id} className="stack sheet-card" data-ledger={s.id}>
        <h2 className="head">{s.title}</h2>
        <ul className="list ledger-lines">
          {s.lines.map((l) => (
            <li key={l.key}>
              <span className="stack" style={{ gap: 2 }}>
                <strong>{l.name}</strong>
                {l.numbers && <span className="small">{l.numbers}</span>}
                {l.card && <CardNumbers card={l.card} />}
                {l.fitted?.map((x) => (
                  <span key={x.id} className="row small item-fitted">
                    <span>{ti("fitted", { name: x.name })}</span>
                    {onTakeOff && (
                      <button
                        className="btn sm"
                        onClick={() => onTakeOff(x, l.name)}
                        aria-label={ti("takeOffLabel", { name: x.name, host: l.name })}
                      >
                        {ti("takeOff")}
                      </button>
                    )}
                  </span>
                ))}
                {l.summary && <span className="small dim">{l.summary}</span>}
              </span>
              {cite(l.cite)}
            </li>
          ))}
        </ul>
      </section>
    ));
}
