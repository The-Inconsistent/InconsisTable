"use client";
import { useTranslations } from "next-intl";
import { useId, useState, type FormEvent } from "react";

import type { SpendRequest } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";
import { clampAmount, REQUEST_AMOUNT, REQUEST_NOTE_MAX } from "@/lib/spend-request/spend-request";

type SpendAskProps = {
  actorId: string;
  resourceId: string;
  label: string;
  /** This seat's pending requests for this character's resource. */
  pending: readonly SpendRequest[];
  send: Send;
};

// Under a resource a player cannot change: ask the GM to spend some, see what is waiting and take it back. The server
// decides whether it is allowed; the answer arrives as a notice (RequestNotices).
export function SpendAsk({ actorId, resourceId, label, pending, send }: SpendAskProps) {
  const t = useTranslations("spendRequest");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number>(REQUEST_AMOUNT.min);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SEND: the request goes to the GM; the form closes only when the server took it.
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await send({ type: "request.send", actorId, resourceId, amount, note: note.trim() || undefined });
    setBusy(false);
    setError(r.ok ? null : r.error);
    if (!r.ok) return;
    setOpen(false);
    setAmount(REQUEST_AMOUNT.min);
    setNote("");
  };
  // CANCEL: takes one waiting request back.
  const handleCancel = async (requestId: string) => {
    const r = await send({ type: "request.cancel", id: requestId });
    setError(r.ok ? null : r.error);
  };

  return (
    <div className="spend-ask stack" data-for={resourceId}>
      {pending.map((q) => (
        <div key={q.id} className="spend-waiting row" role="status">
          <span>{t("waiting", { amount: q.amount ?? 0, label })}</span>
          <button
            className="btn sm"
            aria-label={t("cancelAria", { amount: q.amount ?? 0, label })}
            onClick={() => handleCancel(q.id)}
          >
            {t("cancel")}
          </button>
        </div>
      ))}
      {open ? (
        <form className="stack spend-form" onSubmit={handleSubmit}>
          <div className="row" role="group" aria-label={t("amount", { label })}>
            <button
              type="button"
              className="btn step"
              aria-label={t("less", { label })}
              disabled={amount <= REQUEST_AMOUNT.min}
              onClick={() => setAmount(clampAmount(amount - 1))}
            >
              −
            </button>
            <strong className="sheet-num" aria-live="polite">
              {amount}
            </strong>
            <button
              type="button"
              className="btn step"
              aria-label={t("more", { label })}
              disabled={amount >= REQUEST_AMOUNT.max}
              onClick={() => setAmount(clampAmount(amount + 1))}
            >
              +
            </button>
          </div>
          <label htmlFor={`${id}-note`}>{t("note")}</label>
          <input
            id={`${id}-note`}
            value={note}
            maxLength={REQUEST_NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="row">
            <button className="btn primary" type="submit" aria-busy={busy} disabled={busy}>
              {t("send")}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              {t("close")}
            </button>
          </div>
        </form>
      ) : (
        <button className="btn sm" aria-label={t("askAria", { label })} onClick={() => setOpen(true)}>
          {t("ask")}
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
