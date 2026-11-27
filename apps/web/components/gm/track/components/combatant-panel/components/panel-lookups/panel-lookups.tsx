"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ActionInput, ActionResult, Actor, BookSource, PoolState } from "@inconsistable/core-schema";
import type { CompiledRuleset, RandomTable, Ruleset } from "@inconsistable/rules-engine";

import { TableLookup } from "@/components/gm/track/components/table-lookup/table-lookup";
import type { OpenedTable } from "@/components/gm/track/constants";
import { TableTrail, type TrailStep } from "@/components/ui/table-trail/table-trail";
import type { RequestPage } from "@/hooks/use-table/use-table";

type PanelLookupsProps = {
  /** The lookups that apply to this combatant (`trackTables`, `lookupFor`, house decision #225). */
  lookups: readonly [string, RandomTable][];
  /** The selected combatant's actor: every lookup here is for it. */
  actor: Actor;
  /** A table a spend or the strike guide opened for this actor, here rather than in the drawer; cleared on reselect. */
  opened: OpenedTable | null;
  /** A line names a table the panel does not hold: TRACK opens it where it applies. */
  onOpen: (open: Omit<OpenedTable, "n">) => void;
  campaignId: string;
  compiled: CompiledRuleset;
  ruleset: Ruleset;
  characters: number;
  campaign: Readonly<Record<string, unknown>>;
  pools: readonly Pick<PoolState, "id" | "value">[];
  books: readonly BookSource[];
  requestPage: RequestPage;
  ask: (a: ActionInput) => Promise<ActionResult>;
};

// The lookups on the selected combatant's panel (house decision #225): one toggle per table it can be looked up on, then
// the lookup for this combatant, with no target to pick. A second tap on the toggle folds it away.
export function PanelLookups(props: PanelLookupsProps) {
  const { lookups: mine, actor, opened, onOpen, ...env } = props;
  const t = useTranslations("tables");
  const mineHas = (id: string) => mine.some(([x]) => x === id);
  const [current, setCurrent] = useState<string | null>(opened?.actorId === actor.id ? opened.tableId : null);
  // The chain so far (house decision #88), as in the drawer.
  const [trail, setTrail] = useState<readonly TrailStep[]>([]);
  // A spend's OPEN <table> for this actor turns to that table and starts a new chain.
  const [openedSeen, setOpenedSeen] = useState(opened);
  if (opened !== openedSeen) {
    setOpenedSeen(opened);
    if (opened?.actorId === actor.id) {
      setCurrent(opened.tableId);
      setTrail([]);
    }
  }
  const table = mine.find(([id]) => id === current)?.[1];
  if (mine.length === 0) return null;

  // TOGGLE: a table's button shows its lookup, a second tap folds it; either way a new chain.
  const handleToggle = (id: string) => {
    setCurrent((was) => (was === id ? null : id));
    setTrail([]);
  };

  // NEXT: a line names another table; one the panel holds comes up here with the step on the trail, any other opens in
  // the drawer for this actor.
  const handleNext = (id: string, from: { title: string; label: string }) => {
    if (!mineHas(id)) return onOpen({ tableId: id, actorId: actor.id, inputs: {} });
    setTrail((was) => [...was, from]);
    setCurrent(id);
  };

  return (
    <div className="stack panel-lookups">
      <div className="seg" role="group" aria-label={t("lookupsFor", { name: actor.name })}>
        {mine.map(([id, x]) => (
          <button key={id} className="btn" aria-pressed={current === id} onClick={() => handleToggle(id)}>
            {x.title}
          </button>
        ))}
      </div>
      <TableTrail steps={trail} onClear={() => setTrail([])} />
      {current !== null && table && (
        <TableLookup
          // Opened by a spend, the lookup starts again from the spend's inputs.
          key={`${current}-${opened?.tableId === current ? opened.n : 0}`}
          start={opened?.tableId === current && opened.actorId === actor.id ? opened.inputs : undefined}
          {...env}
          tableId={current}
          table={table}
          target={actor}
          onNext={handleNext}
          onApplied={() => setTrail([])}
        />
      )}
    </div>
  );
}
