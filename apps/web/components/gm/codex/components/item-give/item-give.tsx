"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ActionInput, Actor, CodexEntry } from "@inconsistable/core-schema";

type ItemGiveProps = {
  entry: CodexEntry;
  characters: readonly Actor[];
  act: (a: ActionInput) => Promise<{ ok: boolean }>;
};

// GIVE and TAKE BACK on a codex item (house decision #95): who holds it now (the character whose items name it), a
// picker of characters to give it to with no Test, and TAKE BACK. The server refuses what the ruleset does not allow
// (given already, counted, a second of one, a full list) and the editor shows its words.
export function ItemGive({ entry, characters, act }: ItemGiveProps) {
  const t = useTranslations("codex.give");
  const [to, setTo] = useState("");
  const holder = characters.find((a) => a.items?.some((x) => x.entryId === entry.id));

  const handleGive = async () => {
    if (to === "") return;
    const r = await act({ type: "item.give", entryId: entry.id, actorId: to });
    if (r.ok) setTo("");
  };
  const handleTakeBack = () => act({ type: "item.take", entryId: entry.id });

  return (
    <section className="stack item-give" aria-label={t("title")}>
      <h3 className="w-label">{t("title")}</h3>
      {holder ? (
        <div className="row">
          <span>{t("with", { name: holder.name })}</span>
          <button className="btn sm" onClick={handleTakeBack}>
            {t("takeBack")}
          </button>
        </div>
      ) : (
        <div className="row">
          <span className="dim">{t("nobody")}</span>
          <label className="row small">
            {t("giveTo")}
            <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">{t("pick")}</option>
              {characters.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn sm" onClick={handleGive} disabled={to === ""}>
            {t("give")}
          </button>
        </div>
      )}
    </section>
  );
}
