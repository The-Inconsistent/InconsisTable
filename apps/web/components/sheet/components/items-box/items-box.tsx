"use client";
import { useTranslations } from "next-intl";
import { useState, type ChangeEvent, type FormEvent } from "react";

import { ItemLine } from "@/components/sheet/components/item-line/item-line";
import type { WidgetEnv } from "@/components/sheet/widgets/types";
import { RefPicker } from "@/components/gm/codex/components/entry-fields-form/components/ref-picker/ref-picker";
import { itemLines } from "@/lib/items/items";
import type { RulesEntry } from "@/lib/library/library";

type ItemsBoxProps = {
  env: WidgetEnv;
  /** The kinds this box lists: every kind no `cards` widget of the layout draws. */
  kinds: ReadonlySet<string>;
  /** The room, for the GM's ADD BY HAND to search its packs; without it the GM writes a name only. */
  campaignId: string | null;
};

// What a character carries (house decision #95), kind by kind: the items no `cards` widget draws, each a line with what
// is fitted to it. The GM side adds an item by hand, from the room's packs or by a name of its own.
export function ItemsBox({ env, kinds, campaignId }: ItemsBoxProps) {
  const t = useTranslations("sheet.items");
  const items = env.actor.items ?? [];
  const lines = itemLines({ ruleset: env.ruleset, items, kinds });
  const declared = (env.ruleset.items?.kinds ?? []).filter(
    (k) => kinds.has(k.id) && k.entities.includes(env.actor.entity),
  );
  const [kind, setKind] = useState(declared[0]?.id ?? "");
  const [entry, setEntry] = useState<RulesEntry | null>(null);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  if (declared.length === 0 || (lines.length === 0 && !env.gm)) return null;
  const picked = declared.find((k) => k.id === kind);

  // A whole number from 1 to 999, as the server takes it.
  const handleQuantity = (e: ChangeEvent<HTMLInputElement>) =>
    setQuantity(Math.max(1, Math.min(999, Math.trunc(Number(e.target.value)) || 1)));
  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (entry === null && name.trim() === "") return;
    const result = await env.send({
      type: "item.add",
      actorId: env.actor.id,
      kind,
      ...(entry !== null ? { entry: entry.key } : { name }),
      note: "",
      quantity,
    });
    env.onError(result.ok ? null : result.error);
    if (result.ok) {
      setEntry(null);
      setName("");
      setQuantity(1);
    }
  };

  return (
    <section className="stack sheet-card items-box" aria-label={t("carried")}>
      <h2 className="head">{t("carried")}</h2>
      {declared.map((k) => {
        const mine = lines.filter((l) => l.item.kind === k.id);
        return (
          mine.length > 0 && (
            <section key={k.id} className="stack" aria-label={k.label}>
              <h3 className="w-label">{k.label}</h3>
              <ul className="w-kits">
                {mine.map((l) => (
                  <ItemLine key={l.item.id} line={l} env={env} />
                ))}
              </ul>
            </section>
          )
        );
      })}
      {lines.length === 0 && <p className="dim">{t("none")}</p>}
      {env.gm && (
        <form className="stack item-add" onSubmit={handleAdd} aria-label={t("addByHand")}>
          <h3 className="w-label">{t("addByHand")}</h3>
          <label className="stack small">
            {t("kind")}
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
              {declared.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          {campaignId && picked && (
            <RefPicker
              id={`item-add-${env.actor.id}`}
              label={t("fromPacks")}
              campaignId={campaignId}
              entity={picked.entry}
              value={entry?.key ?? null}
              name={entry?.name ?? null}
              disabled={false}
              onPick={setEntry}
              onOpen={() => undefined}
            />
          )}
          {entry === null && (
            <label className="stack small">
              {t("orName")}
              <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          {picked?.stacks && (
            <label className="stack small">
              {t("quantity")}
              <input className="input" type="number" min={1} max={999} value={quantity} onChange={handleQuantity} />
            </label>
          )}
          <button className="btn" type="submit" disabled={entry === null && name.trim() === ""}>
            {t("add")}
          </button>
        </form>
      )}
    </section>
  );
}
