"use client";
import { useState, type ChangeEvent } from "react";

import { CombatVisibility, type Actor, type Combatant, type Encounter } from "@inconsistable/core-schema";

import {
  DEATH_SAVE_LABELS,
  KEYPAD_KEYS,
  KEY_LABELS,
  KEY_NAMES,
  VISIBILITY_LABELS,
  type DeathSaveKey,
  type Run,
} from "@/components/gm/track/constants";
import { HealthBar } from "@/components/ui/health-bar/health-bar";
import { amountOf, leftText, pressKey } from "@/lib/track/track";

type CombatantPanelProps = {
  encounter: Encounter;
  combatant: Combatant;
  actor: Actor | undefined;
  run: Run;
  /** Opens this actor's sheet (GM only; absent when there is no ruleset to read it by). */
  onSheet?: (actorId: string) => void;
  /** Opens the Tests call form for this actor (GM only; absent when the ruleset has no Tests). */
  onCallTest?: (actorId: string) => void;
};

// The selected combatant: a keypad for damage, healing and temporary points, death saves, what the table sees, the
// conditions it carries with their time left, and the way out of the fight.
export function CombatantPanel({ encounter, combatant: c, actor, run, onSheet, onCallTest }: CombatantPanelProps) {
  const [entry, setEntry] = useState("");
  const [critical, setCritical] = useState(false);
  const [condition, setCondition] = useState("");
  const [after, setAfter] = useState("");
  const { health } = encounter;
  const amount = amountOf(entry);
  const dying = actor?.fields.healthState === "dying";

  // KEY: one press of the keypad.
  const handleKey = (key: string) => () => setEntry((e) => pressKey({ entry: e, key }));

  // DAMAGE or HEAL: sends the typed amount to the ruleset's health track, then clears the pad when it went through.
  const handleHit = (op: "damage" | "heal") => async () => {
    if (amount === 0) return;
    const input = op === "damage" ? { actorId: c.actorId, amount, critical } : { actorId: c.actorId, amount };
    if (await run({ type: "rule.op", primitive: "health.tracks", op, input })) setEntry("");
  };

  // TEMP HP: adds the typed amount to the track's temporary points.
  const handleTemp = async () => {
    if (amount === 0 || !health?.temp) return;
    const input = { actorId: c.actorId, resource: health.temp, delta: amount };
    if (await run({ type: "rule.op", primitive: "resource.capped", op: "adjust", input })) setEntry("");
  };

  // DEATH SAVE: records what the player read off the die.
  const handleSave = (result: DeathSaveKey) => () =>
    run({ type: "rule.op", primitive: "health.tracks", op: "deathSave", input: { actorId: c.actorId, result } });

  // ADD CONDITION: the picked condition, lasting the typed number of turns or rounds when it counts.
  const handleAddCondition = async () => {
    if (condition === "") return;
    const count = Number(after);
    const expiresAfter = after !== "" && Number.isInteger(count) && count > 0 ? count : undefined;
    if (await run({ type: "condition.add", actorId: c.actorId, condition, expiresAfter })) setAfter("");
  };

  // VISIBILITY: what the table sees of this combatant.
  const handleVisibility = (visibility: CombatVisibility) => () =>
    run({ type: "encounter.setVisibility", combatantId: c.id, visibility });

  // KEEP: a temporary creature the GM keeps when the fight ends.
  const handleKeep = (e: ChangeEvent<HTMLInputElement>) =>
    run({ type: "encounter.keep", combatantId: c.id, keep: e.target.checked });

  const tally = (field: string) => {
    const v = actor?.fields[field];
    return typeof v === "number" ? v : 0;
  };

  return (
    <section className="card combatant-panel" aria-label={`${c.name} controls`}>
      <h2 className="title">{c.name}</h2>
      <HealthBar combatant={c} />
      {actor && actor.entity !== "" && (onSheet || onCallTest) && (
        <div className="row">
          {onSheet && (
            <button className="btn" onClick={() => onSheet(actor.id)}>
              Sheet
            </button>
          )}
          {onCallTest && (
            <button className="btn" onClick={() => onCallTest(actor.id)}>
              Call a Test
            </button>
          )}
        </div>
      )}

      {health && (
        <div className="stack keypad">
          <output className="keypad-out" aria-label="Amount">
            {entry === "" ? "0" : entry}
          </output>
          <div className="roll-pad">
            {KEYPAD_KEYS.map((k) => (
              <button key={k} className="roll-key" aria-label={KEY_NAMES[k] ?? k} onClick={handleKey(k)}>
                {KEY_LABELS[k] ?? k}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="btn primary" disabled={amount === 0} onClick={handleHit("damage")}>
              Damage
            </button>
            <button className="btn" disabled={amount === 0} onClick={handleHit("heal")}>
              Heal
            </button>
            {health.temp && (
              <button className="btn" disabled={amount === 0} onClick={handleTemp}>
                Temp HP
              </button>
            )}
            <label className="row" style={{ display: "flex", minHeight: 44 }}>
              <input
                type="checkbox"
                checked={critical}
                onChange={(e) => setCritical(e.target.checked)}
                style={{ minHeight: 24 }}
              />
              Critical hit
            </label>
          </div>
        </div>
      )}

      {health?.deathSaves && dying && (
        <div className="stack" role="group" aria-label="Death save">
          <strong>
            Death saves: {tally("deathSaveSuccesses")} passed, {tally("deathSaveFailures")} failed
          </strong>
          <div className="row">
            {(Object.keys(DEATH_SAVE_LABELS) as DeathSaveKey[]).map((k) => (
              <button key={k} className="btn" onClick={handleSave(k)}>
                {DEATH_SAVE_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="stack" role="group" aria-label="What the table sees">
        <strong>The table sees</strong>
        <div className="seg">
          {CombatVisibility.options.map((v) => (
            <button key={v} className="btn" aria-pressed={c.visibility === v} onClick={handleVisibility(v)}>
              {VISIBILITY_LABELS[v]}
            </button>
          ))}
        </div>
        {c.side !== "party" && (
          <label className="row" style={{ display: "flex", minHeight: 44 }}>
            <input type="checkbox" checked={c.keep} onChange={handleKeep} style={{ minHeight: 24 }} />
            Keep when the fight ends
          </label>
        )}
      </div>

      <div className="stack">
        <strong>Conditions</strong>
        {c.conditions.length === 0 && <span className="dim">None.</span>}
        <ul className="list">
          {c.conditions.map((k) => (
            <li key={k.id}>
              <span>
                {encounter.conditionDefs.find((d) => d.id === k.id)?.label ?? k.id}{" "}
                <span className="dim">{leftText(k)}</span>
              </span>
              <button
                className="btn sm"
                aria-label={`Remove ${k.id} from ${c.name}`}
                onClick={() => run({ type: "condition.remove", actorId: c.actorId, condition: k.id })}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
        <div className="row">
          <select aria-label="Condition to add" value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">Add a condition…</option>
            {encounter.conditionDefs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            aria-label="Turns or rounds it lasts"
            placeholder="Lasts"
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            style={{ width: 90 }}
          />
          <button className="btn" disabled={condition === ""} onClick={handleAddCondition}>
            Add
          </button>
        </div>
      </div>

      <button
        className="btn"
        style={{ justifySelf: "start" }}
        onClick={() => run({ type: "encounter.remove", combatantId: c.id })}
      >
        Remove from fight
      </button>
    </section>
  );
}
