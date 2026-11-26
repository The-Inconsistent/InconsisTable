"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ActionInput, Actor, BookSource, Combatant, LiveState } from "@inconsistable/core-schema";
import type { CompiledRuleset, Ruleset } from "@inconsistable/rules-engine";

import { PanelView } from "@/components/player/panel-view/panel-view";
import { SpendList } from "@/components/sheet/components/spend-ask/components/spend-list/spend-list";
import { SheetView } from "@/components/sheet/sheet-view/sheet-view";
import { OrderView } from "@/components/ui/order-view/order-view";
import { StrikeGuide } from "@/components/ui/strike-guide/strike-guide";
import { ValueCells } from "@/components/ui/value-cells/value-cells";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import { heldChips } from "@/lib/held/held";
import { layoutRows, panelNow, panelOfRow } from "@/lib/panels/panels";
import { stripCellsOf } from "@/lib/phone-strip/phone-strip";
import { resourceLabels } from "@/lib/spend-request/spend-request";

import { FightPlate } from "./components/fight-plate/fight-plate";

type FightTabProps = {
  state: LiveState;
  ruleset: Ruleset | null;
  compiled: CompiledRuleset | null;
  /** The character the phone shows now; undefined when the seat holds none. */
  character: Actor | undefined;
  held: readonly string[];
  characters: number;
  send: Send;
  books: readonly BookSource[];
  requestPage: RequestPage;
  maxOf: (resource: string) => number | null;
};

// FIGHT (house decision #117): who acts and who is up next, the seat's turn with the rows its ruleset lays out for it
// (house decision #114: a panel while it holds, the strike guide and the asks on the character's own turn), then the
// order with YOU and a foe's card. Nothing here decides a rule: the server does, and the dice stay on the table.
export function FightTab(props: FightTabProps) {
  const { state, ruleset, compiled, character, held, characters, send, books, requestPage, maxOf } = props;
  const t = useTranslations("fightTab");
  const [foe, setFoe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const e = state.encounter;
  if (e === null) return <p className="dim">{t("noFight")}</p>;
  const sides = ruleset?.initiative?.strategy === "sides" ? ruleset.initiative : undefined;
  const mine = character && e.combatants.some((c) => c.actorId === character.id) ? character : undefined;
  const myTurn = mine !== undefined && !e.paused && e.combatants.find((c) => c.id === e.currentId)?.actorId === mine.id;
  const fighting = e.combatants.flatMap((c) => state.actors.find((a) => a.id === c.actorId) ?? []);
  const env = { ruleset, compiled, table: state, characters, requests: state.requests, send, books, requestPage };

  // SEND on the strike guide (house decision #113): the strike for this character, refused or not by the server.
  const handleStrike = async (a: ActionInput) => {
    const r = await send(a);
    setError(r.ok ? null : r.error);
    return r.ok;
  };
  // A foe's row: opens its card, or closes the one open.
  const handleFoe = (combatantId: string) => setFoe(foe === combatantId ? null : combatantId);

  // The guide for one strike kind (or every kind the character has, without a layout to name one).
  const guide = (only?: string) =>
    mine &&
    ruleset &&
    compiled && (
      <section key={`strike-${only ?? ""}`} className="stack sheet-card">
        <StrikeGuide
          attacker={mine}
          campaignId={state.campaign.id}
          campaign={state.campaign.fields}
          phone={{ encounter: e, tableMode: state.campaign.tableMode }}
          run={handleStrike}
          {...{ ruleset, compiled, fighting, characters, books, requestPage, only }}
        />
      </section>
    );

  // The character's turn rows: a panel while it holds (a sheet that opens on a rise is drawn over every tab instead),
  // and on its own turn the strike guide, the asks and any value rows.
  const rows = mine && ruleset ? layoutRows({ ruleset, entity: mine.entity, target: "phoneTurn" }) : null;
  const turn =
    mine && ruleset
      ? rows === null
        ? myTurn && guide()
        : rows.map((row, i) => {
            const panel = panelOfRow(ruleset, row);
            if (panel !== undefined) {
              const now = panel.opensOn ? null : panelNow({ ruleset, panel, actor: mine, table: state, characters });
              return now && <PanelView key={i} now={now} actor={mine} {...env} ruleset={ruleset} />;
            }
            if (!myTurn) return null;
            if (typeof row !== "string" && row.widget === "strike") return guide(row.variant);
            if (typeof row !== "string" && row.widget === "spends")
              return <SpendList key={i} labels={resourceLabels(ruleset)} actor={mine} {...env} ruleset={ruleset} />;
            const cells = stripCellsOf({ ruleset, actor: mine, rows: [row] });
            return cells.length > 0 && <ValueCells key={i} actor={mine} cells={cells} maxOf={maxOf} />;
          })
      : null;

  // A foe's card: its numbers when the GM shows it in full (house decision #117), else the line that says there are none.
  const card = (c: Combatant) => {
    const actor = c.visibility === "full" ? state.actors.find((a) => a.id === c.actorId) : undefined;
    return actor && ruleset ? (
      <SheetView
        actor={actor}
        ruleset={ruleset}
        characters={characters}
        campaign={state.campaign.fields}
        gm={false}
        {...{ send, books, requestPage }}
      />
    ) : (
      <p className="small dim">{t("foeHidden")}</p>
    );
  };

  return (
    <div className="stack fight-tab">
      <FightPlate encounter={e} sides={sides} held={held} />
      {turn}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <OrderView
        encounter={e}
        sides={sides}
        conditions={ruleset?.conditions}
        heldOf={(id) => heldChips({ ruleset, actor: state.actors.find((a) => a.id === id) })}
        you={held}
        foes={{ open: foe, onToggle: handleFoe, card }}
      />
    </div>
  );
}
