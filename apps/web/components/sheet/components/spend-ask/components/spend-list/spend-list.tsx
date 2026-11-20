"use client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import type { Actor, LiveState, SpendRequest } from "@inconsistable/core-schema";
import type { CompiledRuleset } from "@inconsistable/rules-engine";

import type { Send } from "@/hooks/use-table/use-table";
import {
  askedFor,
  costText,
  defaultInputs,
  inputMax,
  inputsText,
  offersOf,
  spendOf,
  spendWorld,
} from "@/lib/spends/spends";

type SpendListProps = {
  compiled: CompiledRuleset;
  actor: Actor;
  table: Pick<LiveState, "pools" | "encounter" | "campaign">;
  characters: number;
  /** Resource and pool labels by id, for the costs. */
  labels: ReadonlyMap<string, string>;
  /** This seat's pending requests. */
  requests: readonly SpendRequest[];
  send: Send;
};

// SPENDS (house decision #84): what this character may ask the GM to spend now, each with its cost and the numbers it
// takes; an ask waits here with a cancel until the GM answers. Only the spends the server would take now are listed.
export function SpendList({ compiled, actor, table, characters, labels, requests, send }: SpendListProps) {
  const t = useTranslations("spendRequest");
  const id = useId();
  const [picked, setPicked] = useState<Record<string, Record<string, number>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listed = offersOf({ compiled, table, actor, characters }).filter((o) => o.plan !== null);
  const chosen = offersOf({ compiled, table, actor, characters, inputs: picked });
  const waiting = askedFor({ requests, actorId: actor.id });
  const world = spendWorld({ compiled, table, actor, characters });
  if (listed.length === 0 && waiting.length === 0) return null;

  // ASK: sends the spend with the numbers picked; the server checks it again.
  const handleAsk = async (spendId: string, inputs: Record<string, number>) => {
    setBusy(true);
    const r = await send({ type: "request.send", actorId: actor.id, spendId, inputs });
    setBusy(false);
    setError(r.ok ? null : r.error);
  };
  // CANCEL: takes one waiting ask back.
  const handleCancel = async (requestId: string) => {
    const r = await send({ type: "request.cancel", id: requestId });
    setError(r.ok ? null : r.error);
  };
  // INPUT: keeps the number picked for one input of one spend.
  const handleInput = (spendId: string, name: string, value: string) =>
    setPicked((p) => ({ ...p, [spendId]: { ...p[spendId], [name]: Number(value) } }));

  return (
    <section className="stack sheet-card spend-list" aria-label={t("spends")}>
      <h2 className="head">{t("spends")}</h2>
      {waiting.map((q) => {
        const label =
          `${spendOf(compiled, q)?.label ?? q.spendId ?? ""} ${inputsText({ spend: spendOf(compiled, q), inputs: q.inputs ?? {} })}`.trim();
        return (
          <div key={q.id} className="spend-waiting row" role="status">
            <span>{t("spendWaiting", { label })}</span>
            <button className="btn sm" aria-label={t("spendCancelAria", { label })} onClick={() => handleCancel(q.id)}>
              {t("cancel")}
            </button>
          </div>
        );
      })}
      {listed.map(({ spend }) => {
        const inputs = { ...defaultInputs(spend), ...picked[spend.id] };
        const plan = chosen.find((o) => o.spend.id === spend.id)?.plan ?? null;
        const cost = plan === null ? "" : costText({ costs: plan.costs, labels });
        const asked = waiting.some((q) => q.spendId === spend.id);
        return (
          <div key={spend.id} className="stack spend-offer">
            <span className="row spend-head">
              <strong>{spend.label}</strong>
              <span className="dim">{cost || t("free")}</span>
            </span>
            {Object.entries(spend.inputs ?? {}).map(([name, def]) => (
              <span key={name} className="row">
                <label htmlFor={`${id}-${spend.id}-${name}`}>{def.label}</label>
                <input
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
              </span>
            ))}
            <button
              className="btn sm primary"
              aria-label={t("spendAskAria", { label: spend.label })}
              disabled={busy || asked || plan === null}
              onClick={() => handleAsk(spend.id, inputs)}
            >
              {t("spendAsk", { label: spend.label })}
            </button>
          </div>
        );
      })}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
