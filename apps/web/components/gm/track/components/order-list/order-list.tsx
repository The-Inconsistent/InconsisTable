"use client";
import { useTranslations } from "next-intl";
import type { FocusEvent, KeyboardEvent } from "react";

import type { Actor, Combatant, Encounter } from "@inconsistable/core-schema";

import type { Run } from "@/components/gm/track/constants";
import { HealthBar } from "@/components/ui/health-bar/health-bar";
import { stateKey } from "@/lib/track/track";

type OrderListProps = {
  encounter: Encounter;
  actors: ReadonlyMap<string, Actor>;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  run: Run;
};

// The turn order. Each row is a big target that selects the combatant for the panel beside it; the number beside it is
// what the GM types from the dice (blank clears it), and the arrows settle a tie one place at a time.
export function OrderList({ encounter, actors, selectedId, onSelect, run }: OrderListProps) {
  const t = useTranslations("orderList");
  const tState = useTranslations("combatState");
  const tSide = useTranslations("combatSide");
  const tVisibility = useTranslations("combatVisibility");
  // INITIATIVE: sends the typed number when the field is left; a blank field clears the score.
  const handleScore = (c: Combatant) => async (e: FocusEvent<HTMLInputElement>) => {
    const typed = e.target.value.trim();
    const score = typed === "" ? null : Number(typed);
    if (score === c.initiative || (score !== null && !Number.isInteger(score))) return;
    await run({ type: "encounter.setInitiative", combatantId: c.id, score });
  };

  // ENTER commits the number without waiting for the field to lose focus.
  const handleEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  // A seated order has no scores: the seats go round the table from the first player.
  const seated = encounter.firstPlayer !== null;
  return (
    <ol className="order seat-strip" aria-label={t("label")}>
      {encounter.combatants.map((c) => {
        const acting = c.id === encounter.currentId;
        const first = c.id === encounter.firstId;
        const word = stateKey({ current: acting, healthState: actors.get(c.actorId)?.fields.healthState });
        return (
          <li key={c.id} className="combatant" data-acting={acting} data-selected={c.id === selectedId}>
            <button className="who" aria-pressed={c.id === selectedId} onClick={() => onSelect(c.id)}>
              <span className="name">{c.name}</span>
              <span className="row small dim">
                {first && (
                  <span className="chip" data-first="true">
                    {t("first")}
                  </span>
                )}
                <span className="chip">
                  {c.side === "party" || c.side === "foe" || c.side === "other" ? tSide(c.side) : c.side}
                </span>
                <span className="chip">{tVisibility(c.visibility)}</span>
                {word && (
                  <span className="state-word" data-state={word}>
                    {tState(word)}
                  </span>
                )}
              </span>
              <HealthBar combatant={c} conditions={encounter.conditionDefs} />
            </button>
            <span className="row" style={{ flexWrap: "nowrap" }}>
              {!seated && (
                <input
                  key={`${c.id}-${c.initiative ?? ""}`}
                  className="score"
                  type="number"
                  inputMode="numeric"
                  aria-label={t("initiative", { name: c.name })}
                  defaultValue={c.initiative ?? ""}
                  onBlur={handleScore(c)}
                  onKeyDown={handleEnter}
                />
              )}
              {encounter.firstPlayer === "manual" && !first && (
                <button
                  className="btn"
                  aria-label={t("makeFirst", { name: c.name })}
                  onClick={() => run({ type: "turn.first", combatantId: c.id })}
                >
                  {t("first")}
                </button>
              )}
              <button
                className="btn"
                aria-label={t(seated ? "moveUpSeat" : "moveUp", { name: c.name })}
                onClick={() => run({ type: "encounter.move", combatantId: c.id, direction: "up" })}
              >
                ↑
              </button>
              <button
                className="btn"
                aria-label={t(seated ? "moveDownSeat" : "moveDown", { name: c.name })}
                onClick={() => run({ type: "encounter.move", combatantId: c.id, direction: "down" })}
              >
                ↓
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
