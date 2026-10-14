import type { Encounter } from "@inconsistable/core-schema";

import { HealthBar } from "@/components/ui/health-bar/health-bar";
import { stateWord } from "@/lib/track/track";

type OrderViewProps = { encounter: Encounter };

// The turn order as a seat that doesn't run the fight sees it (the table screen, a phone): who acts, in order, with the
// health the seat was sent. The acting row is marked by an edge and by the word ACTING, not by colour alone.
export function OrderView({ encounter }: OrderViewProps) {
  return (
    <section className="stack order-view" aria-label="Turn order">
      <h2 className="title">
        Round {encounter.round} {encounter.paused && <span className="chip">Paused</span>}
      </h2>
      <ol className="order seat-strip">
        {encounter.combatants.map((c) => {
          const acting = c.id === encounter.currentId;
          const word = stateWord({ current: acting, healthState: undefined });
          return (
            <li key={c.id} className="combatant" data-acting={acting}>
              <span className="who" style={{ cursor: "default" }}>
                <span className="name">{c.name}</span>
                <HealthBar combatant={c} />
              </span>
              {word && (
                <span className="state-word" data-state={word.toLowerCase()}>
                  {word}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
