import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import type { Combatant, Encounter } from "@inconsistable/core-schema";
import type { SidesInitiative } from "@inconsistable/rules-engine";

import { SideLine } from "@/components/ui/order-view/components/side-line/side-line";
import { TurnMark } from "@/components/ui/order-view/components/turn-mark/turn-mark";
import { EndNotice } from "@/components/ui/end-notice/end-notice";
import { HealthBar } from "@/components/ui/health-bar/health-bar";
import type { TermEnv } from "@/components/ui/term-card/term-card";
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
  conditions?: readonly { id: string; label: string; summary?: string; cite?: string }[];
  /** What each combatant holds up (house decision #91), as chips beside its conditions. */
  heldOf?: HeldOf;
  /** A phone's own characters (actor ids), each row marked YOU (house decision #117). */
  you?: readonly string[];
  /** A phone's foe rows open a card under them (house decision #117): which is open, the toggle, and the card. */
  foes?: { open: string | null; onToggle: (combatantId: string) => void; card: (c: Combatant) => ReactNode };
  /** A phone's conditions open what they mean on a tap (house decision #126); the TV takes no input and has none. */
  terms?: TermEnv;
};

// The turn order as a seat that doesn't run the fight sees it (the table screen, a phone): who acts, in order, with the
// health the seat was sent. The acting row is marked by an edge and by the word ACTING, not by colour alone.
// A sides fight (its snapshot carries `begun`) is grouped by side, each row marked with its turn.
export function OrderView({ encounter, sides, conditions = [], heldOf, you = [], foes, terms }: OrderViewProps) {
  const t = useTranslations("orderView");
  const tState = useTranslations("combatState");
  const phase = phaseOf(encounter);
  const sided = encounter.begun !== undefined;
  const mySides = new Set(encounter.combatants.filter((c) => you.includes(c.actorId)).map((c) => c.side));
  // A phone's foe: a row of another side than its characters', or any row it does not hold when none of them fights.
  const isFoe = (c: Combatant) =>
    foes !== undefined && !you.includes(c.actorId) && (mySides.size === 0 || !mySides.has(c.side));
  // A phone's row says its side for a World's stripe (house decision #207); the TV's rows have no seat to side with.
  const sideOf = (c: Combatant) => (foes === undefined ? undefined : isFoe(c) ? "foe" : "ally");

  // The row's name: a foe's opens its card, anyone else's is a plain label. A foe's health stays outside its button, so
  // a condition in it can open its own meaning.
  const who = (c: Combatant, rest: ReactNode) =>
    isFoe(c) ? (
      <span className="who" style={{ cursor: "default" }}>
        <button className="who-toggle" aria-expanded={foes?.open === c.id} onClick={() => foes?.onToggle(c.id)}>
          <span className="name">{c.name}</span>
        </button>
        {rest}
      </span>
    ) : (
      <span className="who" style={{ cursor: "default" }}>
        <span className="name">{c.name}</span>
        {you.includes(c.actorId) && (
          <span className="chip" data-you="true">
            {t("you")}
          </span>
        )}
        {rest}
      </span>
    );
  const card = (c: Combatant) =>
    isFoe(c) && foes?.open === c.id ? (
      <li key={`${c.id}-card`} className="foe-card">
        {foes.card(c)}
      </li>
    ) : null;

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
      {/* A ranked or seated order has no side line: say here that a hidden combatant holds the turn (#68). The phone's
          Fight tab (with `foes`) says it on its plate already. */}
      {!sided && encounter.unseen && foes === undefined && (
        <p className="side-line" role="status">
          {t("lineUnseen")}
        </p>
      )}
      {sided ? (
        groupBySide({ combatants: encounter.combatants, sides }).map((g) => (
          <section key={g.id} className="stack" aria-label={g.label}>
            <h3 className="head">{g.label}</h3>
            <ol className="order seat-strip">
              {g.combatants.flatMap((c) => [
                <li
                  key={c.id}
                  className="combatant"
                  data-acting={c.id === encounter.currentId}
                  data-you={you.includes(c.actorId) || undefined}
                  data-side={sideOf(c)}
                >
                  {who(c, <HealthBar combatant={c} conditions={conditions} held={heldOf?.(c.actorId)} terms={terms} />)}
                  <TurnMark mark={markOf({ encounter, combatant: c, sides })} />
                </li>,
                card(c),
              ])}
            </ol>
          </section>
        ))
      ) : (
        <ol className="order seat-strip">
          {encounter.combatants.flatMap((c) => {
            const acting = c.id === encounter.currentId;
            const first = c.id === encounter.firstId;
            const done = phase?.mode === "simultaneous" && encounter.done.includes(c.id);
            const word = stateKey({ current: acting, healthState: undefined });
            return [
              <li
                key={c.id}
                className="combatant"
                data-acting={acting}
                data-you={you.includes(c.actorId) || undefined}
                data-side={sideOf(c)}
              >
                {who(
                  c,
                  <>
                    {first && (
                      <span className="chip" data-first="true">
                        {t("first")}
                      </span>
                    )}
                    <HealthBar combatant={c} conditions={conditions} held={heldOf?.(c.actorId)} terms={terms} />
                  </>,
                )}
                {done && <span className="chip">{t("done")}</span>}
                {word && (
                  <span className="state-word" data-state={word}>
                    {tState(word)}
                  </span>
                )}
              </li>,
              card(c),
            ];
          })}
        </ol>
      )}
    </section>
  );
}
