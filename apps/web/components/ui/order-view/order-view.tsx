import { useTranslations } from "next-intl";

import type { Encounter } from "@inconsistable/core-schema";
import type { SidesInitiative } from "@inconsistable/rules-engine";

import { SideLine } from "@/components/ui/order-view/components/side-line/side-line";
import { TurnMark } from "@/components/ui/order-view/components/turn-mark/turn-mark";
import { EndNotice } from "@/components/ui/end-notice/end-notice";
import { HealthBar } from "@/components/ui/health-bar/health-bar";
import { groupBySide, markOf } from "@/lib/sides/sides";
import { phaseOf, stateKey } from "@/lib/track/track";

/**
 * `sides`: the seat's manifest `initiative` for a sides fight; without it the side ids word themselves.
 * `conditions`: the seat's manifest conditions, for the labels of the ones a combatant carries.
 */
type OrderViewProps = {
  encounter: Encounter;
  sides?: SidesInitiative;
  conditions?: readonly { id: string; label: string }[];
};

// The turn order as a seat that doesn't run the fight sees it (the table screen, a phone): who acts, in order, with the
// health the seat was sent. The acting row is marked by an edge and by the word ACTING, not by colour alone.
// A sides fight (its snapshot carries `begun`) is grouped by side, each row marked with its turn.
export function OrderView({ encounter, sides, conditions = [] }: OrderViewProps) {
  const t = useTranslations("orderView");
  const tState = useTranslations("combatState");
  const phase = phaseOf(encounter);
  const sided = encounter.begun !== undefined;
  return (
    <section className="stack order-view" aria-label={t("label")}>
      <h2 className="title">
        {/* A sides fight that has not begun is still being set up: there is no round yet. */}
        {encounter.begun === false
          ? t("lineSetup")
          : phase
            ? t("roundPhase", { round: encounter.round, phase: phase.label })
            : t("round", { round: encounter.round })}{" "}
        {encounter.paused && <span className="chip">{t("paused")}</span>}
      </h2>
      <EndNotice encounter={encounter} />
      {sided && <SideLine encounter={encounter} sides={sides} />}
      {/* A ranked or seated order has no side line: say here that a hidden combatant holds the turn (#68). */}
      {!sided && encounter.unseen && (
        <p className="side-line" role="status">
          {t("lineUnseen")}
        </p>
      )}
      {sided ? (
        groupBySide({ combatants: encounter.combatants, sides }).map((g) => (
          <section key={g.id} className="stack" aria-label={g.label}>
            <h3 className="head">{g.label}</h3>
            <ol className="order seat-strip">
              {g.combatants.map((c) => (
                <li key={c.id} className="combatant" data-acting={c.id === encounter.currentId}>
                  <span className="who" style={{ cursor: "default" }}>
                    <span className="name">{c.name}</span>
                    <HealthBar combatant={c} conditions={conditions} />
                  </span>
                  <TurnMark mark={markOf({ encounter, combatant: c, sides })} />
                </li>
              ))}
            </ol>
          </section>
        ))
      ) : (
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
                  <HealthBar combatant={c} conditions={conditions} />
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
      )}
    </section>
  );
}
