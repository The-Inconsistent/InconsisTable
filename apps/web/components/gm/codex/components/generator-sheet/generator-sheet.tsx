"use client";
import { useTranslations } from "next-intl";
import { useState, type ComponentProps } from "react";

import type { Generator } from "@inconsistable/rules-engine";

import { GeneratorWizard } from "@/components/gm/codex/components/generator-wizard/generator-wizard";
import { Cite } from "@/components/ui/cite/cite";
import { SideDrawer } from "@/components/ui/side-drawer/side-drawer";

type GeneratorSheetProps = Omit<ComponentProps<typeof GeneratorWizard>, "generator" | "footer"> & {
  /** The generators the kind filtered makes, at least one. */
  generators: readonly Generator[];
  /** The last refusal, shown here too: the sheet covers the CODEX's own line on a narrow screen. */
  error: string | null;
};

// CODEX's GENERATE (house decision #226): one side drawer with a generator picker at the top (none when there is only
// one) and the picked generator's wizard below, ROLL ALL first and ADD TO CODEX in the foot.
export function GeneratorSheet({ generators, error, onClose, ...wizard }: GeneratorSheetProps) {
  const t = useTranslations("generators");
  const tSheet = useTranslations("bottomSheet");
  const [pickedId, setPickedId] = useState(generators[0]?.id ?? "");
  const [foot, setFoot] = useState<HTMLElement | null>(null);
  const g = generators.find((x) => x.id === pickedId) ?? generators[0];
  if (!g) return null;
  const title = generators.length > 1 ? t("title") : g.label;

  return (
    <SideDrawer
      label={title}
      closeLabel={tSheet("closeLabel", { title })}
      onClose={onClose}
      actions={<span className="row" ref={setFoot} />}
      head={
        <>
          <h2 className="head">{title}</h2>
          {generators.length > 1 && (
            <select aria-label={t("pick")} value={g.id} onChange={(e) => setPickedId(e.target.value)}>
              {generators.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          )}
          {g.cite && <Cite cite={g.cite} />}
        </>
      }
    >
      <div className="side-drawer-body stack">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <GeneratorWizard key={g.id} {...wizard} generator={g} onClose={onClose} footer={foot} />
      </div>
    </SideDrawer>
  );
}
