import { useTranslations } from "next-intl";

import type { Encounter } from "@inconsistable/core-schema";

import { HealthBar } from "@/components/ui/health-bar/health-bar";
import { stateKey } from "@/lib/track/track";

type OrderViewProps = { encounter: Encounter };

// The turn order as a seat that doesn't run the fight sees it (the table screen, a phone): who acts, in order, with the
// health the seat was sent. The acting row is marked by an edge and by the word ACTING, not by colour alone.
export function OrderView({ encounter }: OrderViewProps) {
  const t = useTranslations("orderView");
  const tState = useTranslations("combatState");
  return (
    <section className="stack order-view" aria-label={t("label")}>
      <h2 className="title">
        {t("round", { round: encounter.round })} {encounter.paused && <span className="chip">{t("paused")}</span>}
      </h2>
      <ol className="order seat-strip">
        {encounter.combatants.map((c) => {
          const acting = c.id === encounter.currentId;
          const word = stateKey({ current: acting, healthState: undefined });
          return (
            <li key={c.id} className="combatant" data-acting={acting}>
              <span className="who" style={{ cursor: "default" }}>
                <span className="name">{c.name}</span>
                <HealthBar combatant={c} />
              </span>
              {word && (
                <span className="state-word" data-state={word}>
                  {tState(word)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
