"use client";
import { useTranslations } from "next-intl";

import type { HeldRecord } from "@inconsistable/core-schema";

import { Cite } from "@/components/ui/cite/cite";
import { effectOf, type WidgetModel } from "@/lib/sheet-widgets/sheet-widgets";

import type { WidgetEnv } from "../types";

type HeldProps = { model: Extract<WidgetModel, { widget: "held" }>; env: WidgetEnv };

// The records a character holds (house decision #88), kind by kind: each one's name, what it does in the platform's
// words and its page. A seat that may not read a kind's names gets the ruleset's unseen word and the same effects. The
// GM side may cut one off; Undo gives it back.
export function Held({ model, env }: HeldProps) {
  const t = useTranslations("sheet.widget");
  // CUT OFF: takes the record away at once; the log and Undo keep the way back.
  const handleCut = async (kind: string, r: HeldRecord) => {
    if (r.key === null) return;
    const result = await env.send({ type: "held.remove", actorId: env.actor.id, held: kind, entry: r.key });
    env.onError(result.ok ? null : result.error);
  };
  // One effect in words: a whole amount added as a signed number and its label, anything else as written.
  const words = (e: HeldRecord["effects"][number]) => {
    const x = effectOf({ ruleset: env.ruleset, entity: env.actor.entity, effect: e });
    return x.by === null
      ? t("heldOther", { label: x.label, mode: x.mode, value: x.value })
      : t("heldAdd", { by: x.by, label: x.label });
  };
  return (
    <div className="stack w-held">
      {model.groups.map((g) => (
        <section key={g.kind} className="stack" aria-label={g.label}>
          {model.groups.length > 1 && <h4 className="w-label">{g.label}</h4>}
          <ul className="w-held-list">
            {g.records.map((r, i) => (
              <li key={r.key ?? `unseen-${i}`} className="w-held-item">
                <div className="row w-held-head">
                  <span className="w-fold-title">{r.name}</span>
                  {r.cite && (
                    <Cite cite={r.cite} ruleset={env.ruleset} books={env.books} requestPage={env.requestPage} />
                  )}
                  {env.gm && r.key !== null && (
                    <button
                      className="btn sm"
                      onClick={() => handleCut(g.kind, r)}
                      aria-label={t("heldCutLabel", { name: r.name })}
                    >
                      {t("heldCut")}
                    </button>
                  )}
                </div>
                {r.effects.length > 0 && <span className="small">{r.effects.map(words).join(" · ")}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
