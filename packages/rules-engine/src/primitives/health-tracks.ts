import { z } from "zod";

import { DeathSaveResult, HealthState } from "../enums.ts";
import { FieldId, Health, Id, type HealthTrack } from "../manifest.ts";
import {
  actorResource,
  defineOp,
  isRefusal,
  refuse,
  type ActorState,
  type Delta,
  type Primitive,
  type Refusal,
  type ResourceState,
  type RuleState,
  type TargetPattern,
} from "./primitive.ts";

/**
 * The manifest's `health` plus where the engine keeps its status and death-save tallies. A ruleset declares these
 * fields on its actor entities to give them a visibility; undeclared, they stay GM-only.
 */
export const HealthTracksParams = Health.extend({
  stateField: FieldId.default("healthState"),
  successField: FieldId.default("deathSaveSuccesses"),
  failureField: FieldId.default("deathSaveFailures"),
});
export type HealthTracksParams = z.infer<typeof HealthTracksParams>;

export const HealInput = z.object({
  actorId: z.string().min(1),
  amount: z.int().min(0).max(1_000_000),
  /** The track's resource id; the first track when omitted. */
  track: Id.optional(),
});
export type HealInput = z.infer<typeof HealInput>;
export const DamageInput = HealInput.extend({
  /** A critical hit; counts `failuresOnCriticalDamage` failures on a dying actor. The table reports it. */
  critical: z.boolean().default(false),
});
export type DamageInput = z.infer<typeof DamageInput>;

export const DeathSaveInput = z.object({ actorId: z.string().min(1), result: DeathSaveResult });
export type DeathSaveInput = z.infer<typeof DeathSaveInput>;

interface TrackCtx {
  track: HealthTrack;
  actor: ActorState;
  hp: ResourceState;
  temp: ResourceState | null;
  status: HealthState;
}

function statusOf({ actor, params }: { actor: ActorState; params: HealthTracksParams }): HealthState {
  const raw = Object.hasOwn(actor.fields, params.stateField) ? actor.fields[params.stateField] : undefined;
  const parsed = HealthState.safeParse(raw);
  return parsed.success ? parsed.data : "ok";
}

function tally({ actor, field }: { actor: ActorState; field: string }): number {
  const v = Object.hasOwn(actor.fields, field) ? actor.fields[field] : undefined;
  return typeof v === "number" ? v : 0;
}

function load({
  params,
  state,
  actorId,
  track,
}: {
  params: HealthTracksParams;
  state: RuleState;
  actorId: string;
  track: HealthTrack | undefined;
}): TrackCtx | Refusal {
  if (track === undefined) return refuse("badParams", "no such health track");
  const main = actorResource({ state, actorId, resource: track.resource });
  if (isRefusal(main)) return main;
  let temp: ResourceState | null = null;
  if (track.temp !== undefined) {
    const t = actorResource({ state, actorId, resource: track.temp });
    // No temp row yet means no temporary hit points, not an error.
    temp = isRefusal(t) ? null : t.res;
  }
  return { track, actor: main.actor, hp: main.res, temp, status: statusOf({ actor: main.actor, params }) };
}

function pickTrack({ params, id }: { params: HealthTracksParams; id: string | undefined }): HealthTrack | undefined {
  return id === undefined ? params.tracks[0] : params.tracks.find((t) => t.resource === id);
}

/** Entering or leaving dying starts the tallies over. */
function setStatus({
  params,
  actorId,
  status,
}: {
  params: HealthTracksParams;
  actorId: string;
  status: HealthState;
}): Delta[] {
  return [
    { target: { actorId, field: params.stateField }, kind: "set", value: status },
    { target: { actorId, field: params.successField }, kind: "set", value: 0 },
    { target: { actorId, field: params.failureField }, kind: "set", value: 0 },
  ];
}

function healDeltas({ c, params, amount }: { c: TrackCtx; params: HealthTracksParams; amount: number }): Delta[] {
  const { actor, hp, track } = c;
  // Healing never lowers a value already over a max that has since dropped.
  const next = hp.max === null ? hp.value + amount : Math.max(hp.value, Math.min(hp.max, hp.value + amount));
  const deltas: Delta[] = [];
  if (next !== hp.value)
    deltas.push({ target: { actorId: actor.id, resource: track.resource }, kind: "add", value: next - hp.value });
  if (track.deathSaves !== undefined && amount > 0 && (c.status === "dying" || c.status === "stable")) {
    deltas.push(...setStatus({ params, actorId: actor.id, status: "ok" }));
  }
  return deltas;
}

function targets({ params }: { params: HealthTracksParams }): TargetPattern[] {
  return [
    ...params.tracks.flatMap((t): TargetPattern[] => [
      { resource: t.resource },
      ...(t.temp === undefined ? [] : [{ resource: t.temp }]),
    ]),
    { field: params.stateField },
    { field: params.successField },
    { field: params.failureField },
  ];
}

