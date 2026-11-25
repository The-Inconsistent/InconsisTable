"use client";
import { useTranslations } from "next-intl";

import type { CodexEntry } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { LineList } from "@/components/gm/prep/components/scene-run/components/line-list/line-list";
import { StatusBar } from "@/components/gm/prep/components/scene-run/components/status-bar/status-bar";
import { FieldBlocks } from "@/components/gm/scene/components/play-page/components/field-blocks/field-blocks";
import { Missions } from "@/components/gm/scene/components/play-page/components/missions/missions";
import { PAGE_LINE_KINDS } from "@/components/gm/scene/constants";
import { MentionText } from "@/components/ui/mention-text/mention-text";
import type { LineSender } from "@/hooks/use-line-sender/use-line-sender";
import type { RulesEntry } from "@/lib/library/library";
import { pageFields } from "@/lib/scene-play/scene-play";
import type { LineNames, PrepWorld } from "@/lib/scene-prep/scene-prep";

type PlayPageProps = {
  scene: CodexEntry;
  adventure: CodexEntry | null;
  /** The scene's number in its adventure, from 1; null for a loose scene. */
  number: number | null;
  ruleset: Ruleset | null;
  entries: readonly CodexEntry[];
  known: readonly RulesEntry[];
  campaignId: string;
  /** The seat holds `codex:read_secret`: only then are the closed fields and the GM notes drawn at all. */
  secrets: boolean;
  sender: LineSender;
  world: PrepWorld;
  names: LineNames;
  /** A preview: the same page with no status buttons, no line button and no switch. */
  readOnly?: boolean;
  onOpenEntry: (entryId: string) => void;
};

// The scene being played as a page (issue #216): its label, the fields it reads aloud, the closed notes, the body, then
// the lines to send. Exits and the roster are the side panel's and the footer's.
export function PlayPage({
  scene,
  adventure,
  number,
  ruleset,
  entries,
  known,
  campaignId,
  secrets,
  sender,
  world,
  names,
  readOnly = false,
  onOpenEntry,
}: PlayPageProps) {
  const t = useTranslations("scene");
  const tCodex = useTranslations("codex");
  const { open, closed } = pageFields({ ruleset, entry: scene });
  const kind = tCodex(`kind.${scene.kind}`);
  const fieldProps = { ruleset, entry: scene, entries, known, campaignId, onOpenEntry };
  return (
    <article className="card stack scene-page" aria-label={scene.title} style={{ minWidth: 0 }}>
      <p className="small dim">
        {adventure && number !== null
          ? t("label", { adventure: adventure.title, kind, number })
          : t("labelLoose", { kind })}
      </p>
      <h2 className="title" style={{ overflowWrap: "anywhere" }}>
        {scene.title}
      </h2>
      {!readOnly && <StatusBar scene={scene} sender={sender} />}
      <FieldBlocks {...fieldProps} fields={open} reminders />
      {scene.body && (
        <p className="scene-body">
          <MentionText body={scene.body} entries={entries} onOpen={onOpenEntry} />
        </p>
      )}
      {secrets && (closed.length > 0 || scene.gmNotes) && (
        <details className="scene-closed">
          <summary>{t("closed")}</summary>
          <div className="stack">
            <FieldBlocks {...fieldProps} fields={closed} />
            {scene.gmNotes && (
              <section className="scene-text" data-field="gm-notes">
                <h3 className="w-label">{t("gmNotes")}</h3>
                <p>
                  <MentionText body={scene.gmNotes} entries={entries} onOpen={onOpenEntry} />
                </p>
              </section>
            )}
          </div>
        </details>
      )}
      <Missions scene={scene} entries={entries} actors={world.state.actors} onOpenEntry={onOpenEntry} />
      <LineList sender={sender} world={world} names={names} kinds={PAGE_LINE_KINDS} readOnly={readOnly} />
    </article>
  );
}
