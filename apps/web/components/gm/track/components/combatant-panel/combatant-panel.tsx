"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type ReactNode } from "react";

import {
  CombatVisibility,
  type Actor,
  type Combatant,
  type Encounter,
  type PoolState,
} from "@inconsistable/core-schema";
import type { SidesInitiative } from "@inconsistable/rules-engine";

import { HarmPad } from "@/components/gm/track/components/combatant-panel/components/harm-pad/harm-pad";
import { SideActions } from "@/components/gm/track/components/side-actions/side-actions";
import {
  DEATH_SAVE_KEYS,
  KEYPAD_KEYS,
  KEY_LABELS,
  type DeathSaveKey,
  type Run,
  type TrackMode,
} from "@/components/gm/track/constants";
import { HealthBar } from "@/components/ui/health-bar/health-bar";
import { MarkerPicker } from "@/components/ui/marker-swatch/marker-swatch";
import { Term, type TermEnv } from "@/components/ui/term-card/term-card";
import type { HarmPad as HarmPadOf } from "@/lib/harm/harm";
import { amountOf, leftOf, pressKey } from "@/lib/track/track";

type CombatantPanelProps = {
  encounter: Encounter;
  combatant: Combatant;
  actor: Actor | undefined;
  run: Run;
  mode: TrackMode;
  /** Opens this actor's sheet (GM only; absent when there is no ruleset to read it by). */
  onSheet?: (actorId: string) => void;
  /** Opens the Tests call form for this actor (GM only; absent when the ruleset has no Tests). */
  onCallTest?: (actorId: string) => void;
  /** The pinned ruleset's sides order, when it has one: the panel offers the turn actions. */
  sides?: SidesInitiative;
  /** The shared pools this seat received, to word a cost. */
  pools?: readonly PoolState[];
  /** The `health.harm` pad this combatant gets (house decision #66), shown instead of the health track's keypad. */
  harm?: { pad: HarmPadOf; maxOf: (resource: string) => number | null } | null;
  /** The api's refusal of an action this panel sent, shown here (issue #167); null when there is none. */
  refusal?: string | null;
  /** The ruleset's one-tap spends for this combatant's actor (house decision #84). */
  spends?: ReactNode;
  /** What the actor holds up, with its quick picks, end one and end all (house decision #91). */
  held?: ReactNode;
  /** The strike guide for this combatant as the attacker (house decision #99); absent where it has no strike. */
  strike?: ReactNode;
  /** The lookups for this combatant (house decision #225): the ruleset's lookup tables, applied to it. */
  lookups?: ReactNode;
  /** The ruleset as the GM reads it with the page relay: a condition opens what it means (house decision #126). */
  terms?: TermEnv;
};

// A refusal shown in the panel is brought into view when it appears: on a phone the panel's controls sit far below.
// Stable, so React calls it only when the line mounts (a new refusal remounts it by its key). Centred, since a line
// scrolled to the top edge would sit under the sticky fight bar.
const bringIntoView = (el: HTMLElement | null) => el?.scrollIntoView({ block: "center" });

