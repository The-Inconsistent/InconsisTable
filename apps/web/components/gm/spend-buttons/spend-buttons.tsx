"use client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import type { Actor, LiveState } from "@inconsistable/core-schema";
import type { CompiledRuleset, Ruleset } from "@inconsistable/rules-engine";

import type { Send } from "@/hooks/use-table/use-table";
import { resourceLabels } from "@/lib/spend-request/spend-request";
import { costText, defaultInputs, inputMax, offersOf, spendWorld } from "@/lib/spends/spends";

type SpendButtonsProps = {
  ruleset: Ruleset;
  compiled: CompiledRuleset | null;
  state: LiveState;
  actor: Actor;
  send: Send;
};

// The GM side's one-tap spends for one character (house decision #84): each spend the server would take now, with its
// cost, and a number for each input. A tap is spend.do: the cost and the effect as one action, which Undo takes back.
export function SpendButtons({ ruleset, compiled, state, actor, send }: SpendButtonsProps) {
  const t = useTranslations("spendRequest");
  const id = useId();
  const [picked, setPicked] = useState<Record<string, Record<string, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const table = state;
  const characters = state.actors.filter((a) => a.kind === "pc").length;
  const listed = offersOf({ ruleset, compiled, table, actor, characters }).filter((o) => o.plan !== null);
  if (listed.length === 0) return null;
  const chosen = offersOf({ ruleset, compiled, table, actor, characters, inputs: picked });
  const world = spendWorld({ compiled, table, actor, characters });
  const labels = resourceLabels(ruleset);

  // SPEND: does it now, as the GM side; a refusal shows under the buttons.
  const handleSpend = async (spendId: string, inputs: Record<string, number>) => {
    const r = await send({ type: "spend.do", spendId, actorId: actor.id, inputs });
    setError(r.ok ? null : r.error);
  };
  // INPUT: keeps the number picked for one input of one spend.
  const handleInput = (spendId: string, name: string, value: string) =>
    setPicked((p) => ({ ...p, [spendId]: { ...p[spendId], [name]: Number(value) } }));

  return (
    <div className="stack spend-buttons" role="group" aria-label={t("spendsFor", { name: actor.name })}>
      <div className="row">
        {listed.map(({ spend }) => {
          const inputs = { ...defaultInputs(spend), ...picked[spend.id] };
          const plan = chosen.find((o) => o.spend.id === spend.id)?.plan ?? null;
          const cost = plan === null ? "" : costText({ costs: plan.costs, labels });
          return (
            <span key={spend.id} className="row spend-one">
              {Object.entries(spend.inputs ?? {}).map(([name, def]) => (
                <input
                  key={name}
                  id={`${id}-${spend.id}-${name}`}
                  className="spend-input"
                  type="number"
                  inputMode="numeric"
                  min={def.min}
                  max={inputMax({ world, source: def.max }) ?? undefined}
                  value={inputs[name] ?? def.min}
                  aria-label={t("inputAria", { input: def.label, label: spend.label })}
                  onChange={(e) => handleInput(spend.id, name, e.target.value)}
                />
              ))}
              <button
                className="btn sm"
                aria-label={t("spendDoAria", { label: spend.label, name: actor.name })}
                disabled={plan === null}
                onClick={() => handleSpend(spend.id, inputs)}
              >
                {cost ? `${spend.label} · ${cost}` : spend.label}
              </button>
            </span>
          );
        })}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
