"use client";
import { useTranslations } from "next-intl";
import { useState, type SyntheticEvent } from "react";

import { CodexKind, type Codex, type Me, type Safety } from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { SafetySection } from "@/components/player/notebook/safety-section";
import { EntryFieldChips, EntryFields } from "@/components/ui/entry-fields/entry-fields";
import { EntryPath } from "@/components/ui/entry-path/entry-path";
import { EntryPicture } from "@/components/ui/entry-picture/entry-picture";
import { HandoutDoc } from "@/components/ui/handout-doc/handout-doc";
import { MentionText } from "@/components/ui/mention-text/mention-text";
import type { Send } from "@/hooks/use-table/use-table";
import { treeRows, type TreeRow } from "@/lib/codex/codex";
import type { RulesEntry } from "@/lib/library/library";

type NotebookProps = {
  codex: Codex | null;
  me: Me;
  safety: Safety;
  send: Send;
  /** The manifest as this seat reads it: the fields each kind of entry carries (house decision #71). */
  ruleset: Ruleset | null;
  /** Pack entries this seat already read, to name a ref field's entry. */
  known: readonly RulesEntry[];
};

// The phone's notebook: open quests first, then what the GM revealed by kind and tapped open (closed quests with their
// outcome under Quest), each with the fields the party sees, then the recaps, newest first. An entry sits indented under
// its parent when the phone reads it.
export function Notebook({ codex, me, safety, send, ruleset, known }: NotebookProps) {
  const t = useTranslations("notebook");
  const tKind = useTranslations("codex.kind");
  const tStatus = useTranslations("codex.status");
  const tRecaps = useTranslations("recaps");
  // The cards opened so far: only those read a ref field's name the page doesn't hold (no read per closed card).
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const entries = codex?.entries ?? [];
  const recaps = codex?.recaps ?? [];
  const safetySection = <SafetySection me={me} safety={safety} send={send} />;
  if (!entries.length && !recaps.length)
    return (
      <div className="stack">
        <p className="dim">{t("nothing")}</p>
        {safetySection}
      </div>
    );
  const openQuests = entries.filter((e) => e.kind === "quest" && e.status === "open");
  const rest = entries.filter((e) => !openQuests.includes(e));
  // A mention opens the entry it names and scrolls to it.
  const handleOpen = (id: string) => {
    const el = document.getElementById(`entry-${id}`);
    if (!(el instanceof HTMLDetailsElement)) return;
    el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  // A card opened (by a tap or by a mention) may read its refs' names from then on; a read is kept once made.
  const handleToggle = (id: string) => (ev: SyntheticEvent<HTMLDetailsElement>) => {
    if (ev.currentTarget.open) setOpened((cur) => (cur.has(id) ? cur : new Set(cur).add(id)));
  };
  const card = ({ entry: e, depth }: TreeRow) => (
    <details
      key={e.id}
      id={`entry-${e.id}`}
      className={depth > 0 ? "card tree-child" : "card"}
      style={{ marginInlineStart: depth * 12 }}
      onToggle={handleToggle(e.id)}
    >
      <summary>
        <strong>{e.title}</strong>
        {e.status && e.status !== "open" && <span className="chip">{tStatus(e.status)}</span>}
        <EntryFieldChips ruleset={ruleset} entry={e} />
      </summary>
      <EntryPath entries={entries} entry={e} onOpen={handleOpen} />
      <EntryPicture campaignId={me.campaignId} entry={e} />
      <EntryFields
        ruleset={ruleset}
        entry={e}
        campaignId={me.campaignId}
        known={known}
        enumChips={false}
        entries={entries}
        onOpenEntry={handleOpen}
        readNames={opened.has(e.id)}
      />
      {e.layout !== null ? (
        <HandoutDoc
          layout={e.layout}
          header={e.header ?? ""}
          title={e.title}
          body={e.body}
          entries={entries}
          onOpen={handleOpen}
        />
      ) : (
        <p style={{ whiteSpace: "pre-wrap" }}>
          <MentionText body={e.body} entries={entries} onOpen={handleOpen} />
        </p>
      )}
    </details>
  );
  return (
    <div className="stack">
      {openQuests.length > 0 && (
        <section className="stack">
          <h2 className="head">{t("openQuests")}</h2>
          {treeRows(openQuests).map(card)}
        </section>
      )}
      {CodexKind.options.map((kind) => {
        const ofKind = rest.filter((e) => e.kind === kind);
        return (
          ofKind.length > 0 && (
            <section key={kind} className="stack">
              <h2 className="head">{tKind(kind)}</h2>
              {treeRows(ofKind).map(card)}
            </section>
          )
        );
      })}
      {recaps.length > 0 && (
        <section className="stack">
          <h2 className="head">{t("recaps")}</h2>
          {recaps.map((r) => (
            <details key={r.sessionId} className="card">
              <summary>
                <strong>{[tRecaps("session", { number: r.number }), r.title].filter(Boolean).join(": ")}</strong>
              </summary>
              <p style={{ whiteSpace: "pre-wrap" }}>{r.recap}</p>
            </details>
          ))}
        </section>
      )}
      {safetySection}
    </div>
  );
}
