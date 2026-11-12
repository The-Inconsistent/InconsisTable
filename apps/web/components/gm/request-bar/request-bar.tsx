"use client";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import type { LiveState } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";
import { REQUEST_NOTE_MAX } from "@/lib/spend-request/spend-request";

type RequestBarProps = {
  state: LiveState;
  /** The resource labels of the pinned ruleset; an id stands in when it is not loaded. */
  labels: ReadonlyMap<string, string>;
  send: Send;
};

// A compact bar under the GM's tabs while players are waiting on a spend: who asks for what, Approve or Deny (a reason
// is optional). Approving spends through the normal delta path, so Undo takes it back.
export function RequestBar({ state, labels, send }: RequestBarProps) {
  const t = useTranslations("spendRequest");
  const id = useId();
  const [denying, setDenying] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (state.requests.length === 0) return null;

  // APPROVE: spends the amount; a refusal (the resource is gone, the character deleted) stays on the bar.
  const handleApprove = async (requestId: string) => {
    const r = await send({ type: "request.approve", id: requestId });
    setError(r.ok ? null : r.error);
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
        const label = labels.get(q.resourceId) ?? q.resourceId;
        return (
          <div key={q.id} className="request-item stack">
            <div className="row request-line">
              <span className="request-text">
                <strong>{t("asks", { name, amount: q.amount, label })}</strong>
                {q.note && <span className="dim"> {q.note}</span>}
              </span>
              <span className="row">
                <button
                  className="btn sm primary"
                  aria-label={t("approveAria", { name, amount: q.amount, label })}
                  onClick={() => handleApprove(q.id)}
                >
                  {t("approve")}
                </button>
                <button
                  className="btn sm"
                  aria-label={t("denyAria", { name, amount: q.amount, label })}
                  aria-expanded={denying === q.id}
                  onClick={() => setDenying(denying === q.id ? null : q.id)}
                >
                  {t("deny")}
                </button>
              </span>
            </div>
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
