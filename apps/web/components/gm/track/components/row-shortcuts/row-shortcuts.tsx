"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Actor } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import type { Run } from "@/components/gm/track/constants";
import { rowShortcutsOf } from "@/lib/row-shortcuts/row-shortcuts";

type RowShortcutsProps = {
  ruleset: Ruleset | null | undefined;
  actor: Actor | undefined;
  run: Run;
};

// A tracker row's shortcuts (house decision #92): the tag its layout names, its note shown on a tap, and a plain
// stepper for each resource the layout names. A step is a delta the server clamps, as the sheet's stepper sends.
export function RowShortcuts({ ruleset, actor, run }: RowShortcutsProps) {
  const t = useTranslations("rowShortcuts");
  const [open, setOpen] = useState<string | null>(null);
  const { tags, steppers } = rowShortcutsOf({ ruleset, actor });
  if (!actor || (tags.length === 0 && steppers.length === 0)) return null;

  // ± on a resource of the row.
  const step = (resource: string, delta: number) => () =>
    run({ type: "rule.op", primitive: "resource.capped", op: "adjust", input: { actorId: actor.id, resource, delta } });

  return (
    <span className="row small row-shortcuts">
      {tags.map((tag) =>
        tag.note === null ? (
          <span key={tag.field} className="chip">
            {tag.label}
          </span>
        ) : (
          <button
            key={tag.field}
            type="button"
            className="chip"
            aria-expanded={open === tag.field}
            aria-label={t("tag", { label: tag.label })}
            onClick={() => setOpen(open === tag.field ? null : tag.field)}
          >
            {open === tag.field ? t("note", { label: tag.label, note: tag.note }) : tag.label}
          </button>
        ),
      )}
      {steppers.map((s) => (
        <span key={s.resource} className="stepper">
          <button
            type="button"
            className="btn sm"
            aria-label={t("less", { label: s.label, name: actor.name })}
            onClick={step(s.resource, -1)}
          >
            −
          </button>
          <output aria-label={s.label}>
            {s.label} {s.value}
          </output>
          <button
            type="button"
            className="btn sm"
            aria-label={t("more", { label: s.label, name: actor.name })}
            onClick={step(s.resource, 1)}
          >
            +
          </button>
        </span>
      ))}
    </span>
  );
}
