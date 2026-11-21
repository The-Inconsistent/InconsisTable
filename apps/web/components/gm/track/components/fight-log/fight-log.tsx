"use client";
import { useTranslations } from "next-intl";

import type { Actor, FightLogLine } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { fightLog, type LogPart } from "@/lib/fight-log/fight-log";

type FightLogProps = {
  log: readonly FightLogLine[];
  actors: ReadonlyMap<string, Actor>;
  ruleset: Ruleset | null;
};

// LOG (house decision #100): what happened in this fight, newest first, by round and turn, each action worded from what
// it wrote. Read-only: Undo and TURN BACK stay the tracker's buttons, and what they took back is struck through.
export function FightLog({ log, actors, ruleset }: FightLogProps) {
  const t = useTranslations("fightLog");
  const rounds = fightLog({ log, names: actors, ruleset });

  // One part in the platform's words.
  const words = (p: LogPart): string => {
    switch (p.kind) {
      case "strike":
        return p.means === null
          ? t("strike", { attacker: p.attacker, target: p.target, outcome: p.outcome, total: p.total })
          : t("strikeWith", {
              attacker: p.attacker,
              target: p.target,
              means: p.means,
              outcome: p.outcome,
              total: p.total,
            });
      case "change":
        return p.name === null ? t("pool", { by: p.by, label: p.label }) : t("change", { ...p, name: p.name });
      case "set":
        return t("set", p);
      case "condition":
        return t(p.on ? "conditionOn" : "conditionOff", { name: p.name, label: p.label });
      case "acts":
        return t("acts", { name: p.name });
      case "ends":
        return t("ends", { name: p.name });
      case "round":
        return t("round", { round: p.round });
    }
  };

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
              <ol className="fight-log-lines">
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
              </ol>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
