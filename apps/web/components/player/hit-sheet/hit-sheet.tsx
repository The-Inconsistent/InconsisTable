"use client";
import { useState } from "react";

import type { Actor, BookSource, LiveState, SpendRequest } from "@inconsistable/core-schema";
import type { CompiledRuleset, Ruleset } from "@inconsistable/rules-engine";

import { PanelView } from "@/components/player/panel-view/panel-view";
import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import { layoutRows, panelNow, panelOfRow } from "@/lib/panels/panels";

type HitSheetProps = {
  ruleset: Ruleset;
  compiled: CompiledRuleset | null;
  actor: Actor;
  table: Pick<LiveState, "pools" | "encounter" | "campaign">;
  characters: number;
  requests: readonly SpendRequest[];
  send: Send;
  books: readonly BookSource[];
  requestPage: RequestPage;
};

// YOU'RE HIT (house decision #114): a panel of the phone's turn rows that opens on a rise (`opensOn`) comes up as a sheet
// over whatever tab is open when the character's resource rises in a fight, and goes on an ask sent, on a lower value
// or when the fight ends. The ask reaches the GM's request bar as any other.
export function HitSheet(props: HitSheetProps) {
  const { ruleset, actor, table } = props;
  const panels = (layoutRows({ ruleset, entity: actor.entity, target: "phoneTurn" }) ?? []).flatMap((row) => {
    const p = panelOfRow(ruleset, row);
    return p?.opensOn ? [{ panel: p, resource: p.opensOn.rises }] : [];
  });
  const values = Object.fromEntries(panels.map((x) => [`${actor.id}:${x.panel.id}`, actor.resources[x.resource] ?? 0]));
  const [seen, setSeen] = useState(values);
  const [open, setOpen] = useState<string | null>(null);
  const fighting = table.encounter !== null;

  // What the last render saw (React's way to answer a changed prop without an effect): a rise in a fight opens its
  // panel, a fall closes it, and a fight's end closes whatever is open.
  const changed = Object.keys(values).some((k) => values[k] !== seen[k]);
  if (changed) {
    setSeen(values);
    const rose = panels.find((x) => {
      const key = `${actor.id}:${x.panel.id}`;
      return seen[key] !== undefined && (values[key] ?? 0) > (seen[key] ?? 0);
    });
    const fell = open !== null && (values[open] ?? 0) < (seen[open] ?? 0);
    if (fighting && rose) setOpen(`${actor.id}:${rose.panel.id}`);
    else if (fell) setOpen(null);
  }
  if (!fighting && open !== null) setOpen(null);

  const shown = panels.find((x) => `${actor.id}:${x.panel.id}` === open);
  const now = shown && panelNow({ ...props, panel: shown.panel });
  if (!shown || !now) return null;
  return (
    <BottomSheet title={shown.panel.label} onClose={() => setOpen(null)}>
      <PanelView now={now} sheet={{ onSent: () => setOpen(null) }} {...props} />
    </BottomSheet>
  );
}
