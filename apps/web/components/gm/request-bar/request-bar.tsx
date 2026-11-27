"use client";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type FormEvent } from "react";

import type { LiveState, SpendRequest } from "@inconsistable/core-schema";
import { compileRuleset, type Ruleset } from "@inconsistable/rules-engine";

import type { Send } from "@/hooks/use-table/use-table";
import { changeFields, itemChange } from "@/lib/acquire-change/acquire-change";
import { REQUEST_NOTE_MAX } from "@/lib/spend-request/spend-request";
import { costText, inputsText, offersOf, spendOf } from "@/lib/spends/spends";

type RequestBarProps = {
  state: LiveState;
  /** The resource labels of the pinned ruleset; an id stands in when it is not loaded. */
  labels: ReadonlyMap<string, string>;
  /** The pinned ruleset, for a spend-ask's label and cost (house decision #84). */
  ruleset: Ruleset | null;
  send: Send;
};

// A compact bar under the GM's tabs while players are waiting on a spend: who asks for what, Approve or Deny (a reason
// is optional). Approving spends through the normal delta path, so Undo takes it back.
export function RequestBar({ state, labels, ruleset, send }: RequestBarProps) {
  const t = useTranslations("spendRequest");
  const id = useId();
  const [denying, setDenying] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // CHANGE on an acquisition (house decision #196): which ask is open, and what the GM typed for it.
  const [changing, setChanging] = useState<string | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);
  const compiled = useMemo(() => {
    const c = ruleset === null ? null : compileRuleset(ruleset);
    return c?.ok ? c.compiled : null;
  }, [ruleset]);
  if (state.requests.length === 0) return null;

  // The name of an item a character holds, for what an acquired fitting goes on.
  const itemName = (actorId: string | null, itemId: string | undefined) =>
    itemId === undefined
      ? undefined
      : state.actors.find((a) => a.id === actorId)?.items?.find((x) => x.id === itemId)?.name;

  // A spend-ask in the ruleset's words: its label, its inputs and what it would cost now.
  const spendText = (q: SpendRequest): string => {
    const spend = spendOf(ruleset, q);
    const actor = state.actors.find((a) => a.id === q.actorId);
    const inputs = q.inputs ?? {};
    const plan =
      ruleset && actor && spend
        ? offersOf({
            ruleset,
            compiled,
            table: state,
            actor,
            characters: state.actors.filter((a) => a.kind === "pc").length,
            inputs: { [spend.id]: inputs },
          }).find((o) => o.spend.id === spend.id)?.plan
        : null;
    const cost = plan ? costText({ costs: plan.costs, labels }) : "";
    return [spend?.label ?? q.spendId ?? "", inputsText({ spend, inputs }), cost].filter((x) => x !== "").join(" · ");
  };

  // APPROVE: spends the amount; a refusal (the resource is gone, the character deleted) stays on the bar.
  const handleApprove = async (requestId: string) => {
    const r = await send({ type: "request.approve", id: requestId });
    setError(r.ok ? null : r.error);
  };
  // APPROVE WITH CHANGES: the acquisition's Test reads the entry with what the GM typed, for this call only.
  const handleApproveChanged = async (e: FormEvent, q: SpendRequest) => {
    e.preventDefault();
    const fields = ruleset && q.acquire ? changeFields({ ruleset, type: q.acquire.type }) : [];
    const item = itemChange({ fields, typed, tags });
    const r = await send({ type: "request.approve", id: q.id, ...(item ? { item } : {}) });
    setError(r.ok ? null : r.error);
    if (!r.ok) return;
    setChanging(null);
    setTyped({});
    setTags("");
  };
  // CHANGE: opens the change form for one ask, or closes it, starting blank.
  const handleChanging = (requestId: string) => {
    setChanging(changing === requestId ? null : requestId);
    setTyped({});
    setTags("");
  };
  // DENY: answers with the reason, if any, then closes the reason field.
  const handleDeny = async (e: FormEvent, requestId: string) => {
    e.preventDefault();
    const r = await send({ type: "request.deny", id: requestId, reason: reason.trim() || undefined });
    setError(r.ok ? null : r.error);
    if (!r.ok) return;
    setDenying(null);
    setReason("");
  };

  return (
    <section className="request-bar stack" aria-label={t("barTitle")}>
      {state.requests.map((q) => {
        const name = state.actors.find((a) => a.id === q.actorId)?.name ?? "";
        const spent = q.spendId !== null || q.acquire !== undefined;
        const label = q.acquire
          ? q.acquire.name
          : q.spendId !== null
            ? spendText(q)
            : (labels.get(q.resourceId ?? "") ?? q.resourceId ?? "");
        const values = { name, amount: q.amount ?? 0, label };
        // An acquisition (house decision #102): the entry, and what a fitting goes on.
        const host = q.acquire?.line?.split("/").slice(1).join("/") ?? itemName(q.actorId, q.acquire?.to);
        const asks = q.acquire
          ? host
            ? t("acquireOn", { name, item: q.acquire.name, host })
            : t("acquires", { name, item: q.acquire.name })
          : spent
            ? t("othersAsk", values)
            : t("asks", values);
        return (
          <div key={q.id} className="request-item stack">
            <div className="row request-line">
              <span className="request-text">
                <strong>{asks}</strong>
                {q.note && <span className="dim"> {q.note}</span>}
              </span>
              <span className="row">
                <button
                  className="btn sm primary"
                  aria-label={spent ? t("spendApproveAria", values) : t("approveAria", values)}
                  onClick={() => handleApprove(q.id)}
                >
                  {t("approve")}
                </button>
                {q.acquire && ruleset && (
                  <button
                    className="btn sm"
                    aria-label={t("changeAria", { name, item: q.acquire.name })}
                    aria-expanded={changing === q.id}
                    onClick={() => handleChanging(q.id)}
                  >
                    {t("change")}
                  </button>
                )}
                <button
                  className="btn sm"
                  aria-label={spent ? t("spendDenyAria", values) : t("denyAria", values)}
                  aria-expanded={denying === q.id}
                  onClick={() => setDenying(denying === q.id ? null : q.id)}
                >
                  {t("deny")}
                </button>
              </span>
            </div>
            {changing === q.id && q.acquire && ruleset && (
              <form className="stack" onSubmit={(e) => handleApproveChanged(e, q)}>
                <p className="small dim">{t("changeHint")}</p>
                {changeFields({ ruleset, type: q.acquire.type }).map((f) => (
                  <label key={f.id} className="row">
                    <span>{f.label}</span>
                    {f.options ? (
                      <select
                        value={typed[f.id] ?? ""}
                        onChange={(e) => setTyped({ ...typed, [f.id]: e.target.value })}
                      >
                        <option value="">{t("changeKeep")}</option>
                        {f.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        inputMode="numeric"
                        size={5}
                        value={typed[f.id] ?? ""}
                        placeholder={t("changeKeep")}
                        onChange={(e) => setTyped({ ...typed, [f.id]: e.target.value })}
                      />
                    )}
                  </label>
                ))}
                <label className="row">
                  <span>{t("changeTags")}</span>
                  <input value={tags} placeholder={t("changeKeep")} onChange={(e) => setTags(e.target.value)} />
                </label>
                <button className="btn sm primary" type="submit">
                  {t("approveChanged")}
                </button>
              </form>
            )}
            {denying === q.id && (
              <form className="row" onSubmit={(e) => handleDeny(e, q.id)}>
                <label htmlFor={`${id}-${q.id}`}>{t("reason")}</label>
                <input
                  id={`${id}-${q.id}`}
                  value={reason}
                  maxLength={REQUEST_NOTE_MAX}
                  onChange={(e) => setReason(e.target.value)}
                />
                <button className="btn sm" type="submit">
                  {t("denySend")}
                </button>
              </form>
            )}
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
