"use client";
import { useTranslations } from "next-intl";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";

import type { Actor, Combatant } from "@inconsistable/core-schema";

import type { Run } from "@/components/gm/track/constants";
import {
  HARM_AMOUNTS,
  HARM_DIRECTIONS,
  HARM_SIGN,
  MUSTER,
  parseCount,
  parseDelta,
  type HarmDirection,
  type HarmPad as Pad,
  type HarmTrack,
} from "@/lib/harm/harm";

type HarmPadProps = {
  combatant: Combatant;
  actor: Actor;
  pad: Pad;
  /** A resource's max for this actor, when the manifest's formula can be worked out here. */
  maxOf: (resource: string) => number | null;
  run: Run;
};

// The hit pad of a `health.harm` ruleset (house decision #66), as Auspex's: which track, deal or heal, the quick amounts
// or a typed signed number. Positive is harm taken on both tracks. A mob shows its count large and can be mustered to a
// size; an actor whose profile counts injuries gets a +1 for them.
export function HarmPad({ combatant: c, actor, pad, maxOf, run }: HarmPadProps) {
  const t = useTranslations("harmPad");
  const id = useId();
  const [track, setTrack] = useState<HarmTrack>("wounds");
  const [direction, setDirection] = useState<HarmDirection>("deal");
  const [text, setText] = useState("");
  const [refused, setRefused] = useState(false);
  const [size, setSize] = useState("");
  const open = track === "shock" && pad.shock ? pad.shock : pad.wounds;
  const muster = parseCount({ text: size, ...MUSTER });
  const held = pad.injuries ? actor.fields[pad.injuries.id] : undefined;
  const injuries = typeof held === "number" ? held : 0;

  // HIT: one track by a signed amount; the pad clears when it went through.
  const handleHit = async (delta: number) => {
    const input = { actorId: c.actorId, [track]: delta };
    if (await run({ type: "rule.op", primitive: "health.harm", op: "hit", input })) setText("");
  };

  // ENTER on the typed number: a sign wins, a bare number follows the direction.
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const delta = parseDelta({ text, direction });
    if (delta === null) return setRefused(true);
    void handleHit(delta);
  };

  // Typing clears the refusal shown for the last entry.
  const handleText = (e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    setRefused(false);
  };

  // SET SIZE: the mob stands at the typed number of members.
  const handleMuster = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (muster === null) return;
    const input = { actorId: c.actorId, members: muster };
    if (await run({ type: "rule.op", primitive: "health.harm", op: "muster", input })) setSize("");
  };

  // +1 INJURY: the profile's injuries field, one more, through the GM's field write (an absolute value: no field delta
  // exists, and the GM's queue serialises it).
  const handleInjury = (field: string) => () =>
    run({ type: "field.set", actorId: c.actorId, field, value: injuries + 1 });
  const tracks = [
    { key: "wounds" as const, ...pad.wounds, carried: true },
    ...(pad.shock ? [{ key: "shock" as const, ...pad.shock }] : []),
  ];

  return (
    <div className="stack keypad harm-pad" role="group" aria-label={t("label", { name: c.name })}>
      {pad.members && c.members && (
        <div className="stack" style={{ gap: 2 }}>
          <span className="stat-label">{pad.members.label}</span>
          <output className="keypad-out" aria-label={t("count", { label: pad.members.label, name: c.name })}>
            {c.members.value}
            {c.members.max !== null && ` / ${c.members.max}`}
          </output>
        </div>
      )}
      {tracks.length > 1 && (
        <div className="seg" role="group" aria-label={t("track")}>
          {tracks.map((k) => (
            <button
              key={k.key}
              type="button"
              className="btn"
              aria-pressed={k.key === track}
              disabled={!k.carried}
              onClick={() => setTrack(k.key)}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
      <div className="seg" role="group" aria-label={t("direction")}>
        {HARM_DIRECTIONS.map((d) => (
          <button key={d} type="button" className="btn" aria-pressed={d === direction} onClick={() => setDirection(d)}>
            {t(d === "heal" && track === "shock" ? "recover" : d)}
          </button>
        ))}
      </div>
      <div className="roll-pad harm-amounts">
        {HARM_AMOUNTS.map((n) => {
          const delta = HARM_SIGN[direction] * n;
          return (
            <button
              key={n}
              type="button"
              className="roll-key"
              aria-label={t("apply", { delta, label: open.label, name: c.name })}
              onClick={() => handleHit(delta)}
            >
              {n}
            </button>
          );
        })}
      </div>
      <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={handleSubmit}>
        <label htmlFor={`${id}-type`} className="sr-only">
          {t("typeLabel", { label: open.label })}
        </label>
        <input
          id={`${id}-type`}
          type="text"
          autoComplete="off"
          placeholder={t("typePlaceholder")}
          aria-invalid={refused}
          aria-describedby={`${id}-hint`}
          value={text}
          onChange={handleText}
          style={{ flex: 1, minWidth: 0 }}
        />
        <button className="btn primary" disabled={text.trim() === ""}>
          {t("applyTyped")}
        </button>
      </form>
      <span id={`${id}-hint`} className={refused ? "error small" : "dim small"} role={refused ? "alert" : undefined}>
        {refused ? t("typeRefused") : t("typeHint")}
      </span>
      <p className="row" style={{ margin: 0 }}>
        {/* Each track's `value / max` as the GM's state gives it; a mob's wounds are its count, shown above. */}
        {tracks.map((k) => {
          if (k.key === "wounds" && c.members) return null;
          const value = actor.resources[k.id];
          const max = maxOf(k.id);
          return (
            <span key={k.key} className="chip" data-stat={k.id}>
              {k.label} {value ?? "—"}
              {value !== undefined && max !== null && ` / ${max}`}
            </span>
          );
        })}
      </p>
      {pad.members && (
        <form className="row" onSubmit={handleMuster}>
          <label className="row" style={{ display: "flex" }}>
            {t("setSize")}
            <input
              type="number"
              inputMode="numeric"
              min={MUSTER.min}
              max={MUSTER.max}
              value={size}
              onChange={(e) => setSize(e.target.value)}
              style={{ width: 96 }}
            />
          </label>
          <button className="btn" disabled={muster === null}>
            {t("set")}
          </button>
        </form>
      )}
      {pad.injuries && (
        <div className="row">
          <span className="stat-label">{pad.injuries.label}</span>
          <strong style={{ fontSize: "var(--fs-name)", fontVariantNumeric: "tabular-nums" }}>{injuries}</strong>
          <button
            type="button"
            className="btn"
            aria-label={t("addInjury", { label: pad.injuries.label, name: c.name })}
            onClick={handleInjury(pad.injuries.id)}
          >
            +1
          </button>
        </div>
      )}
    </div>
  );
}
