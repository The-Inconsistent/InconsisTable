"use client";
import { useTranslations } from "next-intl";

import type { Ruleset } from "@inconsistable/rules-engine";

import { BottomSheet } from "@/components/ui/bottom-sheet/bottom-sheet";
import type { OpenedEntry } from "@/hooks/use-pack-entry/use-pack-entry";
import { summaryOf } from "@/lib/builder/builder";

type PackEntrySheetProps = { opened: OpenedEntry; ruleset: Ruleset | null; onClose: () => void };

// One pack entry, opened from a codex entry's ref field: its name, type, level and page, its summary, and the values of
// the fields this seat's manifest declares for its type. It rises from the bottom and leaves the table in reach.
export function PackEntrySheet({ opened, ruleset, onClose }: PackEntrySheetProps) {
  const t = useTranslations("entryFields");
  const { entry } = opened;
  const def = entry ? ruleset?.entities.find((e) => e.id === entry.type) : undefined;
  const rows = Object.entries(def?.fields ?? {}).flatMap(([id, field]) => {
    const value = entry && Object.hasOwn(entry.body, id) ? entry.body[id] : undefined;
    const shown = Array.isArray(value) ? value.join(", ") : value;
    return typeof shown === "string" || typeof shown === "number" ? [{ id, label: field.label, value: shown }] : [];
  });
  const summary = entry ? summaryOf({ entry, def }) : "";
  return (
    <BottomSheet title={entry?.name ?? opened.title} onClose={onClose}>
      {entry === null ? (
        <p className="dim">{opened.error ?? t("gone")}</p>
      ) : (
        <div className="stack">
          <div className="row">
            <span className="chip">{def?.label ?? entry.type}</span>
            {entry.level !== null && <span className="chip">{t("level", { level: entry.level })}</span>}
            {entry.cite && <span className="small dim">{entry.cite}</span>}
          </div>
          {summary !== entry.name && <p className="dim">{summary}</p>}
          {rows.length > 0 && (
            <div className="sheet-rows">
              {rows.map((r) => (
                <div key={r.id} className="sheet-row">
                  <span>{r.label}</span>
                  <strong>{r.value}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
