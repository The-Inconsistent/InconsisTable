import type { Actor, Combatant } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { barPercent } from "../track/track.ts";

// Damage that counts up, and mobs (house decision #66): which pad the GM's panel shows for a combatant, what a typed hit
// means, and what any seat draws of a combatant. Every label is the manifest's. Pure.

/** The pad's two directions and their signs. Both tracks count up, so dealing is + and healing or recovering is −. */
export const HARM_DIRECTIONS = ["deal", "heal"] as const;
export type HarmDirection = (typeof HARM_DIRECTIONS)[number];
export const HARM_SIGN: Record<HarmDirection, 1 | -1> = { deal: 1, heal: -1 };

/** The pad's tracks, as `hit` names them. */
export const HARM_TRACKS = ["wounds", "shock"] as const;
export type HarmTrack = (typeof HARM_TRACKS)[number];

/** The quick amounts under the pad. */
export const HARM_AMOUNTS = [1, 2, 3, 4, 5, 6, 8, 10] as const;

/** One hit's bound either way (`health.harm`'s `hit`). */
export const HIT_MAX = 100;
/** A mob's size: what `muster` sets (0 to 500) and what `actor.spawn` makes (2 to 500). */
export const MUSTER = { min: 0, max: 500 } as const;
export const SPAWN_MOB = { min: 2, max: 500 } as const;

/**
 * What the pad's typed number means: `-3` heals or recovers 3, `+2` deals 2, a bare `2` follows the direction. A whole
 * number from 1 to 100 either way; anything else is null so the pad can say so.
 */
export function parseDelta({ text, direction }: { text: string; direction: HarmDirection }): number | null {
  const m = /^([+\-−–]?)\s*(\d{1,3})$/.exec(text.trim());
  if (!m) return null;
  const n = Number(m[2]);
  if (n === 0 || n > HIT_MAX) return null;
  if (m[1] === "") return HARM_SIGN[direction] * n;
  return m[1] === "+" ? n : -n;
}

/** A typed whole number inside `min..max`, or null. */
export function parseCount({ text, min, max }: { text: string; min: number; max: number }): number | null {
  if (!/^\d{1,4}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : null;
}

type Track = { id: string; label: string };

/** The harm pad a combatant gets, or null: the ruleset has no `health.harm`, or no profile holds the actor's type. */
export type HarmPad = {
  /** The track hits go to as `wounds`; a mob's is labelled with its members resource. */
  wounds: Track;
  /** Absent when the block names no shock resource; `carried` false when the actor has no row for it. */
  shock: (Track & { carried: boolean }) | null;
  /** The members resource, for a mob (the combatant carries a count). */
  members: Track | null;
  /** The int field counting injuries, when the profile has one. */
  injuries: Track | null;
};

export function harmPadOf({
  ruleset,
  actor,
  combatant,
}: {
  ruleset: Ruleset | null;
  actor: Pick<Actor, "entity" | "resources"> | undefined;
  combatant: Pick<Combatant, "members">;
}): HarmPad | null {
  const harm = ruleset?.health.harm;
  if (!ruleset || !harm || !actor) return null;
  const profile = harm.profiles.find((p) => p.entities.includes(actor.entity));
  if (!profile) return null;
  const track = (id: string): Track => ({ id, label: ruleset.resources.find((r) => r.id === id)?.label ?? id });
  const members = harm.mob && combatant.members !== null ? track(harm.mob.members) : null;
  const injuries = profile.felled?.injuries;
  const field = injuries ? ruleset.entities.find((e) => e.id === actor.entity)?.fields[injuries] : undefined;
  return {
    wounds: members ? { id: harm.wounds, label: members.label } : track(harm.wounds),
    shock: harm.shock ? { ...track(harm.shock), carried: harm.shock in actor.resources } : null,
    members,
    injuries: injuries ? { id: injuries, label: field?.label ?? injuries } : null,
  };
}

/** The resources only a hit or a muster moves in a harm ruleset: the server refuses their stepper (`hpThroughDamage`). */
export function harmOnly(ruleset: Ruleset): Set<string> {
  const harm = ruleset.health.harm;
  if (!harm) return new Set();
  return new Set([harm.wounds, harm.shock, harm.mob?.members].filter((x) => x !== undefined));
}

/** Whether a pack entry of this type can come as a mob: the block has `mob` and the type carries its members. */
export function canMob({ ruleset, type }: { ruleset: Ruleset | null; type: string }): boolean {
  const mob = ruleset?.health.harm?.mob;
  const members = mob ? ruleset?.resources.find((r) => r.id === mob.members) : undefined;
  return members !== undefined && (members.entities === undefined || members.entities.includes(type));
}

/** What any seat draws of a combatant: only what it was sent. A seat at `bar` gets no numbers, but states and a count. */
export const drawnOf = (c: Pick<Combatant, "bar" | "hp" | "states" | "members">) => ({
  percent: barPercent(c),
  numbers: c.hp,
  states: c.states,
  count: c.members?.value ?? null,
});
