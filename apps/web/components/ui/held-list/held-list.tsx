"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { Actor } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import type { Send } from "@/hooks/use-table/use-table";
import { heldLists, withItem, withoutItem, type HeldList } from "@/lib/held/held";
import { RulesReply } from "@/lib/library/library";

type HeldListProps = {
  ruleset: Ruleset;
  actor: Actor;
  campaignId: string;
  /** A GM-side seat changes every list; the holder's own seat those the ruleset lets its owner change. */
  gm: boolean;
  send: Send;
};

const PICKS = 50;

// HOLDING (house decision #91): each list the ruleset shows as chips, what the actor holds in it, ended one by one or
// all at once, added by name or from quick picks (pack entries of the declared type, read when asked for). Every change
// is field.set with the whole list, so the server checks who may change it and Undo takes it back.
export function HeldListEditor({ ruleset, actor, campaignId, gm, send }: HeldListProps) {
  const t = useTranslations("heldList");
  const [text, setText] = useState<Record<string, string>>({});
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const lists = heldLists({ ruleset, actor });
  if (lists.length === 0) return null;

  // SET: sends one list whole; a refusal shows under the lists.
  const handleSet = async (list: HeldList, value: string[]) => {
    const r = await send({ type: "field.set", actorId: actor.id, field: list.field, value });
    setError(r.ok ? null : r.error);
    return r.ok;
  };
  // ADD: the typed name, when it is new.
  const handleAdd = (list: HeldList) => async (e: FormEvent) => {
    e.preventDefault();
    const next = withItem({ list, item: text[list.field] ?? "" });
    if (next !== null && (await handleSet(list, next))) setText((x) => ({ ...x, [list.field]: "" }));
  };
  // QUICK PICKS: reads the names of the attached packs' entries of the list's type, once per list.
  const handlePicks = async (list: HeldList) => {
    if (list.picks === null) return;
    try {
      const path = `/api/campaigns/${encodeURIComponent(campaignId)}/rules?type=${encodeURIComponent(list.picks)}&limit=${PICKS}`;
      const res = await fetch(path);
      const parsed = RulesReply.safeParse(await res.json());
      if (!res.ok || !parsed.success) throw new Error(t("readFailed"));
      setPicks((x) => ({ ...x, [list.field]: [...new Set(parsed.data.entries.map((en) => en.name))] }));
      setError(null);
    } catch {
      setError(t("readFailed"));
    }
  };

  return (
    <div className="stack held-list">
      {lists.map((list) => {
        const name = actor.name;
        const offered = (picks[list.field] ?? []).filter((p) => !list.items.includes(p));
        if (!gm && !list.owner) return null;
        return (
          <div key={list.field} className="stack" role="group" aria-label={t("listFor", { label: list.label, name })}>
            <strong>{list.label}</strong>
            {list.items.length === 0 ? (
              <span className="dim">{t("none")}</span>
            ) : (
              <span className="row">
                {list.items.map((item) => (
                  <span key={item} className="chip held-chip" data-held={list.field}>
                    {item}
                    <button
                      className="btn sm"
                      aria-label={t("endAria", { item, name })}
                      onClick={() => handleSet(list, withoutItem({ list, item }))}
                    >
                      {t("end")}
                    </button>
                  </span>
                ))}
                <button
                  className="btn sm"
                  aria-label={t("endAllAria", { label: list.label, name })}
                  onClick={() => handleSet(list, [])}
                >
                  {t("endAll")}
                </button>
              </span>
            )}
            <form className="row" onSubmit={handleAdd(list)}>
              <input
                aria-label={t("item", { name })}
                value={text[list.field] ?? ""}
                maxLength={120}
                onChange={(e) => setText((x) => ({ ...x, [list.field]: e.target.value }))}
              />
              <button className="btn sm" type="submit" aria-label={t("addAria", { label: list.label, name })}>
                {t("add")}
              </button>
              {list.picks !== null && picks[list.field] === undefined && (
                <button className="btn sm" type="button" onClick={() => handlePicks(list)}>
                  {t("picks")}
                </button>
              )}
            </form>
            {picks[list.field] !== undefined &&
              (offered.length === 0 ? (
                <span className="dim">{t("noPicks")}</span>
              ) : (
                <span className="row">
                  {offered.map((item) => (
                    <button
                      key={item}
                      className="btn sm"
                      aria-label={t("pickAria", { item, label: list.label, name })}
                      onClick={() => handleSet(list, withItem({ list, item }) ?? list.items)}
                    >
                      {item}
                    </button>
                  ))}
                </span>
              ))}
          </div>
        );
      })}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
