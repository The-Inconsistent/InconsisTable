"use client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import type { Actor, LiveState } from "@inconsistable/core-schema";
import type { CompiledRuleset, Ruleset } from "@inconsistable/rules-engine";

import type { Send } from "@/hooks/use-table/use-table";
import { resourceLabels } from "@/lib/spend-request/spend-request";
import { costText, defaultInputs, inputMax, offersOf, shown, spendWorld, usedUp } from "@/lib/spends/spends";

type SpendButtonsProps = {
  ruleset: Ruleset;
  compiled: CompiledRuleset | null;
  state: LiveState;
  actor: Actor;
  send: Send;
  /** Opens one of the ruleset's tables in the tables panel (house decision #91); absent where there is none. */
  onTable?: (tableId: string) => void;
};

// The GM side's one-tap spends for one character (house decision #84): each spend the server would take now, with its
// cost, and a number for each input. A tap is spend.do: the cost and the effect as one action, which Undo takes back.
// A spend used up this round stays, disabled with the reason; one that opens a table next offers it (house decision #91).
export function SpendButtons({ ruleset, compiled, state, actor, send, onTable }: SpendButtonsProps) {
  const t = useTranslations("spendRequest");
  const id = useId();
  const [picked, setPicked] = useState<Record<string, Record<string, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const table = state;
  const characters = state.actors.filter((a) => a.kind === "pc").length;
  const offers = offersOf({ ruleset, compiled, table, actor, characters });
  const listed = offers.filter(shown);
  if (listed.length === 0) return null;
  const chosen = offersOf({ ruleset, compiled, table, actor, characters, inputs: picked });
  const world = spendWorld({ ruleset, compiled, table, actor, characters });
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
        {listed.map((offer) => {
          const { spend } = offer;
          const inputs = { ...defaultInputs(spend), ...picked[spend.id] };
          const plan = chosen.find((o) => o.spend.id === spend.id)?.plan ?? null;
          const cost = plan === null ? "" : costText({ costs: plan.costs, labels });
          const tableId = spend.then?.table;
          const next = tableId === undefined ? undefined : ruleset.tables?.[tableId];
          const openNext = next && tableId !== undefined && onTable && (
            <button
              className="btn sm"
              aria-label={t("openTableAria", { title: next.title, name: actor.name })}
              onClick={() => onTable(tableId)}
            >
              {t("openTable", { title: next.title })}
            </button>
          );
          if (usedUp(offer))
            return (
              <span key={spend.id} className="row spend-one">
                <button className="btn sm" disabled>
                  {t("usedThisRound", { label: spend.label })}
                </button>
                {openNext}
              </span>
            );
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
              {openNext}
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
