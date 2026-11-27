"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import {
  deleteCharacter,
  LIBRARY_CAP,
  listLibrary,
  newCharacter,
  type LibraryCard,
} from "@/lib/character-library/character-library";
import { forgetLocal } from "@/lib/library-draft/library-draft";
import type { RulesetList } from "@/lib/library/library";

// YOUR CHARACTERS (house decision #104): the user's library, the last edited first, each with its line (#187), its
// ruleset, whether it is ready and when it was last edited; NEW with one of the user's own rulesets opens the builder
// outside a room; DELETE asks once more. A user who keeps no library (no account on a deployment that signs in) is told
// why.
export function YourCharacters({ rulesets }: { rulesets: RulesetList }) {
  const t = useTranslations("characterLibrary.lobby");
  const tr = useRefusal();
  const format = useFormatter();
  const router = useRouter();
  const [cards, setCards] = useState<LibraryCard[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pick, setPick] = useState(rulesets[0]?.versions[0]?.id ?? "");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listLibrary().then((r) => (r.ok ? setCards(r.value) : setProblem(r.error ? tr(r.error) : t("failed"))));
  }, [tr, t]);

  // NEW CHARACTER: made with the picked ruleset, then opened in the builder.
  const handleNew = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await newCharacter(pick);
    setBusy(false);
    if (r.ok) return router.push(`/characters/${r.value.id}`);
    setProblem(r.error ? tr(r.error) : t("failed"));
  };
  // DELETE, then CONFIRM on the same card.
  const handleDelete = async (id: string) => {
    if (confirm !== id) return setConfirm(id);
    setBusy(true);
    const r = await deleteCharacter(id);
    setBusy(false);
    setConfirm(null);
    if (r.ok) forgetLocal(id); // this browser's copy of its draft (house decision #188)
    if (r.ok) setCards((was) => was?.filter((c) => c.id !== id) ?? null);
    else setProblem(r.error ? tr(r.error) : t("failed"));
  };

  const full = (cards?.length ?? 0) >= LIBRARY_CAP;
  return (
    <section className="stack" id="your-characters">
      <h2 className="head">
        {t("title")} <span className="ws-tally">{cards?.length ?? 0}</span>
      </h2>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {cards && cards.length === 0 && <p className="dim">{t("empty")}</p>}
      {cards && cards.length > 0 && (
        <div className="grid rise-list">
          {cards.map((c, i) => (
            <div key={c.id} className="card ws-tile stack" style={{ "--i": i } as CSSProperties}>
              <strong className="card-name">{c.name || t("unnamed")}</strong>
              {c.line && <span className="small">{c.line}</span>}
              <span className="small dim">
                {c.ruleset.title ?? c.ruleset.slug} {c.ruleset.version}
              </span>
              <span className="row small" style={{ flexWrap: "wrap" }}>
                <span className="chip">{c.done ? t("ready") : t("inProgress")}</span>
                <span className="dim">
                  {t("edited", {
                    when: format.dateTime(new Date(c.updatedAt), { dateStyle: "medium", timeStyle: "short" }),
                  })}
                </span>
              </span>
              <span className="row" style={{ flexWrap: "wrap" }}>
                <Link className="btn" href={`/characters/${c.id}`}>
                  {t("open")}
                </Link>
                <button
                  type="button"
                  className={confirm === c.id ? "btn primary" : "btn"}
                  disabled={busy}
                  onClick={() => void handleDelete(c.id)}
                  aria-label={t("deleteLabel", { name: c.name || t("unnamed") })}
                >
                  {confirm === c.id ? t("confirm") : t("delete")}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {cards && rulesets.length > 0 && (
        <form className="row" onSubmit={handleNew} style={{ flexWrap: "wrap" }}>
          <label className="row">
            {t("ruleset")}
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              {rulesets.flatMap((r) =>
                r.versions.slice(0, 1).map((v) => (
                  <option key={v.id} value={v.id}>
                    {r.title} {v.version}
                  </option>
                )),
              )}
            </select>
          </label>
          <button className="btn primary" type="submit" disabled={busy || full || !pick}>
            {t("new")}
          </button>
          <span className="small dim">
            {t("count", { count: cards.length, cap: LIBRARY_CAP })}
            {full && ` · ${t("full")}`}
          </span>
        </form>
      )}
      {cards && rulesets.length === 0 && <p className="small dim">{t("noRuleset")}</p>}
    </section>
  );
}
