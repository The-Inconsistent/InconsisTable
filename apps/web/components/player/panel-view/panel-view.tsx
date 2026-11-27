"use client";
import type { Actor, BookSource, LiveState, SpendRequest } from "@inconsistable/core-schema";
import type { CompiledRuleset, Ruleset } from "@inconsistable/rules-engine";

import { SpendList } from "@/components/sheet/components/spend-ask/components/spend-list/spend-list";
import { Cite } from "@/components/ui/cite/cite";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import type { PanelNow } from "@/lib/panels/panels";
import { resourceLabels } from "@/lib/spend-request/spend-request";

import { PanelOptions } from "./components/panel-options/panel-options";

type PanelViewProps = {
  now: PanelNow;
  ruleset: Ruleset;
  compiled: CompiledRuleset | null;
  actor: Actor;
  table: Pick<LiveState, "pools" | "encounter" | "campaign">;
  characters: number;
  requests: readonly SpendRequest[];
  send: Send;
  books: readonly BookSource[];
  requestPage: RequestPage;
  /** Inside a sheet: no heading of its own (the sheet carries it), and an ask that goes through closes it. */
  sheet?: { onSent: () => void };
};

// One panel as it holds now (house decision #114): the ruleset's own short lines with their cites, the numbers it reads
// from the character, the asks it offers and the entries it lists. A reminder: it changes no number.
export function PanelView(props: PanelViewProps) {
  const { now, ruleset, compiled, actor, table, characters, requests, send, books, requestPage, sheet } = props;
  const { panel, lines, figures } = now;
  const cite = (c: string | null) => c && <Cite cite={c} {...{ ruleset, books, requestPage }} />;
  const body = (
    <>
      {lines.length > 0 && (
        <ul className="panel-lines">
          {lines.map((l, i) => (
            <li key={i}>
              {l.text} {cite(l.cite)}
            </li>
          ))}
        </ul>
      )}
      {figures.length > 0 && (
        <dl className="value-cells panel-figures">
          {figures.map((f, i) => (
            <div key={i} className="value-cell">
              <dt>{f.label}</dt>
              <dd>
                {f.value} {cite(f.cite)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {panel.spends !== undefined && (
        <SpendList
          labels={resourceLabels(ruleset)}
          panel={{ spends: panel.spends, onSent: sheet?.onSent }}
          {...{ ruleset, compiled, actor, table, characters, requests, send }}
        />
      )}
      {panel.options !== undefined && (
        <PanelOptions
          options={panel.options}
          campaignId={table.campaign.id}
          {...{ ruleset, actor, table, characters, books, requestPage }}
        />
      )}
    </>
  );
  if (sheet !== undefined) return <div className="stack panel-card">{body}</div>;
  return (
    <section className="stack sheet-card panel-card" data-panel={panel.id} aria-label={panel.label}>
      <h2 className="head row between">
        <span>{panel.label}</span>
        {cite(panel.cite ?? null)}
      </h2>
      {body}
    </section>
  );
}
