"use client";
import { useTranslations } from "next-intl";

import type { LogPart } from "@/lib/fight-log/fight-log";

/** One part of a logged action in the platform's words: the fight's log (house decision #100) and HISTORY (#133). */
export function useLogWords(): (p: LogPart) => string {
  const t = useTranslations("fightLog");
  return (p) => {
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
      case "other":
        return t("other", { count: p.count });
      case "warn":
        return t("warn", { name: p.name, text: p.text });
    }
  };
}
