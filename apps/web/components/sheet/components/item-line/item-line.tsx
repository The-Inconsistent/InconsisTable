"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type FormEvent } from "react";

import type { ActionInput, ActorItem } from "@inconsistable/core-schema";

import type { WidgetEnv } from "@/components/sheet/widgets/types";
import { Cite } from "@/components/ui/cite/cite";
import { hostsOf, type ItemLine as Line } from "@/lib/items/items";

type ItemLineProps = { line: Line; env: WidgetEnv };

// One item a character holds (house decision #95): its name, a counted kind's quantity, what is fitted to it, the GM's
// note and its page. The holder spends a counted one and fits or takes off what it may; the GM side also tops up,
// takes back a given item and edits or removes the line (EDIT CARRIED), which the server refuses when it changed since.
export function ItemLine({ line, env }: ItemLineProps) {
  const t = useTranslations("sheet.items");
  const { item, kind, fitted } = line;
  const items = env.actor.items ?? [];
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [note, setNote] = useState(item.note);
  const counted = item.quantity !== null;
  const spends = env.gm || kind?.spend === true;

  const run = async (action: ActionInput) => {
    const result = await env.send(action);
    env.onError(result.ok ? null : result.error);
    return result.ok;
  };
  const handleAdjust = (by: number) => () => run({ type: "item.adjust", itemId: item.id, by });
  // A fitted item comes off; a loose one goes on the host picked.
  const handleFit = (x: ActorItem, to: string | null) => run({ type: "item.fit", itemId: x.id, to });
  const handlePickHost = async (e: ChangeEvent<HTMLSelectElement>) => {
    const to = e.target.value;
    e.target.value = "";
    if (to !== "") await handleFit(item, to);
  };
  const handleTakeBack = () => item.entryId !== null && run({ type: "item.take", entryId: item.entryId });
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run({
      type: "item.edit",
      itemId: item.id,
      rev: item.rev,
      note,
      ...(item.entry === null && name.trim() !== "" && { name }),
      remove: false,
    });
    if (ok) setEditing(false);
  };
  const handleRemove = () => run({ type: "item.edit", itemId: item.id, rev: item.rev, remove: true });
  const handleEdit = () => {
    setName(item.name);
    setNote(item.note);
    setEditing((open) => !open);
  };

  const hosts = item.fittedTo === null ? hostsOf({ ruleset: env.ruleset, items, item, gm: env.gm }) : [];
  return (
    <li className="w-kit item-line" data-item={item.kind}>
      <span className="stack" style={{ gap: 2 }}>
        <b>{counted ? t("count", { name: item.name, count: item.quantity ?? 0 }) : item.name}</b>
        {fitted.map((x) => (
          <span key={x.id} className="row small item-fitted">
            <span>{t("fitted", { name: x.name })}</span>
            <button
              className="btn sm"
              onClick={() => handleFit(x, null)}
              aria-label={t("takeOffLabel", { name: x.name, host: item.name })}
            >
              {t("takeOff")}
            </button>
          </span>
        ))}
        {item.note && <span className="small dim">{item.note}</span>}
        {item.cite && <Cite cite={item.cite} ruleset={env.ruleset} books={env.books} requestPage={env.requestPage} />}
      </span>
      <span className="row item-actions">
        {counted && spends && (
          <button className="btn sm" onClick={handleAdjust(-1)} aria-label={t("spendLabel", { name: item.name })}>
            −
          </button>
        )}
        {counted && env.gm && (
          <button className="btn sm" onClick={handleAdjust(1)} aria-label={t("addOneLabel", { name: item.name })}>
            +
          </button>
        )}
        {hosts.length > 0 && (
          <select
            className="input sm"
            defaultValue=""
            onChange={handlePickHost}
            aria-label={t("fitLabel", { name: item.name })}
          >
            <option value="">{t("fitTo")}</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        )}
        {env.gm && item.entryId !== null && (
          <button className="btn sm" onClick={handleTakeBack} aria-label={t("takeBackLabel", { name: item.name })}>
            {t("takeBack")}
          </button>
        )}
        {env.gm && (
          <button
            className="btn sm"
            onClick={handleEdit}
            aria-expanded={editing}
            aria-label={t("editLabel", { name: item.name })}
          >
            {t("edit")}
          </button>
        )}
      </span>
      {editing && (
        <form className="stack item-edit" onSubmit={handleSave}>
          {item.entry === null && (
            <label className="stack small">
              {t("name")}
              <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label className="stack small">
            {t("note")}
            <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </label>
          <span className="row">
            <button className="btn sm" type="submit">
              {t("save")}
            </button>
            <button className="btn sm" type="button" onClick={handleRemove}>
              {t("remove")}
            </button>
          </span>
        </form>
      )}
    </li>
  );
}
