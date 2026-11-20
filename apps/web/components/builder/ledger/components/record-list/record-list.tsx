"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type ReactNode } from "react";

import { filterRows, REACH_FILTERS, type ListRow, type ReachFilter } from "@/lib/ledger/ledger";

import { LIST_PAGE, SEARCH_FROM } from "../../constants";

// A catalogue record as a list row: its name, a line of numbers and cite, its optional summary, and why it can't be
// taken. `blocked` is a reason of the step's own (above the Tier, not at creation).
export type RecordRow = ListRow & { meta?: ReactNode; summary?: string | undefined; blocked?: string | undefined };

type RecordListProps = {
  label: string;
  rows: readonly RecordRow[];
  onPick: (id: string) => void;
  // more filters of the step's own, shown beside the search
  tools?: ReactNode;
};

// A list of catalogue records to take or give back. Hundreds of rows stay light: it searches, hides what is out of
// reach unless asked, and renders a page at a time. A row says in words whether it is taken or closed, and why.
export function RecordList({ label, rows, onPick, tools }: RecordListProps) {
  const t = useTranslations("ledgerBuilder.list");
  const [query, setQuery] = useState("");
  const [reach, setReach] = useState<ReachFilter>("open");
  const [shown, setShown] = useState(LIST_PAGE);
  const matches = filterRows({ rows, query, reach });
  const someOut = rows.some((r) => r.reach.out && !r.taken);

  // Search: a new query starts again from the first page.
  const handleQuery = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setShown(LIST_PAGE);
  };

  return (
    <div className="stack lb-list">
      {(rows.length > SEARCH_FROM || someOut || tools) && (
        <div className="row lb-tools">
          {rows.length > SEARCH_FROM && (
            <label className="lb-search">
              <span className="sr-only">{t("search", { label })}</span>
              <input
                type="search"
                value={query}
                onChange={handleQuery}
                placeholder={t("searchPlaceholder")}
                maxLength={60}
              />
            </label>
          )}
          {tools}
          {someOut && (
            <span className="seg" role="group" aria-label={t("reachLabel")}>
              {REACH_FILTERS.map((f) => (
                <button key={f} type="button" className="btn sm" aria-pressed={reach === f} onClick={() => setReach(f)}>
                  {t(`reach.${f}`)}
                </button>
              ))}
            </span>
          )}
        </div>
      )}
      {rows.length > SEARCH_FROM && (
        <p className="small dim" role="status">
          {t("count", { shown: Math.min(shown, matches.length), total: matches.length })}
        </p>
      )}
      <ul className="list lb-rows" aria-label={label}>
        {matches.slice(0, shown).map((r) => (
          <li key={r.id}>
            <RecordButton row={r} onPick={onPick} />
          </li>
        ))}
      </ul>
      {matches.length === 0 && <p className="dim">{t("none")}</p>}
      {matches.length > shown && (
        <button type="button" className="btn" onClick={() => setShown(shown + LIST_PAGE)}>
          {t("more", { count: Math.min(LIST_PAGE, matches.length - shown) })}
        </button>
      )}
    </div>
  );
}

type RecordButtonProps = { row: RecordRow; onPick: (id: string) => void };

// One row: a toggle that takes the record or gives it back. A closed row stays readable, with its reasons.
function RecordButton({ row, onPick }: RecordButtonProps) {
  const t = useTranslations("ledgerBuilder.list");
  const closed = !row.taken && (row.reach.out || !!row.blocked);
  const why = [
    ...(row.reach.out ? [t("outOfReach")] : []),
    ...(row.blocked ? [row.blocked] : []),
    ...row.reach.unmet,
    ...row.reach.gm.map((what) => t("gmJudges", { what })),
  ];
  return (
    <button
      type="button"
      className="found lb-row"
      aria-pressed={row.taken}
      disabled={closed}
      onClick={() => onPick(row.id)}
    >
      <span className="lb-row-text">
        <span className="pick-name">{row.name}</span>
        {row.meta && <span className="small dim">{row.meta}</span>}
        {row.summary && <span className="small">{row.summary}</span>}
        {why.length > 0 && <span className="small lb-why">{why.join("; ")}</span>}
      </span>
      <span className="small lb-row-state">{row.taken ? t("taken") : closed ? t("closed") : t("take")}</span>
    </button>
  );
}
