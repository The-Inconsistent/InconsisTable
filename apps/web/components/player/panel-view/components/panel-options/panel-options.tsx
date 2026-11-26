"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Actor, BookSource, LiveState } from "@inconsistable/core-schema";
import type { PanelOptions as Options, Ruleset } from "@inconsistable/rules-engine";

import { Cite } from "@/components/ui/cite/cite";
import type { RequestPage } from "@/hooks/use-table/use-table";
import { RulesReply, type RulesEntry } from "@/lib/library/library";
import { optionGroups, panelScope } from "@/lib/panels/panels";

import { OPTION_ENTRIES } from "./constants";

type PanelOptionsProps = {
  options: Options;
  campaignId: string;
  ruleset: Ruleset;
  actor: Actor;
  table: Pick<LiveState, "encounter" | "campaign">;
  characters: number;
  books: readonly BookSource[];
  requestPage: RequestPage;
};

// OPTIONS (house decision #114): the attached packs' entries of one type, read when opened, grouped, each with the
// importer's own summary and its cite; one the character cannot use now sinks, with the entry's words for what it needs.
// No printed text: only what the importer wrote (principle 2).
export function PanelOptions({
  options,
  campaignId,
  ruleset,
  actor,
  table,
  characters,
  books,
  requestPage,
}: PanelOptionsProps) {
  const t = useTranslations("panel");
  const [entries, setEntries] = useState<RulesEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SHOW THE OPTIONS: opens the list, reading the entries the first time.
  const handleToggle = async () => {
    setOpen(!open);
    if (open || entries !== null) return;
    try {
      const path = `/api/campaigns/${encodeURIComponent(campaignId)}/rules?type=${encodeURIComponent(options.entry)}&limit=${OPTION_ENTRIES}`;
      const res = await fetch(path);
      const parsed = RulesReply.safeParse(await res.json());
      if (!res.ok || !parsed.success) throw new Error(t("readFailed"));
      setEntries(parsed.data.entries);
      setError(null);
    } catch {
      setError(t("readFailed"));
    }
  };

  const scope = panelScope({ ruleset, actor, table, characters });
  const groups = entries === null ? [] : optionGroups({ ruleset, options, entries, scope });
  return (
    <div className="stack panel-options">
      <button className="btn" aria-expanded={open} onClick={handleToggle} style={{ justifySelf: "start" }}>
        {open ? t("hideOptions") : t("showOptions")}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {open && entries !== null && groups.length === 0 && <p className="dim">{t("noOptions")}</p>}
      {open &&
        groups.map((g) => (
          <section key={g.key} className="stack" aria-label={g.label ?? t("options")}>
            {g.label && <h3 className="w-label">{g.label}</h3>}
            <ul className="option-lines">
              {g.lines.map((l) => (
                <li key={l.key} className="option-line" data-usable={l.usable}>
                  <span className="row between">
                    <strong>{l.name}</strong>
                    {l.cite && <Cite cite={l.cite} {...{ ruleset, books, requestPage }} />}
                  </span>
                  {l.summary && <span className="small">{l.summary}</span>}
                  {!l.usable && (
                    <span className="small option-needs">
                      {l.needs ? t("needs", { needs: l.needs }) : t("cannotUse")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