// The tracks count down from max to min (hit points). A track that counts damage up past its max is a different
// mechanic and gets its own primitive.
export const healthTracks: Primitive<HealthTracksParams> = {
  id: "health.tracks",
  params: HealthTracksParams,
  ops: {
    damage: defineOp<HealthTracksParams, DamageInput>({
      input: DamageInput,
      perm: "character:edit:any",
      touches: "state",
      targets,
      validate: ({ ctx: { params, state }, input }) => {
        const c = load({ params, state, actorId: input.actorId, track: pickTrack({ params, id: input.track }) });
        if (isRefusal(c)) return c;
        return c.status === "dead" ? refuse("wrongState", "the actor is dead") : null;
      },
      apply: ({ ctx: { params, state }, input }) => {
        const c = load({ params, state, actorId: input.actorId, track: pickTrack({ params, id: input.track }) });
        if (isRefusal(c)) return [];
        const { actor, hp, temp, track } = c;
        // Temporary points soak first; what is left goes to the track, which stops at its min (overflow is lost).
        const absorbed = temp === null ? 0 : Math.min(input.amount, Math.max(0, temp.value - temp.min));
        const rest = input.amount - absorbed;
        const next = Math.max(hp.min, hp.value - rest);
        const deltas: Delta[] = [];
        if (absorbed > 0 && track.temp !== undefined) {
          deltas.push({ target: { actorId: actor.id, resource: track.temp }, kind: "add", value: -absorbed });
        }
        if (next !== hp.value)
          deltas.push({ target: { actorId: actor.id, resource: track.resource }, kind: "add", value: next - hp.value });
        // Damage left once the track is at its min; an instant death rule reads it (docs/house-decisions.md #13).
        const overflow = Math.max(0, rest - Math.max(0, hp.value - hp.min));
        if (hp.instantDeathAt != null && overflow >= hp.instantDeathAt) {
          deltas.push({ target: { actorId: actor.id, field: params.stateField }, kind: "set", value: "dead" });
          return deltas;
        }
        // Only a track with death saves has a dying state; a hit that reaches the track at its min starts it.
        // A stable actor hit again starts dying with fresh tallies (docs/house-decisions.md #12).
        if (track.deathSaves !== undefined && rest > 0 && next <= hp.min && c.status !== "dying") {
          deltas.push(...setStatus({ params, actorId: actor.id, status: "dying" }));
        }
        // A dying actor hit again: failures only when the ruleset says so (docs/house-decisions.md #7).
        const rules = track.deathSaves;
        if (rules?.failuresOnDamage !== undefined && rest > 0 && c.status === "dying") {
          const added = input.critical
            ? (rules.failuresOnCriticalDamage ?? rules.failuresOnDamage)
            : rules.failuresOnDamage;
          const failures = tally({ actor, field: params.failureField }) + added;
          deltas.push({ target: { actorId: actor.id, field: params.failureField }, kind: "set", value: failures });
          if (failures >= rules.failures)
            deltas.push({ target: { actorId: actor.id, field: params.stateField }, kind: "set", value: "dead" });
        }
        return deltas;
      },
    }),
    heal: defineOp<HealthTracksParams, HealInput>({
      input: HealInput,
      perm: "character:edit:any",
      touches: "state",
      targets,
      validate: ({ ctx: { params, state }, input }) => {
        const c = load({ params, state, actorId: input.actorId, track: pickTrack({ params, id: input.track }) });
        if (isRefusal(c)) return c;
        // Dead is a GM's call to undo (field.set), not something healing reverses.
        return c.status === "dead" ? refuse("wrongState", "the actor is dead") : null;
      },
      apply: ({ ctx: { params, state }, input }) => {
        const c = load({ params, state, actorId: input.actorId, track: pickTrack({ params, id: input.track }) });
        return isRefusal(c) ? [] : healDeltas({ c, params, amount: input.amount });
      },
    }),
    deathSave: defineOp<HealthTracksParams, DeathSaveInput>({
      input: DeathSaveInput,
      perm: "character:edit:any",
      touches: "state",
      targets,
      validate: ({ ctx: { params, state }, input }) => {
        const track = params.tracks.find((t) => t.deathSaves !== undefined);
        if (track === undefined) return refuse("badParams", "this ruleset has no death saves");
        const c = load({ params, state, actorId: input.actorId, track });
        if (isRefusal(c)) return c;
        return c.status === "dying" ? null : refuse("wrongState", "only a dying actor rolls death saves");
      },
      apply: ({ ctx: { params, state }, input }) => {
        const track = params.tracks.find((t) => t.deathSaves !== undefined);
        const c = load({ params, state, actorId: input.actorId, track });
        if (isRefusal(c) || track?.deathSaves === undefined) return [];
        const rules = track.deathSaves;
        const actorId = c.actor.id;
        if (input.result === "criticalSuccess" && rules.criticalSuccessHeals !== undefined) {
          return healDeltas({ c, params, amount: rules.criticalSuccessHeals });
        }
        let successes = tally({ actor: c.actor, field: params.successField });
        let failures = tally({ actor: c.actor, field: params.failureField });
        if (input.result === "success" || input.result === "criticalSuccess") successes += 1;
        else failures += input.result === "criticalFailure" ? rules.criticalFailureCounts : 1;
        const deltas: Delta[] = [
          { target: { actorId, field: params.successField }, kind: "set", value: successes },
          { target: { actorId, field: params.failureField }, kind: "set", value: failures },
        ];
        // The thresholds are the manifest's numbers, never the engine's.
        if (failures >= rules.failures)
          deltas.push({ target: { actorId, field: params.stateField }, kind: "set", value: "dead" });
        else if (successes >= rules.successes) {
          deltas.push({ target: { actorId, field: params.stateField }, kind: "set", value: "stable" });
        }
        return deltas;
      },
    }),
  },
};
