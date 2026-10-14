"use client";
import { useState, type ChangeEvent, type FormEvent } from "react";

import type { BookSource } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { Cite } from "@/components/ui/cite/cite";
import type { RequestPage } from "@/hooks/use-table/use-table";
import { summaryOf } from "@/lib/builder/builder";
import { RulesReply } from "@/lib/library/library";
import { appendPage, matching, rulesUrl, typeOptions } from "@/lib/rules-reader/rules-reader";
import { DURATION_WORDS } from "@/lib/sheet/sheet";

type RulesReaderProps = {
  campaignId: string;
  ruleset: Ruleset | null;
  /** The first page of entries, read on the server for this seat. */
  first: RulesReply;
  books: readonly BookSource[];
  requestPage: RequestPage;
};

// RULES, reading side: the conditions and house decisions of the ruleset, and the pack entries this seat may see, each
// with its cite. The api cuts the entries down per seat; this only searches and pages them.
export function RulesReader({ campaignId, ruleset, first, books, requestPage }: RulesReaderProps) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [entries, setEntries] = useState(first.entries);
  const [total, setTotal] = useState(first.total);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const defs = new Map(ruleset?.entities.map((e) => [e.id, e]));

  // Reads one page of entries for a search and type; `append` adds to what is shown instead of replacing it.
  const load = async ({ q, type, append }: { q: string; type: string; append: boolean }) => {
    setBusy(true);
    try {
      const res = await fetch(rulesUrl({ campaignId, q, type, offset: append ? entries.length : 0 }));
      const page = RulesReply.safeParse(res.ok ? await res.json() : null);
      if (!page.success) throw new Error("bad reply");
      setEntries((cur) => (append ? appendPage({ shown: cur, next: page.data.entries }) : page.data.entries));
      setTotal(page.data.total);
      setError(null);
    } catch {
      setError("Couldn't read the rules. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  // SEARCH: looks the name up among the pack entries.
  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    void load({ q, type, append: false });
  };
  // TYPE filter: shows one kind of entry.
  const handleType = (e: ChangeEvent<HTMLSelectElement>) => {
    setType(e.target.value);
    void load({ q, type: e.target.value, append: false });
  };

  const conditions = matching({ items: ruleset?.conditions ?? [], q, text: (c) => c.label });
  const decisions = matching({ items: ruleset?.decisions ?? [], q, text: (d) => d.text });
  const cite = (c: string | null | undefined) =>
    c && ruleset ? (
      <Cite cite={c} {...{ ruleset, books, requestPage }} />
    ) : c ? (
      <span className="small dim">{c}</span>
    ) : null;

  return (
    <div className="stack" style={{ gap: 24, maxWidth: 640 }}>
      <form className="row" role="search" onSubmit={handleSearch}>
        <input
          id="rules-search"
          type="search"
          aria-label="Search the rules by name"
          placeholder="Search by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <select id="rules-type" aria-label="Filter entries by type" value={type} onChange={handleType}>
          <option value="">All types</option>
          {typeOptions({ ruleset, entries }).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={busy}>
          Search
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {conditions.length > 0 && (
        <section className="stack">
          <h2 className="head">Conditions</h2>
          <ul className="list">
            {conditions.map((c) => (
              <li key={c.id}>
                <span className="stack" style={{ gap: 2 }}>
                  <strong>{c.label}</strong>
                  <span className="small dim">Lasts {DURATION_WORDS[c.duration]}</span>
                  {cite(c.cite)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {decisions.length > 0 && (
        <section className="stack">
          <h2 className="head">House decisions</h2>
          <ul className="list">
            {decisions.map((d) => (
              <li key={d.id}>
                <span className="stack" style={{ gap: 2 }}>
                  <span>{d.text}</span>
                  {cite(d.cite)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="stack">
        <h2 className="head">Entries</h2>
        {entries.length === 0 ? (
          <p className="dim">{first.packs.length === 0 ? "No pack is attached to this table." : "No entry matches."}</p>
        ) : (
          <ul className="list">
            {entries.map((e) => (
              <li key={`${e.pack}/${e.type}/${e.key}`}>
                <span className="stack" style={{ gap: 2 }}>
                  <span>
                    <strong>{e.name}</strong> <span className="chip">{e.type}</span>
                    {e.level !== null && <span className="chip">Level {e.level}</span>}
                  </span>
                  <span className="small dim">{summaryOf({ entry: e, def: defs.get(e.type) })}</span>
                  {cite(e.cite)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {entries.length < total && (
          <button className="btn" disabled={busy} onClick={() => load({ q, type, append: true })}>
            Show more ({total - entries.length} left)
          </button>
        )}
      </section>
    </div>
  );
}
