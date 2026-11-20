"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { BookSource } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { Cite } from "@/components/ui/cite/cite";
import type { RequestPage } from "@/hooks/use-table/use-table";
import { sheetLinesOf } from "@/lib/ledger/table";

type LedgerLinesProps = {
  /** The saved sheet the ledger builder resolved (`actor.ledger.sheet`), when this seat receives it. */
  sheet: Record<string, unknown> | null | undefined;
  ruleset: Ruleset;
  books: readonly BookSource[];
  requestPage: RequestPage;
};

type Line = { key: string; name: string; cite?: string | undefined; numbers?: string; summary?: string | undefined };

// What a character bought with the ledger builder carries that its field rows do not: talents, abilities, weapons,
// gear and powers. Each line is a name, its cite, its numbers and the importer's summary; never the books' wording,
// which is not in the data. Read-only.
export function LedgerLines({ sheet, ruleset, books, requestPage }: LedgerLinesProps) {
  const t = useTranslations("sheet.ledger");
  const lines = sheetLinesOf(sheet);
  if (!lines) return null;
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
        numbers: [
          t("damage", { damage: w.damage, ed: String(w.ed) }),
          w.ap ? t("ap", { ap: w.ap }) : null,
          t("range", { range: w.range.join(" / ") }),
          w.salvo !== undefined && w.salvo !== null ? t("salvo", { salvo: w.salvo }) : null,
          ...w.traits,
        ]
          .filter((x) => x !== null)
          .join(" · "),
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
                numbers: [t("armour", { ar: lines.armour.ar }), ...lines.armour.traits].join(" · "),
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
                {l.summary && <span className="small dim">{l.summary}</span>}
              </span>
              {cite(l.cite)}
            </li>
          ))}
        </ul>
      </section>
    ));
}
