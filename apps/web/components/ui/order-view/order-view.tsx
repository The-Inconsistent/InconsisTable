import { useTranslations } from "next-intl";

import type { Encounter } from "@inconsistable/core-schema";

import { HealthBar } from "@/components/ui/health-bar/health-bar";
import { phaseOf, stateKey } from "@/lib/track/track";

type OrderViewProps = { encounter: Encounter };

// The turn order as a seat that doesn't run the fight sees it (the table screen, a phone): who acts, in order, with the
// health the seat was sent. The acting row is marked by an edge and by the word ACTING, not by colour alone.
export function OrderView({ encounter }: OrderViewProps) {
  const t = useTranslations("orderView");
  const tState = useTranslations("combatState");
  const phase = phaseOf(encounter);
  return (
    <section className="stack order-view" aria-label={t("label")}>
      <h2 className="title">
        {phase
          ? t("roundPhase", { round: encounter.round, phase: phase.label })
          : t("round", { round: encounter.round })}{" "}
        {encounter.paused && <span className="chip">{t("paused")}</span>}
      </h2>
      <ol className="order seat-strip">
        {encounter.combatants.map((c) => {
          const acting = c.id === encounter.currentId;
          const first = c.id === encounter.firstId;
          const done = phase?.mode === "simultaneous" && encounter.done.includes(c.id);
          const word = stateKey({ current: acting, healthState: undefined });
          return (
            <li key={c.id} className="combatant" data-acting={acting}>
              <span className="who" style={{ cursor: "default" }}>
                <span className="name">{c.name}</span>
                {first && (
                  <span className="chip" data-first="true">
                    {t("first")}
                  </span>
                )}
                <HealthBar combatant={c} />
              </span>
              {done && <span className="chip">{t("done")}</span>}
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
