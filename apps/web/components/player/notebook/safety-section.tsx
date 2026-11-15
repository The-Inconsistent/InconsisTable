"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { SAFETY_LINE_MAX, canInCampaign, type Me, type Safety } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";

type SafetySectionProps = { me: Me; safety: Safety; send: Send };

// LINES & VEILS on the phone: what this table keeps out and what happens off the page, and a form to suggest one more.
// The suggestion is anonymous: the api keeps the text alone, and the form says so.
export function SafetySection({ me, safety, send }: SafetySectionProps) {
  const t = useTranslations("safety.view");
  const [kind, setKind] = useState<"line" | "veil">("line");
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleSuggest = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const r = await send({ type: "safety.suggest", kind, text });
    setError(r.ok ? null : r.error);
    setNote(r.ok ? t("sent") : null);
    if (r.ok) setText("");
  };
  const list = (title: string, items: readonly string[]) => (
    <div className="stack">
      <h3 className="head">{title}</h3>
      {items.length ? (
        <ul className="list">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="dim">{t("none")}</p>
      )}
    </div>
  );
  return (
    <section className="stack" aria-labelledby="safety-title">
      <h2 className="head" id="safety-title">
        {t("title")}
      </h2>
      {list(t("lines"), safety.lines)}
      {list(t("veils"), safety.veils)}
      {canInCampaign({ ctx: me, perm: "safety:signal" }) && (
        <form className="card stack" onSubmit={handleSuggest}>
          <strong>{t("suggest")}</strong>
          <p className="dim small">{t("anonymous")}</p>
          <div className="row">
            <label>
              <input type="radio" name="safety-kind" checked={kind === "line"} onChange={() => setKind("line")} />{" "}
              {t("asLine")}
            </label>
            <label>
              <input type="radio" name="safety-kind" checked={kind === "veil"} onChange={() => setKind("veil")} />{" "}
              {t("asVeil")}
            </label>
          </div>
          <input
            value={text}
            maxLength={SAFETY_LINE_MAX}
            onChange={(e) => setText(e.target.value)}
            aria-label={t("suggest")}
          />
          <button className="btn" style={{ justifySelf: "start" }} disabled={!text.trim()}>
            {t("send")}
          </button>
          {note && <p role="status">{note}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
