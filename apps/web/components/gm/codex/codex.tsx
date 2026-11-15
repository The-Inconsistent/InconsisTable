"use client";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";

import {
  CodexKind,
  canInCampaign,
  type ActionInput,
  type Codex as CodexSnapshot,
  type LiveState,
  type Me,
} from "@inconsistable/core-schema";

import { EntryEditor } from "@/components/gm/codex/components/entry-editor/entry-editor";
import { VisibilityBadge } from "@/components/gm/codex/components/visibility-badge/visibility-badge";
import type { Send } from "@/hooks/use-table/use-table";
import { filterEntries, type KindFilter } from "@/lib/codex/codex";

type CodexProps = {
  me: Me;
  state: LiveState;
  codex: CodexSnapshot | null;
  send: Send;
  /** The entry open on arrival (PREP's "Open in CODEX"). */
  initialOpenId?: string | null;
};

// CODEX: the world's NPCs, places, factions and handouts. The GM writes them, searches them and reveals one to the
// table or to chosen characters; the server decides who then sees it (docs/design.md §1.3).
export function Codex({ me, state, codex, send, initialOpenId = null }: CodexProps) {
  const t = useTranslations("codex");
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<CodexKind>("npc");
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const can = (perm: Parameters<typeof canInCampaign>[0]["perm"]) => canInCampaign({ ctx: me, perm });
  const entries = useMemo(() => codex?.entries ?? [], [codex]);
  const shown = useMemo(() => filterEntries({ entries, kind, query }), [entries, kind, query]);
  const open = entries.find((e) => e.id === openId) ?? null;

  // Sends an action and shows its refusal, if any.
  const act = async (a: ActionInput) => {
    const r = await send(a);
    setError(r.ok ? null : r.error);
    return r;
  };

  // Filter chips: "All" or one kind.
  const handleKind = (k: KindFilter) => () => setKind(k);

  // Search box: filters the list as the GM types.
  const handleQuery = (e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value);

  // NEW ENTRY opens the form with the active filter as the kind, when it is one.
  const handleAdding = () => {
    if (kind !== "all") setNewKind(kind);
    setAdding(true);
  };

  // New entry's kind picker; only a kind from the closed set is taken.
  const handleNewKind = (e: ChangeEvent<HTMLSelectElement>) => {
    const k = CodexKind.safeParse(e.target.value);
    if (k.success) setNewKind(k.data);
  };

  // Creates the entry (a save without an id) and opens it for editing.
  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const r = await act({ type: "codex.save", kind: newKind, title: newTitle.trim() });
    if (!r.ok) return;
    setNewTitle("");
    setAdding(false);
    if (r.id) {
      setOpenId(r.id);
      setKind("all");
      setQuery("");
    }
  };

  // Deleted entries close the editor.
  const handleDeleted = () => setOpenId(null);

  return (
    <div className="stack" style={{ gap: 16 }}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="row between">
        <input
          id="codex-search"
          type="search"
          aria-label={t("search")}
          placeholder={t("search")}
          value={query}
          onChange={handleQuery}
          style={{ flex: 1, minWidth: 0 }}
        />
        {can("codex:write") && (
          <button className="btn primary" onClick={handleAdding} aria-expanded={adding}>
            {t("newEntry")}
          </button>
        )}
      </div>
      {adding && (
        <form className="card row" onSubmit={handleCreate}>
          <select id="codex-new-kind" aria-label={t("kindLabel")} value={newKind} onChange={handleNewKind}>
            {CodexKind.options.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </select>
          <input
            id="codex-new-title"
            aria-label={t("titleLabel")}
            placeholder={t("titleLabel")}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            maxLength={200}
            style={{ flex: 1, minWidth: 0 }}
            autoFocus
          />
          <button className="btn primary">{t("create")}</button>
          <button type="button" className="btn" onClick={() => setAdding(false)}>
            {t("cancel")}
          </button>
        </form>
      )}
      <div className="row" role="group" aria-label={t("filter")}>
        {(["all", ...CodexKind.options] as const).map((k) => (
          <button key={k} className="btn sm" aria-pressed={kind === k} onClick={handleKind(k)}>
            {k === "all" ? t("all") : t(`kind.${k}`)}
          </button>
        ))}
      </div>
      <div className="grid" style={{ alignItems: "start" }}>
        <ul className="list" style={{ minWidth: 0 }}>
          {shown.length === 0 && <li className="dim">{entries.length === 0 ? t("empty") : t("noMatch")}</li>}
          {shown.map((e) => (
            <li key={e.id}>
              <button
                className="btn"
                aria-pressed={openId === e.id}
                onClick={() => setOpenId(openId === e.id ? null : e.id)}
                style={{ flex: 1, justifyContent: "space-between", textAlign: "left" }}
              >
                <strong>{e.title}</strong>
                <span className="row small">
                  <span>{t(`kind.${e.kind}`)}</span>
                  {e.status && <span className="chip">{t(`status.${e.status}`)}</span>}
                  <VisibilityBadge entry={e} />
                </span>
              </button>
            </li>
          ))}
        </ul>
        {open && (
          <EntryEditor
            key={open.id}
            entry={open}
            characters={state.actors.filter((a) => a.kind === "pc")}
            entries={entries}
            onOpenEntry={setOpenId}
            can={{
              write: can("codex:write"),
              secrets: can("codex:read_secret"),
              reveal: can("codex:reveal"),
            }}
            act={act}
            onDeleted={handleDeleted}
          />
        )}
      </div>
    </div>
  );
}
