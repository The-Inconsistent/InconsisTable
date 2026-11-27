"use client";
import { useTranslations } from "next-intl";
import type { ChangeEvent } from "react";

import type { ActionInput, ActionResult, Actor, CodexEntry, LiveState } from "@inconsistable/core-schema";
import type { CompiledRuleset, Ruleset } from "@inconsistable/rules-engine";

import { SpendButtons } from "@/components/gm/spend-buttons/spend-buttons";
import { HarmPad } from "@/components/gm/track/components/combatant-panel/components/harm-pad/harm-pad";
import { CallForm } from "@/components/gm/tests/components/call-form/call-form";
import { ResourceRow } from "@/components/ui/resource-row/resource-row";
import type { Send } from "@/hooks/use-table/use-table";
import { harmPadOf } from "@/lib/harm/harm";
import { rangeOf, restsOf, stepAction, stepsOf } from "@/lib/sheet/sheet";

import { Objectives } from "../objectives/objectives";

type StatusTabProps = {
  actor: Actor;
  ruleset: Ruleset;
  compiled: CompiledRuleset | null;
  state: LiveState;
  send: Send;
  act: (a: ActionInput) => Promise<ActionResult>;
  /** The seat steps every resource of this character (the GM side). */
  gm: boolean;
  /** The seat may: change conditions, spend for it, call a Test, edit its objectives. */
  may: { conditions: boolean; spend: boolean; call: boolean; objectives: boolean };
  /** Its objectives and every quest of the room; null without the codex. */
  quests: { mine: readonly CodexEntry[]; all: readonly CodexEntry[] } | null;
};

// STATUS: the character's resources with their steppers (harm, which moves only by a hit, through the tracker's hit
// pad), its conditions, its objectives, then what the ruleset lets the GM do for it now (rests, spends, a Test).
export function StatusTab({ actor, ruleset, compiled, state, send, act, gm, may, quests }: StatusTabProps) {
  const t = useTranslations("party");
  const tRest = useTranslations("rest");
  const characters = state.actors.filter((a) => a.kind === "pc").length;
  const resources = ruleset.resources.filter((r) => actor.resources[r.id] !== undefined);
  const held = actor.conditions.flatMap((id) => ruleset.conditions.find((c) => c.id === id) ?? []);
  const addable = ruleset.conditions.filter((c) => !actor.conditions.includes(c.id));
  const rests = gm ? restsOf(ruleset) : [];
  const rangeFor = (resource: string) =>
    compiled ? rangeOf({ compiled, resource, actor, characters, campaign: state.campaign.fields }) : null;
  const harm = gm ? harmPadOf({ ruleset, actor, combatant: { members: null } }) : null;
  // The hit pad's run: the action, and whether it went through.
  const run = async (a: ActionInput) => (await act(a)).ok;

  // + CONDITION: the picked condition goes on at once; the picker goes back to its prompt.
  const handleAddCondition = (e: ChangeEvent<HTMLSelectElement>) => {
    const condition = e.target.value;
    e.target.value = "";
    if (condition !== "") void act({ type: "condition.add", actorId: actor.id, condition });
  };

  return (
    <div className="stack">
      {resources.length > 0 && (
        <div className="party-tiles">
          {resources.map((r) => (
            <ResourceRow
              key={r.id}
              stat={r.id}
              label={r.label}
              value={actor.resources[r.id] ?? 0}
              range={rangeFor(r.id)}
              steps={stepsOf({ ruleset, resource: r.id, gm })}
              holder={actor.name}
              onStep={(delta) => void act(stepAction({ ruleset, actorId: actor.id, resource: r.id, delta }))}
            />
          ))}
        </div>
      )}
      {harm && (
        <details className="stack ws-fold">
          <summary className="head">{t("hitPad")}</summary>
          <HarmPad
            combatant={{ actorId: actor.id, name: actor.name, members: null }}
            actor={actor}
            pad={harm}
            maxOf={(resource) => rangeFor(resource)?.max ?? null}
            run={run}
          />
        </details>
      )}

      <section className="stack">
        <h3 className="head">{t("conditions")}</h3>
        <div className="row" style={{ gap: 6 }}>
          {held.length === 0 && <span className="dim small">{t("noConditions")}</span>}
          {held.map((c) =>
            may.conditions ? (
              <button
                key={c.id}
                className="btn sm"
                aria-label={t("removeCondition", { condition: c.label, name: actor.name })}
                onClick={() => act({ type: "condition.remove", actorId: actor.id, condition: c.id })}
              >
                {c.label} ×
              </button>
            ) : (
              <span key={c.id} className="chip">
                {c.label}
              </span>
            ),
          )}
          {may.conditions && addable.length > 0 && (
            <select
              aria-label={t("addConditionLabel", { name: actor.name })}
              defaultValue=""
              onChange={handleAddCondition}
            >
              <option value="">{t("addCondition")}</option>
              {addable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </section>

      {quests && may.objectives && (
        <Objectives actor={actor} objectives={quests.mine} quests={quests.all} act={act} send={send} />
      )}

      {(rests.length > 0 || may.spend) && (
        <div className="row">
          {rests.map((b) => (
            <button
              key={b.event}
              className="btn"
              aria-label={t("restFor", { rest: tRest(b.event), name: actor.name })}
              onClick={() => act({ type: "actor.rest", event: b.event, actorId: actor.id })}
            >
              {tRest(b.event)}
            </button>
          ))}
          {may.spend && <SpendButtons ruleset={ruleset} compiled={compiled} state={state} actor={actor} send={send} />}
        </div>
      )}
      {may.call && state.testDefs.length > 0 && (
        <details className="stack ws-fold">
          <summary className="head">{t("callTest")}</summary>
          <CallForm state={state} send={send} initialTargets={[actor.id]} />
        </details>
      )}
    </div>
  );
}
