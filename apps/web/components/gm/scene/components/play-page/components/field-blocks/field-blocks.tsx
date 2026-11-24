"use client";
import type { CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { EntryFields } from "@/components/ui/entry-fields/entry-fields";
import type { ShownField } from "@/lib/entry-fields/entry-fields";
import type { RulesEntry } from "@/lib/library/library";

type FieldBlocksProps = {
  ruleset: Ruleset | null;
  entry: CodexEntry;
  fields: readonly ShownField[];
  entries: readonly CodexEntry[];
  known: readonly RulesEntry[];
  campaignId: string;
  onOpenEntry?: (entryId: string) => void;
  /** True once, on the open fields: the entry's reminder lines are drawn there. */
  reminders?: boolean;
};

// A scene's declared fields as the page shows them: each text field as a block to read at arm's length (the ruleset's
// label over its text), everything else (chips, rows, links) as the card draws it.
export function FieldBlocks({
  ruleset,
  entry,
  fields,
  entries,
  known,
  campaignId,
  onOpenEntry,
  reminders = false,
}: FieldBlocksProps) {
  const texts = fields.filter((f) => f.def.type === "text");
  const rest = fields.filter((f) => f.def.type !== "text");
  return (
    <>
      {texts.map((f) => (
        <section key={f.id} className="scene-text" data-field="text">
          <h3 className="w-label">{f.def.label}</h3>
          <p>{String(f.value)}</p>
        </section>
      ))}
      <EntryFields
        ruleset={ruleset}
        entry={entry}
        campaignId={campaignId}
        known={known}
        entries={entries}
        onOpenEntry={onOpenEntry}
        fields={rest}
        reminders={reminders}
      />
    </>
  );
}
