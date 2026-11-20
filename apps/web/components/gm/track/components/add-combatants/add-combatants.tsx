"use client";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import type { Actor, CombatVisibility, Encounter } from "@inconsistable/core-schema";

import { JOIN_AS, type Run, type TrackMode } from "@/components/gm/track/constants";

type AddCombatantsProps = {
  encounter: Encounter;
  actors: readonly Actor[];
  run: Run;
  mode: TrackMode;
  /** The ruleset's turn order is `sides`: the server picks each actor's side. */
  sided?: boolean;
};

const joinAs = (a: Actor) =>
  a.kind === "pc" ? JOIN_AS.party : a.kind === "creature" ? JOIN_AS.creature : JOIN_AS.other;

// Who is at the table but not in the fight: the party joins in one tap, anyone else one by one. A creature spawned
// while the fight is on joins it by itself, at the view it was spawned with.
export function AddCombatants({ encounter, actors, run, mode, sided = false }: AddCombatantsProps) {
  const t = useTranslations("addCombatants");
  const waiting = useMemo(() => {
    const inFight = new Set(encounter.combatants.map((c) => c.actorId));
    return actors.filter((a) => !inFight.has(a.id) && a.status === "active");
  }, [encounter.combatants, actors]);
  const party = waiting.filter((a) => a.kind === "pc");
  // A sides order places each actor by its entity type: no side is sent, and the server refuses one that is on no side.
  const joinFor = (j: { side: string; visibility: CombatVisibility }) => (sided ? { visibility: j.visibility } : j);

  // ADD PARTY: every character of the party not yet in the fight.
  const handleParty = () => run({ type: "encounter.add", actorIds: party.map((a) => a.id), ...joinFor(JOIN_AS.party) });

  // ADD ONE: this actor, on the side its kind usually fights on.
  const handleOne = (a: Actor) => () => run({ type: "encounter.add", actorIds: [a.id], ...joinFor(joinAs(a)) });

  if (waiting.length === 0) return <p className="dim">{t("everyone", { mode })}</p>;
  return (
    <section className="stack">
      <h2 className="head">{t("title", { mode })}</h2>
      {party.length > 1 && (
        <button className="btn primary" onClick={handleParty} style={{ justifySelf: "start" }}>
          {t("addParty", { count: party.length })}
        </button>
      )}
      <ul className="list">
        {waiting.map((a) => (
          <li key={a.id}>
            <span>
              {a.name} <span className="dim">{a.kind}</span>
            </span>
            <button className="btn sm" aria-label={t("addLabel", { name: a.name, mode })} onClick={handleOne(a)}>
              {t("add")}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