// The selected combatant: a keypad for damage, healing and temporary points, death saves, what the table sees, the
// conditions it carries with their time left, and the way out of the fight.
export function CombatantPanel({
  encounter,
  combatant: c,
  actor,
  run,
  mode,
  onSheet,
  onCallTest,
  sides,
  pools = [],
  harm,
  refusal = null,
  spends,
  held,
  strike,
  lookups,
  terms,
}: CombatantPanelProps) {
  const t = useTranslations("combatantPanel");
  const tSave = useTranslations("deathSave");
  const tVisibility = useTranslations("combatVisibility");
  const tKeys = useTranslations("keypad");
  const tSheet = useTranslations("sheet");
  const tBar = useTranslations("healthBar");
  const stackedLabel = (label: string, count: number | undefined) =>
    count === undefined ? label : tBar("stacked", { label, count });
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

  // What a condition has left ("2 rounds left"), or "" when it doesn't count.
  const leftText = (k: { left: number | null; expiresOn: string }) => {
    const l = leftOf(k);
    return l ? tSheet(l.unit === "turn" ? "turnsLeft" : "roundsLeft", { count: l.count }) : "";
  };

  const tally = (field: string) => {
    const v = actor?.fields[field];
    return typeof v === "number" ? v : 0;
  };

  return (
    <section className="card combatant-panel" aria-label={t("controls", { name: c.name })}>
      <h2 className="title">{c.name}</h2>
      <HealthBar combatant={c} />
      {refusal && (
        <p key={refusal} ref={bringIntoView} className="error" role="alert">
          {refusal}
        </p>
      )}
      {actor && actor.entity !== "" && (onSheet || onCallTest) && (
        <div className="row">
          {onSheet && (
            <button className="btn" onClick={() => onSheet(actor.id)}>
              {t("sheet")}
            </button>
          )}
          {onCallTest && (
            <button className="btn" onClick={() => onCallTest(actor.id)}>
              {t("callTest")}
            </button>
          )}
        </div>
      )}

      {sides && <SideActions encounter={encounter} combatant={c} sides={sides} pools={pools} run={run} />}
      {strike}
      {spends}
      {held}

      {harm && actor ? (
        <HarmPad combatant={c} actor={actor} pad={harm.pad} maxOf={harm.maxOf} run={run} />
      ) : (
        health && (
          <div className="stack keypad">
            <output className="keypad-out" aria-label={t("amount")}>
              {entry === "" ? "0" : entry}
            </output>
            <div className="roll-pad">
              {KEYPAD_KEYS.map((k) => (
                <button
                  key={k}
                  className="roll-key"
                  aria-label={k === "clear" || k === "back" ? tKeys(k) : k}
                  onClick={handleKey(k)}
                >
                  {KEY_LABELS[k] ?? k}
                </button>
              ))}
            </div>
            <div className="row">
              <button className="btn primary" disabled={amount === 0} onClick={handleHit("damage")}>
                {t("damage")}
              </button>
              <button className="btn" disabled={amount === 0} onClick={handleHit("heal")}>
                {t("heal")}
              </button>
              {health.temp && (
                <button className="btn" disabled={amount === 0} onClick={handleTemp}>
                  {t("tempHp")}
                </button>
              )}
              <label className="row" style={{ display: "flex", minHeight: 44 }}>
                <input
                  type="checkbox"
                  checked={critical}
                  onChange={(e) => setCritical(e.target.checked)}
                  style={{ minHeight: 24 }}
                />
                {t("critical")}
              </label>
            </div>
          </div>
        )
      )}

      {health?.deathSaves && dying && (
        <div className="stack" role="group" aria-label={t("deathSave")}>
          <strong>
            {t("deathSaves", { passed: tally("deathSaveSuccesses"), failed: tally("deathSaveFailures") })}
          </strong>
          <div className="row">
            {DEATH_SAVE_KEYS.map((k) => (
              <button key={k} className="btn" onClick={handleSave(k)}>
                {tSave(k)}
              </button>
            ))}
          </div>
        </div>
      )}

      {lookups}

      <div className="stack" role="group" aria-label={t("tableSees")}>
        <strong>{t("tableSees")}</strong>
        <div className="seg">
          {CombatVisibility.options.map((v) => (
            <button key={v} className="btn" aria-pressed={c.visibility === v} onClick={handleVisibility(v)}>
              {tVisibility(v)}
            </button>
          ))}
        </div>
        <MarkerPicker
          value={c.marker ?? null}
          onPick={(marker) => run({ type: "encounter.mark", combatantId: c.id, marker })}
          name={c.name}
        />
        {c.side !== "party" && (
          <label className="row" style={{ display: "flex", minHeight: 44 }}>
            <input type="checkbox" checked={c.keep} onChange={handleKeep} style={{ minHeight: 24 }} />
            {t("keep", { mode })}
          </label>
        )}
      </div>

      <div className="stack">
        <strong>{t("conditions")}</strong>
        {c.conditions.length === 0 && <span className="dim">{t("none")}</span>}
        <ul className="list">
          {c.conditions.map((k) => (
            <li key={k.id}>
              <span>
                <Term
                  term={{
                    ...terms?.ruleset.conditions.find((d) => d.id === k.id),
                    label: stackedLabel(encounter.conditionDefs.find((d) => d.id === k.id)?.label ?? k.id, k.stacks),
                  }}
                  env={terms}
                />{" "}
                <span className="dim">{leftText(k)}</span>
              </span>
              <button
                className="btn sm"
                aria-label={t("removeCondition", { condition: k.id, name: c.name })}
                onClick={() => run({ type: "condition.remove", actorId: c.actorId, condition: k.id })}
              >
                {t("remove")}
              </button>
            </li>
          ))}
        </ul>
        <div className="row">
          <select aria-label={t("conditionToAdd")} value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">{t("addCondition")}</option>
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
            aria-label={t("lastsLabel")}
            placeholder={t("lasts")}
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            style={{ width: 90 }}
          />
          <button className="btn" disabled={condition === ""} onClick={handleAddCondition}>
            {t("add")}
          </button>
        </div>
      </div>

      <button
        className="btn"
        style={{ justifySelf: "start" }}
        onClick={() => run({ type: "encounter.remove", combatantId: c.id })}
      >
        {t("removeFromFight", { mode })}
      </button>
    </section>
  );
}
