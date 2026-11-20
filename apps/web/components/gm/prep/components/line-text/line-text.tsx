"use client";
import { useTranslations } from "next-intl";

import type { PrepKind, PrepLine, ScenePrep } from "@inconsistable/core-schema";

import type { LineNames, Resolved } from "@/lib/scene-prep/scene-prep";

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
  const what = summary({ kind, line: line as PrepLine, names, t });
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
    </span>
  );
}

type T = ReturnType<typeof useTranslations<"prep">>;

// What a line does, in the room's own names; a name the room no longer has falls back to the id the line keeps.
function summary({ kind, line, names, t }: { kind: PrepKind; line: PrepLine; names: LineNames; t: T }): string {
  if (kind === "roster" && "pack" in line) {
    const name = names.creature(line.pack, line.key) ?? line.key;
    return line.mob === undefined
      ? t("summary.roster", { count: line.count, name })
      : t("summary.mob", { count: line.count, name, mob: line.mob });
  }
  if (kind === "tests" && "testId" in line) {
    const inputs = Object.entries(line.inputs)
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(", ");
    const who =
      line.takers === "party"
        ? t("summary.party")
        : line.actorIds.map((id) => names.actor(id) ?? t("summary.gone")).join(", ");
    return inputs === ""
      ? t("summary.test", { test: line.testId, who })
      : t("summary.testWith", { test: line.testId, inputs, who });
  }
  if (kind === "pools" && "pool" in line) {
    const pool = names.pool(line.pool) ?? line.pool;
    return [t("summary.pool", { pool, amount: line.amount }), line.text].filter(Boolean).join(" · ");
  }
  if (kind === "exits" && "sceneId" in line) return t("summary.exit", { scene: names.entry(line.sceneId) ?? "?" });
  if ("entryId" in line) return t("summary.reveal", { entry: names.entry(line.entryId) ?? "?" });
  return "";
}
