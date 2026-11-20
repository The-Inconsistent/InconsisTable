"use client";
import { useTranslations } from "next-intl";

import type { PrepKind, PrepLine, ScenePrep } from "@inconsistable/core-schema";

import { useSummaryWords } from "@/hooks/use-summary-words/use-summary-words";
import { lineSummary, type LineNames, type Resolved } from "@/lib/scene-prep/scene-prep";

type LineTextProps<K extends PrepKind> = {
  kind: K;
  line: ScenePrep[K][number];
  names: LineNames;
  resolved: Resolved;
  /** The run view's larger type, read at arm's length. */
  large?: boolean;
};

// One prepared line in words: the GM's label (or what it does), what it does under it, its note, and, when it can't be
// sent, why: a broken line says what the room no longer has.
export function LineText<K extends PrepKind>({ kind, line, names, resolved, large = false }: LineTextProps<K>) {
  const t = useTranslations("prep");
  const words = useSummaryWords();
  const what = lineSummary({ kind, line: line as PrepLine, names, t: words });
  return (
    <span className="stack" style={{ gap: 2, minWidth: 0 }}>
      <strong style={{ fontSize: large ? "var(--fs-name)" : undefined, overflowWrap: "anywhere" }}>
        {line.label || what}
      </strong>
      {line.label && <span className="small">{what}</span>}
      {line.note && <span className="small dim">{line.note}</span>}
      {resolved.state === "broken" && (
        <span className="chip" data-state="broken">
          {t(`missing.${resolved.missing}`)}
        </span>
      )}
      {resolved.state === "blocked" && <span className="small dim">{t(`blocked.${resolved.reason}`)}</span>}
      {/* The run view draws the missing inputs as fields instead. */}
      {resolved.state === "fill" && !large && (
        <span className="small dim">{t("asks", { inputs: resolved.missing.map((i) => i.id).join(", ") })}</span>
      )}
    </span>
  );
}
