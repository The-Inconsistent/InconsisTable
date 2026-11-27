import { useTranslations } from "next-intl";

import type { Combatant, Encounter } from "@inconsistable/core-schema";
import type { SidesInitiative } from "@inconsistable/rules-engine";

import { SideLine } from "@/components/ui/order-view/components/side-line/side-line";
import { TurnMark } from "@/components/ui/order-view/components/turn-mark/turn-mark";
import { EndNotice } from "@/components/ui/end-notice/end-notice";
import { HealthBar } from "@/components/ui/health-bar/health-bar";
import type { HeldOf } from "@/lib/held/held";
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
  /** What each combatant holds up (house decision #91), as chips beside its conditions. */
  heldOf?: HeldOf;
  /** The seat's own combatants (a phone's Fight tab), each marked YOU (house decision #114). */
  mine?: ReadonlySet<string>;
  /** Opens what the seat is sent of a combatant that is not its own (the foe card); absent, the rows are not buttons. */
  onPick?: (c: Combatant) => void;
};

// The turn order as a seat that doesn't run the fight sees it (the table screen, a phone): who acts, in order, with the
// health the seat was sent. The acting row is marked by an edge and by the word ACTING, not by colour alone.
// A sides fight (its snapshot carries `begun`) is grouped by side, each row marked with its turn.
export function OrderView({ encounter, sides, conditions = [], heldOf, mine, onPick }: OrderViewProps) {
  const t = useTranslations("orderView");
  const tState = useTranslations("combatState");
  const phase = phaseOf(encounter);
  const sided = encounter.begun !== undefined;
  // A row's name, health and marks; a button that opens the foe card where the seat may pick it.
  const who = (c: Combatant, first = false) => {
    const own = mine?.has(c.id) === true;
    const body = (
      <>
        <span className="row">
          <span className="name">{c.name}</span>
          {own && (
            <span className="chip" data-you="true">
              {t("you")}
            </span>
          )}
          {first && (
            <span className="chip" data-first="true">
              {t("first")}
            </span>
          )}
        </span>
        <HealthBar combatant={c} conditions={conditions} held={heldOf?.(c.actorId)} />
      </>
    );
    return onPick && !own ? (
      <button type="button" className="who" aria-label={t("openCard", { name: c.name })} onClick={() => onPick(c)}>
        {body}
      </button>
    ) : (
      <span className="who" style={{ cursor: "default" }}>
        {body}
      </span>
    );
  };
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
                  {who(c)}
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
                {who(c, first)}
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
