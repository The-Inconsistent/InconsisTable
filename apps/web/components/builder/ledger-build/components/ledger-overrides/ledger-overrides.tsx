"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Actor } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { OverrideField } from "@/components/sheet/components/override-field/override-field";
import type { Send } from "@/hooks/use-table/use-table";

type LedgerOverridesProps = { ruleset: Ruleset; actor: Actor; send: Send };

// The GM's overrides of a character's derived values, beside its build (house decision #96; the source app's REVIEW
// overrides): each saved at once through field.set, with no build save, so the name (RENAME), the details (fields) and
// these are what "save details only" saves on a made character.
export function LedgerOverrides({ ruleset, actor, send }: LedgerOverridesProps) {
  const t = useTranslations("ledgerBuilder.overrides");
  const [error, setError] = useState<string | null>(null);
  const entity = ruleset.entities.find((e) => e.id === (actor.entity || ruleset.build?.actor));
  const marked = (entity?.derived ?? []).flatMap((d) => (d.override ? [{ ...d, override: d.override }] : []));
  if (actor.entity === "" || marked.length === 0) return null;
  return (
    <section className="stack sheet-card" aria-label={t("title")}>
      <h2 className="head">{t("title")}</h2>
      <p className="small dim">{t("hint")}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {marked.map((d) => (
        <OverrideField key={d.id} actor={actor} label={d.label} field={d.override} send={send} onError={setError} />
      ))}
    </section>
  );
}
