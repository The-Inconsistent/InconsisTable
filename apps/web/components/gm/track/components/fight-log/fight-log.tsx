"use client";
import { useTranslations } from "next-intl";

import type { Actor, FightLogLine } from "@inconsistable/core-schema";
import type { CompiledRuleset, Ruleset } from "@inconsistable/rules-engine";

import { useLogWords } from "@/hooks/use-log-words/use-log-words";
import { fightLog } from "@/lib/fight-log/fight-log";

type FightLogProps = {
  log: readonly FightLogLine[];
  actors: ReadonlyMap<string, Actor>;
  ruleset: Ruleset | null;
  /** For the health states a line brings an actor into (house decision #190). */
  compiled: CompiledRuleset | null;
  campaign: Readonly<Record<string, unknown>>;
};

// LOG (house decision #100): what happened in this fight, newest first, by round and turn, each action worded from what
// it wrote. Read-only: Undo and TURN BACK stay the tracker's buttons, undo and redo by line are HISTORY's (the header),
// and what was taken back is struck through.
export function FightLog({ log, actors, ruleset, compiled, campaign }: FightLogProps) {
  const t = useTranslations("fightLog");
  const rounds = fightLog({ log, names: actors, ruleset, compiled, campaign });
  const words = useLogWords();

  return (
    <section className="card stack fight-log" aria-label={t("title")}>
      <strong>{t("title")}</strong>
      {rounds.length === 0 && <p className="dim">{t("empty")}</p>}
      {rounds.map((r) => (
        <div key={r.round} className="stack fight-log-round">
          <span className="small">{t("roundHead", { round: r.round })}</span>
          {r.turns.map((turn, i) => (
            <div key={`${turn.actorId ?? "-"}-${i}`} className="stack fight-log-turn">
              <span className="small dim">{turn.name === null ? t("between") : t("turnOf", { name: turn.name })}</span>
              <ul className="fight-log-lines">
                {turn.lines.map((l) => {
                  const text = l.parts.map(words).join("; ");
                  return (
                    <li key={l.id} data-state={l.undone ? "undone" : "live"}>
                      {l.undone ? (
                        <>
                          <s>{text}</s> <span className="dim">{t("undone")}</span>
                        </>
                      ) : (
                        text
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
