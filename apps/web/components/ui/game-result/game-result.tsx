"use client";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import type { Game, GameResult as Row } from "@inconsistable/core-schema";

type GameResultProps = {
  game: Game;
  /** Actor ids this seat holds: a phone shows its own place first. Empty on the TV and the tablet. */
  held?: readonly string[];
  /** The GM's tablet: corrects one score. Resolves true when the server took it. */
  onCorrect?: (resultId: string, score: number) => Promise<boolean>;
};

type ScoreEditorProps = { row: Row; onCorrect: (resultId: string, score: number) => Promise<boolean> };

// One row's score field on the GM's tablet. The server ranks the game again and the new order arrives in the snapshot.
function ScoreEditor({ row, onCorrect }: ScoreEditorProps) {
  const t = useTranslations("gameResult");
  const [value, setValue] = useState(String(row.score));
  const score = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(score) && score !== row.score;

  // SAVE: sends the corrected score for this result.
  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (valid) await onCorrect(row.resultId, score);
  };

  return (
    <form className="row" onSubmit={handleSave}>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={t("scoreOf", { name: row.name })}
        style={{ width: 90 }}
      />
      <button className="btn sm" type="submit" disabled={!valid}>
        {t("save")}
      </button>
    </form>
  );
}

// The end of a game: each character's place, score and tiebreaks, or the table's win or loss (house decisions
// #38-#40). A phone puts its own character first, large; everyone's results follow. The place is a word and a number,
// never position or colour alone.
export function GameResult({ game, held = [], onCorrect }: GameResultProps) {
  const t = useTranslations("gameResult");
  const coop = game.mode === "coop";
  const outcome = game.rows[0]?.outcome ?? null;
  const mine = game.rows.filter((r) => r.actorId !== null && held.includes(r.actorId));
  return (
    <section className="stack game-result" aria-label={t("label")}>
      <h2 className="title">{game.endedEarly ? t("endedEarly") : t("ended")}</h2>
      {coop && outcome && (
        <p className="game-outcome" data-outcome={outcome} role="status">
          {t(outcome)}
        </p>
      )}
      {!coop &&
        mine.map((r) => (
          <p key={r.resultId} className="game-mine" role="status">
            <span className="game-place">{t("place", { place: r.place ?? 0 })}</span>
            <span>{t("score", { score: r.score })}</span>
          </p>
        ))}
      <ol className="order seat-strip">
        {game.rows.map((r) => (
          <li key={r.resultId} className="combatant" data-acting={r.actorId !== null && held.includes(r.actorId)}>
            <span className="who" style={{ cursor: "default" }}>
              {!coop && <span className="game-place">{t("place", { place: r.place ?? 0 })}</span>}
              <span className="name">{r.name}</span>
              {r.tiebreaks.length > 0 && (
                <span className="dim">{t("tiebreaks", { values: r.tiebreaks.join(", ") })}</span>
              )}
            </span>
            {onCorrect && !coop ? (
              <ScoreEditor row={r} onCorrect={onCorrect} />
            ) : (
              <span className="game-score">{t("score", { score: r.score })}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
