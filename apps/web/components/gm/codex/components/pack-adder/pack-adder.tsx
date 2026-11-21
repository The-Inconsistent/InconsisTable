"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { CodexKind, type ActionInput, type ActionResult } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { RefPicker } from "@/components/gm/codex/components/entry-fields-form/components/ref-picker/ref-picker";
import type { RulesEntry } from "@/lib/library/library";

type PackAdderProps = {
  /** The kinds the ruleset makes from pack entries, and the types each is made from (`fromKinds`). */
  kinds: readonly { kind: CodexKind; entities: readonly string[] }[];
  initialKind?: CodexKind;
  /** The entry the new one goes under: a scene's adventure. */
  parentId?: string;
  campaignId: string;
  ruleset: Ruleset | null;
  act: (a: ActionInput) => Promise<ActionResult>;
  /** The new entries, root first. */
  onMade: (ids: readonly string[]) => void;
  onClose: () => void;
};

// ADD FROM A PACK (house decision #97): a search over the room's served entries of a type the kind is made from; the
// picked one becomes an entry, with the ones inside it and a scene's prepared lines, made by the server as one action.
export function PackAdder({ kinds, initialKind, parentId, campaignId, ruleset, act, onMade, onClose }: PackAdderProps) {
  const t = useTranslations("codex");
  const [kind, setKind] = useState<CodexKind>(
    kinds.find((k) => k.kind === initialKind)?.kind ?? kinds[0]?.kind ?? "npc",
  );
  const entities = kinds.find((k) => k.kind === kind)?.entities ?? [];
  const [entity, setEntity] = useState(entities[0] ?? "");
  const [made, setMade] = useState<{ name: string; inside: number } | null>(null);
  const typeLabel = (id: string) => ruleset?.entities.find((e) => e.id === id)?.label ?? id;
  const shown = entities.includes(entity) ? entity : (entities[0] ?? "");

  // A kind picked: its first type.
  const handleKind = (k: CodexKind) => {
    setKind(k);
    setEntity(kinds.find((x) => x.kind === k)?.entities[0] ?? "");
  };

  // A pack entry picked: the server makes the entry and the ones inside it.
  const handlePick = async (entry: RulesEntry | null) => {
    if (!entry) return;
    const r = await act({
      type: "codex.fromPack",
      kind,
      entity: shown,
      key: entry.key,
      ...(parentId ? { parentId } : {}),
    });
    if (!r.ok) return;
    const ids = r.ids ?? (r.id ? [r.id] : []);
    setMade({ name: entry.name, inside: Math.max(0, ids.length - 1) });
    onMade(ids);
  };

  return (
    <section className="card stack pack-adder" aria-label={t("fromPack")}>
      <div className="row">
        {kinds.length > 1 && (
          <select
            aria-label={t("kindLabel")}
            value={kind}
            onChange={(e) => {
              const k = CodexKind.safeParse(e.target.value);
              if (k.success) handleKind(k.data);
            }}
          >
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {t(`kind.${k.kind}`)}
              </option>
            ))}
          </select>
        )}
        {entities.length > 1 && (
          <select aria-label={t("fromPackType")} value={shown} onChange={(e) => setEntity(e.target.value)}>
            {entities.map((id) => (
              <option key={id} value={id}>
                {typeLabel(id)}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn sm" onClick={onClose}>
          {t("cancel")}
        </button>
      </div>
      {shown !== "" && (
        <RefPicker
          key={`${kind}/${shown}`}
          id="codex-from-pack"
          label={typeLabel(shown)}
          campaignId={campaignId}
          entity={shown}
          value={null}
          name={null}
          disabled={false}
          onPick={handlePick}
          onOpen={() => {}}
        />
      )}
      <p className="small dim">{t("fromPackHint")}</p>
      {made && (
        <p role="status" className="small">
          {t("fromPackMade", { name: made.name, count: made.inside })}
        </p>
      )}
    </section>
  );
}
