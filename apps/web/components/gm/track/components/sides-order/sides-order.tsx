"use client";
import { useTranslations } from "next-intl";

import type { Actor, Encounter } from "@inconsistable/core-schema";
import type { SidesInitiative } from "@inconsistable/rules-engine";

import { SideLine } from "@/components/ui/order-view/components/side-line/side-line";
import { TurnMark } from "@/components/ui/order-view/components/turn-mark/turn-mark";
import { HealthBar } from "@/components/ui/health-bar/health-bar";
import { groupBySide, markOf } from "@/lib/sides/sides";
import { stateKey } from "@/lib/track/track";

type SidesOrderProps = {
  encounter: Encounter;
  sides: SidesInitiative;
  actors: ReadonlyMap<string, Actor>;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
};

// The order of a sides fight: where it stands, then one group per side in the ruleset's order. Each row is a big target
// that selects the combatant for the panel beside it and carries its turn mark.
export function SidesOrder({ encounter, sides, actors, selectedId, onSelect }: SidesOrderProps) {
  const tState = useTranslations("combatState");
  const tVisibility = useTranslations("combatVisibility");
  return (
    <>
      <SideLine encounter={encounter} sides={sides} />
      {groupBySide({ combatants: encounter.combatants, sides }).map((g) => (
        <section key={g.id} className="stack" aria-label={g.label}>
          <h3 className="head">{g.label}</h3>
          <ol className="order seat-strip">
            {g.combatants.map((c) => {
              const word = stateKey({ current: false, healthState: actors.get(c.actorId)?.fields.healthState });
              return (
                <li
                  key={c.id}
                  className="combatant"
                  data-acting={c.id === encounter.currentId}
                  data-selected={c.id === selectedId}
                >
                  <button className="who" aria-pressed={c.id === selectedId} onClick={() => onSelect(c.id)}>
                    <span className="name">{c.name}</span>
                    <span className="row small dim">
                      <TurnMark mark={markOf({ encounter, combatant: c, sides })} />
                      <span className="chip">{tVisibility(c.visibility)}</span>
                      {word && (
                        <span className="state-word" data-state={word}>
                          {tState(word)}
                        </span>
                      )}
                    </span>
                    <HealthBar combatant={c} conditions={encounter.conditionDefs} />
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </>
  );
}
