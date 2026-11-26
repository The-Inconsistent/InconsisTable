"use client";
import { useTranslations } from "next-intl";

import { Term, type TermEnv } from "@/components/ui/term-card/term-card";
import type { GuideSection } from "@/lib/sheet/sheet";

type SheetGuideProps = { guide: readonly GuideSection[]; env: TermEnv };

// HOW TO READ THIS SHEET (house decision #126): folded, so it costs a regular one line. Drawn from the layout: each
// section's name, then the names in it that say what they mean, each opening its card. No prose of its own.
export function SheetGuide({ guide, env }: SheetGuideProps) {
  const t = useTranslations("term");
  const tSheet = useTranslations("sheet");
  if (guide.length === 0) return null;
  return (
    <details className="sheet-guide sheet-card">
      <summary className="head">{t("guide")}</summary>
      <dl className="stack">
        {guide.map((s) => (
          <div key={s.id} className="stack" style={{ gap: 2 }}>
            <dt className="stat-label">{s.label ?? tSheet(`section.${s.id as "derived" | "resources" | "fields"}`)}</dt>
            <dd className="row" style={{ margin: 0, gap: 12 }}>
              {s.terms.map((r) => (
                <Term key={`${r.kind}-${r.id}`} term={r} env={env} />
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="small dim">{t("guideTip")}</p>
    </details>
  );
}
