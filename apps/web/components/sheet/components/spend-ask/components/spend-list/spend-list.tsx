"use client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import type { Actor, LiveState, SpendRequest } from "@inconsistable/core-schema";
import type { CompiledRuleset, Ruleset } from "@inconsistable/rules-engine";

import type { Send } from "@/hooks/use-table/use-table";
import {
  askedFor,
  costText,
  defaultInputs,
  inputMax,
  inputsText,
  offersOf,
  shown,
  spendOf,
  spendWorld,
  usedUp,
} from "@/lib/spends/spends";

import { QUICK_INPUTS } from "./constants";

type SpendListProps = {
  ruleset: Ruleset;
  /** For resource bounds only; null before the manifest compiles (a seat's always does: house decision #101). */
  compiled: CompiledRuleset | null;
  actor: Actor;
  table: Pick<LiveState, "pools" | "encounter" | "campaign">;
  characters: number;
  /** Resource and pool labels by id, for the costs. */
  labels: ReadonlyMap<string, string>;
  /** This seat's pending requests. */
  requests: readonly SpendRequest[];
  send: Send;
  /**
   * Inside a panel (house decision #114): only its spends, without a heading; a spend with one small input asks in one
   * tap per number, and `onSent` follows an ask that went through.
   */
  panel?: { spends: readonly string[]; onSent?: () => void };
};

// SPENDS (house decision #84): what this character may ask the GM to spend now, each with its cost and the numbers it
// takes; an ask waits here with a cancel until the GM answers. Only the spends the server would take now are listed.
export function SpendList({
  ruleset,
  compiled,
  actor,
  table,
  characters,
  labels,
  requests,
  send,
  panel,
}: SpendListProps) {
  const t = useTranslations("spendRequest");
  const id = useId();
  const [picked, setPicked] = useState<Record<string, Record<string, number>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = (spendId: string | null) => panel === undefined || (spendId !== null && panel.spends.includes(spendId));
  const listed = offersOf({ ruleset, compiled, table, actor, characters })
    .filter(shown)
    .filter((o) => mine(o.spend.id));
  const chosen = offersOf({ ruleset, compiled, table, actor, characters, inputs: picked });
  const waiting = askedFor({ requests, actorId: actor.id }).filter((q) => mine(q.spendId));
  const world = spendWorld({ ruleset, compiled, table, actor, characters });
  if (listed.length === 0 && waiting.length === 0) return null;

  // ASK: sends the spend with the numbers picked; the server checks it again.
  const handleAsk = async (spendId: string, inputs: Record<string, number>) => {
    setBusy(true);
    const r = await send({ type: "request.send", actorId: actor.id, spendId, inputs });
    setBusy(false);
    setError(r.ok ? null : r.error);
    if (r.ok) panel?.onSent?.();
  };
  // CANCEL: takes one waiting ask back.
  const handleCancel = async (requestId: string) => {
    const r = await send({ type: "request.cancel", id: requestId });
    setError(r.ok ? null : r.error);
  };
  // INPUT: keeps the number picked for one input of one spend.
  const handleInput = (spendId: string, name: string, value: string) =>
    setPicked((p) => ({ ...p, [spendId]: { ...p[spendId], [name]: Number(value) } }));

  const body = (
    <>
      {waiting.map((q) => {
        const label =
          `${spendOf(ruleset, q)?.label ?? q.spendId ?? ""} ${inputsText({ spend: spendOf(ruleset, q), inputs: q.inputs ?? {} })}`.trim();
        return (
          <div key={q.id} className="spend-waiting row" role="status">
            <span>{t("spendWaiting", { label })}</span>
            <button className="btn sm" aria-label={t("spendCancelAria", { label })} onClick={() => handleCancel(q.id)}>
              {t("cancel")}
            </button>
          </div>
        );
      })}
      {listed.map((offer) => {
        const { spend } = offer;
        // A spend used up this round stays, disabled, with the reason (house decision #91).
        if (usedUp(offer))
          return (
            <div key={spend.id} className="stack spend-offer">
              <button className="btn sm" disabled>
                {t("usedThisRound", { label: spend.label })}
              </button>
            </div>
          );
        const inputs = { ...defaultInputs(spend), ...picked[spend.id] };
        const plan = chosen.find((o) => o.spend.id === spend.id)?.plan ?? null;
        const cost = plan === null ? "" : costText({ costs: plan.costs, labels });
        const asked = waiting.some((q) => q.spendId === spend.id);
        const defs = Object.entries(spend.inputs ?? {});
        const [only] = defs;
        const max = only === undefined ? null : inputMax({ world, source: only[1].max });
        // In a panel, one small input is a row of numbers, each its own ask (the YOU'RE HIT sheet's I ROLLED n).
        if (
          panel !== undefined &&
          defs.length === 1 &&
          only !== undefined &&
          max !== null &&
          max - only[1].min < QUICK_INPUTS
        ) {
          const [name, def] = only;
          return (
            <div key={spend.id} className="stack spend-offer">
              <span className="row spend-head">
                <strong>{spend.label}</strong>
                <span className="dim">{cost || t("free")}</span>
              </span>
              <span className="small">{def.label}</span>
              <div
                className="row spend-quick"
                role="group"
                aria-label={t("inputAria", { input: def.label, label: spend.label })}
              >
                {Array.from({ length: max - def.min + 1 }, (_, i) => def.min + i).map((v) => (
                  <button
                    key={v}
                    className="btn"
                    aria-label={t("quickAria", { label: spend.label, input: def.label, value: v })}
                    disabled={busy || asked}
                    onClick={() => handleAsk(spend.id, { [name]: v })}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          );
        }
        return (
          <div key={spend.id} className="stack spend-offer">
            <span className="row spend-head">
              <strong>{spend.label}</strong>
              <span className="dim">{cost || t("free")}</span>
            </span>
            {defs.map(([name, def]) => (
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
    </>
  );
  if (panel !== undefined) return <div className="stack spend-list">{body}</div>;
  return (
    <section className="stack sheet-card spend-list" aria-label={t("spends")}>
      <h2 className="head">{t("spends")}</h2>
      {body}
    </section>
  );
}
