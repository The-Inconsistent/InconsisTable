"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent } from "react";

import { CodexKind, type SessionRecap } from "@inconsistable/core-schema";

import { byKind, filterEntries, newestRevealed, treeRows, type KindFilter } from "@/lib/codex/codex";

import { EntryButton } from "../entry-button/entry-button";
import { EntryCard, type CardScope } from "../entry-card/entry-card";
import { Recaps } from "../recaps/recaps";

type ArchiveProps = { scope: CardScope; recaps: readonly SessionRecap[] };

// ARCHIVE: everything the seat holds. Open quests, then each kind as a tree (closed quests with their outcome under
// Quest), then the recaps; a chip per kind narrows it, and a search over the seat's own entries lists hits by kind, each
// opening the peek.
export function Archive({ scope, recaps }: ArchiveProps) {
  const t = useTranslations("notebook");
  const tKind = useTranslations("codex.kind");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<KindFilter>("all");
  const { entries } = scope;
  const kinds = byKind(entries);
  // A kind whose last entry was hidden again falls back to all.
  const kind: KindFilter = kinds.some((g) => g.kind === picked) ? picked : "all";
  const shown = filterEntries({ entries, kind, query });
  const searching = query.trim() !== "";
  const openQuests = shown.filter((e) => e.kind === "quest" && e.status === "open");
  const rest = shown.filter((e) => !openQuests.includes(e));

  // Search box: narrows the list as the player types.
  const handleQuery = (e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value);

  if (entries.length === 0 && recaps.length === 0) return <p className="dim">{t("nothing")}</p>;
  return (
    <div className="stack">
      {entries.length > 0 && (
        <>
          <input
            type="search"
            aria-label={t("search")}
            placeholder={t("search")}
            value={query}
            onChange={handleQuery}
            style={{ minWidth: 0 }}
          />
          <div className="row" role="group" aria-label={t("filter")}>
            <button className="btn sm" aria-pressed={kind === "all"} onClick={() => setPicked("all")}>
              {t("all")}
            </button>
            {kinds.map((g) => (
              <button key={g.kind} className="btn sm" aria-pressed={kind === g.kind} onClick={() => setPicked(g.kind)}>
                {t("kindCount", { kind: tKind(g.kind), count: g.entries.length })}
              </button>
            ))}
          </div>
        </>
      )}
      {searching ? (
        <>
          {shown.length === 0 && <p className="dim">{t("noMatch")}</p>}
          {byKind(shown).map((g) => (
            <section key={g.kind} className="stack" style={{ gap: 4 }}>
              <h3 className="w-label">{t("hits", { kind: tKind(g.kind), count: g.entries.length })}</h3>
              <ul className="list notebook-list">
                {g.entries.map((e) => (
                  <li key={e.id}>
                    <EntryButton entry={e} scope={scope} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      ) : (
        <>
          {openQuests.length > 0 && (
            <section className="stack">
              <h2 className="head">{t("openQuests")}</h2>
              {treeRows(openQuests).map((row) => (
                <EntryCard key={row.entry.id} row={row} scope={scope} />
              ))}
            </section>
          )}
          {CodexKind.options.map((k) => {
            // Handouts newest revealed first, as a phone's inbox has them (house decision #86).
            const ofKind = rest.filter((e) => e.kind === k);
            const inOrder = k === "handout" ? newestRevealed(ofKind) : ofKind;
            return (
              ofKind.length > 0 && (
                <section key={k} className="stack">
                  <h2 className="head">{tKind(k)}</h2>
                  {treeRows(inOrder).map((row) => (
                    <EntryCard key={row.entry.id} row={row} scope={scope} />
                  ))}
                </section>
              )
            );
          })}
          {kind === "all" && <Recaps recaps={recaps} entries={entries} onPeek={scope.onPeek} />}
        </>
      )}
    </div>
  );
}
