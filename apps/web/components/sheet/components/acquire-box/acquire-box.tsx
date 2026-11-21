"use client";
import { useTranslations } from "next-intl";
import { useId, useState, type ChangeEvent } from "react";

import type { Actor, LiveState, SpendRequest } from "@inconsistable/core-schema";
import type { CompiledRuleset, Ruleset } from "@inconsistable/rules-engine";

import { RefPicker } from "@/components/gm/codex/components/entry-fields-form/components/ref-picker/ref-picker";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import type { Send } from "@/hooks/use-table/use-table";
import { acquireKinds, previewAcquire, startPicks, waitingAcquire } from "@/lib/acquire/acquire";
import { hostsOf, lineHostsOf } from "@/lib/items/items";
import type { RulesEntry } from "@/lib/library/library";

type AcquireBoxProps = {
  ruleset: Ruleset;
  compiled: CompiledRuleset | null;
  actor: Actor;
  table: Pick<LiveState, "pools" | "encounter" | "campaign">;
  characters: number;
  /** This seat's pending requests. */
  requests: readonly SpendRequest[];
  send: Send;
};

// ACQUIRE (house decision #102): the holder picks an item from the room's packs, sees the number its Test is called at
// and the parts it adds up from, picks what the ruleset lets them, names what a fitting goes on, and asks the GM, who
// calls the Test or refuses. One ask waits at a time, with a cancel.
export function AcquireBox({ ruleset, compiled, actor, table, characters, requests, send }: AcquireBoxProps) {
  const t = useTranslations("sheet.acquire");
  const ti = useTranslations("sheet.items");
  const tr = useRefusal();
  const id = useId();
  const kinds = acquireKinds({ ruleset, actor });
  const [open, setOpen] = useState(false);
  const [kindId, setKindId] = useState(kinds[0]?.id ?? "");
  const [entry, setEntry] = useState<RulesEntry | null>(null);
  const [picks, setPicks] = useState<Record<string, number>>(() => startPicks(ruleset));
  const [host, setHost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const acquire = ruleset.items?.acquire;
  const waiting = waitingAcquire({ requests, actorId: actor.id });
  if (acquire === undefined || kinds.length === 0) return null;
  const kind = kinds.find((k) => k.id === kindId) ?? kinds[0];
  const test = ruleset.tests[acquire.test];
  const plan = entry && previewAcquire({ ruleset, compiled, table, actor, characters, entry, picks });
  const refused =
    plan && "code" in plan ? tr({ code: plan.code, message: plan.message, params: refusalParams(plan) }) : null;
  const ready = plan && !("code" in plan) ? plan : null;
  const fitting = ready && kind?.fits !== undefined && entry !== null;
  const items = actor.items ?? [];
  const asItem = entry && { kind: ready?.kind ?? kindId, tags: entry.tags };
  const itemHosts =
    fitting && asItem ? hostsOf({ ruleset, items, item: { ...asItem, id: "" } as never, gm: false }) : [];
  const lineHosts = fitting && asItem ? lineHostsOf({ ruleset, actor, item: asItem, gm: false }) : [];

  function refusalParams(r: { message: string }) {
    return { name: actor.name, entry: entry?.name ?? "", kind: "", detail: r.message };
  }
  // KIND: another kind of item; the picked entry goes with it.
  const handleKind = (e: ChangeEvent<HTMLSelectElement>) => {
    setKindId(e.target.value);
    setEntry(null);
    setHost("");
  };
  // A pick's number, a whole one; the preview says when it is out of range.
  const handlePick = (pick: string) => (e: ChangeEvent<HTMLInputElement>) =>
    setPicks((p) => ({ ...p, [pick]: Math.trunc(Number(e.target.value)) || 0 }));
  // ASK: the entry, the picks and the host go to the GM; the server checks them again.
  const handleAsk = async () => {
    if (entry === null) return;
    const on = host.startsWith("line:") ? { line: host.slice(5) } : host !== "" ? { to: host } : {};
    const r = await send({
      type: "request.send",
      actorId: actor.id,
      acquire: { type: entry.type, entry: entry.key, ...on },
      inputs: picks,
    });
    setError(r.ok ? null : r.error);
    if (r.ok) {
      setOpen(false);
      setEntry(null);
      setHost("");
    }
  };
  // CANCEL: takes the waiting ask back.
  const handleCancel = async (requestId: string) => {
    const r = await send({ type: "request.cancel", id: requestId });
    setError(r.ok ? null : r.error);
  };

  return (
    <section className="stack sheet-card acquire-box" aria-label={t("title")}>
      <h2 className="head">{t("title")}</h2>
      {waiting ? (
        <p className="row acquire-waiting">
          <span>{t("asking", { name: waiting.acquire?.name ?? "" })}</span>
          <button className="btn sm" onClick={() => handleCancel(waiting.id)}>
            {t("cancel")}
          </button>
        </p>
      ) : !open ? (
        <button className="btn" onClick={() => setOpen(true)} aria-expanded={false}>
          {t("open")}
        </button>
      ) : (
        <div className="stack acquire-form">
          {kinds.length > 1 && (
            <label className="stack small">
              {t("kind")}
              <select className="input" value={kind?.id ?? ""} onChange={handleKind}>
                {kinds.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind && (
            <RefPicker
              id={`${id}-entry`}
              label={t("pick")}
              campaignId={table.campaign.id}
              entity={kind.entry}
              value={entry?.key ?? null}
              name={entry?.name ?? null}
              disabled={false}
              onPick={setEntry}
              onOpen={() => undefined}
            />
          )}
          {Object.entries(acquire.picks ?? {}).map(([pick, p]) => (
            <label key={pick} className="stack small">
              {p.label}
              <input
                className="input"
                type="number"
                inputMode="numeric"
                min={p.min}
                value={picks[pick] ?? 0}
                onChange={handlePick(pick)}
              />
            </label>
          ))}
          {refused && <p className="small dim">{refused}</p>}
          {ready && (
            <dl className="stack acquire-parts">
              {Object.entries(ready.inputs).map(([input, v]) => (
                <div key={input} className="stack" style={{ gap: 2 }}>
                  <dt>
                    <b>{t("total", { label: test?.inputLabels?.[input] ?? input, total: v.total })}</b>
                  </dt>
                  {v.parts.map((part, i) => (
                    <dd key={i} className="small dim">
                      {t("part", { label: part.label, value: part.value })}
                    </dd>
                  ))}
                </div>
              ))}
            </dl>
          )}
          {itemHosts.length + lineHosts.length > 0 && (
            <label className="stack small">
              {t("host")}
              <select className="input" value={host} onChange={(e) => setHost(e.target.value)}>
                <option value="">{t("loose")}</option>
                {itemHosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
                {lineHosts.map((l) => (
                  <option key={l.ref} value={`line:${l.ref}`}>
                    {ti("buildLine", { name: l.name })}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="row">
            <button className="btn primary" onClick={handleAsk} disabled={ready === null}>
              {t("ask")}
            </button>
            <button className="btn" onClick={() => setOpen(false)}>
              {t("close")}
            </button>
          </span>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
