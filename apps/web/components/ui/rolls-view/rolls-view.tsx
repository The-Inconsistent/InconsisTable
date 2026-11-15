import { useTranslations } from "next-intl";

import type { RollRow } from "@inconsistable/core-schema";

type RollsViewProps = {
  rolls: readonly RollRow[];
  /** Table titles by id; the screen reads none from a ruleset, so a roll without one shows only what came up. */
  titles?: Readonly<Record<string, string>>;
};

// What the table last rolled, for the TV (house decision #49): the newest in large type, the two before it small. The
// screen was only sent the rolls of `party` tables.
export function RollsView({ rolls, titles = {} }: RollsViewProps) {
  const t = useTranslations("tables");
  const [latest, ...before] = rolls.slice(0, 3);
  if (!latest) return null;
  return (
    <section className="stack rolls-view" aria-label={t("recentRolls")}>
      <output className="table-result table-result-tv" key={latest.id}>
        {titles[latest.tableId] && <span className="dim">{titles[latest.tableId]}</span>}
        <span className="table-face">{latest.label}</span>
      </output>
      {before.length > 0 && (
        <ul className="rolls-before">
          {before.map((r) => (
            <li key={r.id} className="dim">
              {r.label}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
