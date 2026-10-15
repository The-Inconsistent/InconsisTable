"use client";
import type { FocusEvent, KeyboardEvent } from "react";

import type { Actor, Combatant, Encounter } from "@inconsistable/core-schema";

import { SIDE_LABELS, VISIBILITY_LABELS, type Run } from "@/components/gm/track/constants";
import { HealthBar } from "@/components/ui/health-bar/health-bar";
import { stateWord } from "@/lib/track/track";

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

  return (
    <ol className="order seat-strip" aria-label="Turn order">
      {encounter.combatants.map((c) => {
        const acting = c.id === encounter.currentId;
        const word = stateWord({ current: acting, healthState: actors.get(c.actorId)?.fields.healthState });
        return (
          <li key={c.id} className="combatant" data-acting={acting} data-selected={c.id === selectedId}>
            <button className="who" aria-pressed={c.id === selectedId} onClick={() => onSelect(c.id)}>
              <span className="name">{c.name}</span>
              <span className="row small dim">
                <span className="chip">{SIDE_LABELS[c.side]}</span>
                <span className="chip">{VISIBILITY_LABELS[c.visibility]}</span>
                {word && (
                  <span className="state-word" data-state={word.toLowerCase()}>
                    {word}
                  </span>
                )}
              </span>
              <HealthBar combatant={c} />
            </button>
            <span className="row" style={{ flexWrap: "nowrap" }}>
              <input
                key={`${c.id}-${c.initiative ?? ""}`}
                className="score"
                type="number"
                inputMode="numeric"
                aria-label={`Initiative of ${c.name}`}
                defaultValue={c.initiative ?? ""}
                onBlur={handleScore(c)}
                onKeyDown={handleEnter}
              />
              <button
                className="btn"
                aria-label={`Move ${c.name} up among equal initiatives`}
                onClick={() => run({ type: "encounter.move", combatantId: c.id, direction: "up" })}
              >
                ↑
              </button>
              <button
                className="btn"
                aria-label={`Move ${c.name} down among equal initiatives`}
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
