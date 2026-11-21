"use client";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";

import {
  CodexKind,
  canInCampaign,
  type ActionInput,
  type BookSource,
  type Codex as CodexSnapshot,
  type LiveState,
  type Me,
} from "@inconsistable/core-schema";
import type { Ruleset } from "@inconsistable/rules-engine";

import { EntryEditor } from "@/components/gm/codex/components/entry-editor/entry-editor";
import { PackAdder } from "@/components/gm/codex/components/pack-adder/pack-adder";
import { VisibilityBadge } from "@/components/gm/codex/components/visibility-badge/visibility-badge";
import { EntryFieldChips } from "@/components/ui/entry-fields/entry-fields";
import type { RequestPage, Send } from "@/hooks/use-table/use-table";
import { filterEntries, treeRows, unfolded, type KindFilter } from "@/lib/codex/codex";
import { fromKinds } from "@/lib/entry-fields/entry-fields";
import type { RulesEntry } from "@/lib/library/library";

type CodexProps = {
  me: Me;
  state: LiveState;
  codex: CodexSnapshot | null;
  send: Send;
  /** The entry open on arrival (PREP's "Open in CODEX"). */
  initialOpenId?: string | null;
  /** The kind listed on arrival (a checklist step's GO TO, house decision #90). */
  initialKind?: CodexKind | null;
  /** The manifest as this seat reads it: the fields each kind of entry carries (house decision #71). */
  ruleset?: Ruleset | null;
  /** Pack entries this seat already read, to name a ref field's entry. */
  known?: readonly RulesEntry[];
  /** Books a GM tablet serves, for the page an entry made from a pack entry cites. */
  books?: readonly BookSource[];
  requestPage?: RequestPage;
};

const NO_ENTRIES: readonly RulesEntry[] = [];

// CODEX: the world's NPCs, places, factions and handouts. The GM writes them, searches them and reveals one to the
// table or to chosen characters; the server decides who then sees it (docs/design.md §1.3).
export function Codex({
  me,
  state,
  codex,
  send,
  initialOpenId = null,
  initialKind = null,
  ruleset = null,
  known = NO_ENTRIES,
  books,
  requestPage,
}: CodexProps) {
  const t = useTranslations("codex");
  const [kind, setKind] = useState<KindFilter>(initialKind ?? "all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [adding, setAdding] = useState(false);
  const [fromPack, setFromPack] = useState(false);
  const packKinds = useMemo(() => fromKinds(ruleset), [ruleset]);
  const [newKind, setNewKind] = useState<CodexKind>("npc");
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Entries whose insides are hidden; every branch starts open.
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const can = (perm: Parameters<typeof canInCampaign>[0]["perm"]) => canInCampaign({ ctx: me, perm });
  const entries = useMemo(() => codex?.entries ?? [], [codex]);
  const shown = useMemo(() => filterEntries({ entries, kind, query }), [entries, kind, query]);
  const rows = useMemo(() => unfolded({ rows: treeRows(shown), folded }), [shown, folded]);
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

  // The fold button: hides or shows what sits inside an entry.
  const handleFold = (id: string) => () => {
    const next = new Set(folded);
    if (!next.delete(id)) next.add(id);
    setFolded(next);
  };

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
        {can("codex:write") && packKinds.length > 0 && (
          <button className="btn" onClick={() => setFromPack(!fromPack)} aria-expanded={fromPack}>
            {t("fromPack")}
          </button>
        )}
      </div>
      {fromPack && (
        <PackAdder
          kinds={packKinds}
          initialKind={kind === "all" ? undefined : kind}
          campaignId={me.campaignId}
          ruleset={ruleset}
          act={act}
          onMade={(ids) => ids[0] && setOpenId(ids[0])}
          onClose={() => setFromPack(false)}
        />
      )}
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
      <div className="codex-layout">
        <ul className="list codex-list">
          {shown.length === 0 && <li className="dim">{entries.length === 0 ? t("empty") : t("noMatch")}</li>}
          {rows.map(({ entry: e, depth, inside }) => (
            <li
              key={e.id}
              className={depth > 0 ? "tree-child" : undefined}
              style={{ marginInlineStart: Math.max(0, depth - 1) * 12 }}
            >
              {/* The title on top (two lines at most, the whole of it in the name and on hover), then one line of chips. */}
              <button
                className="btn codex-row"
                aria-pressed={openId === e.id}
                onClick={() => setOpenId(openId === e.id ? null : e.id)}
                title={e.title}
              >
                <span className="codex-row-text">
                  <strong className="codex-row-title">{e.title}</strong>
                  <span className="codex-row-meta small">
                    <span>{t(`kind.${e.kind}`)}</span>
                    <EntryFieldChips ruleset={ruleset} entry={e} />
                    {e.status && <span className="chip">{t(`status.${e.status}`)}</span>}
                    <VisibilityBadge entry={e} />
                  </span>
                </span>
              </button>
              {inside > 0 && (
                <button
                  className="btn sm"
                  aria-expanded={!folded.has(e.id)}
                  aria-label={t(folded.has(e.id) ? "unfold" : "fold", { count: inside, title: e.title })}
                  onClick={handleFold(e.id)}
                >
                  {folded.has(e.id) ? "▸" : "▾"} {t("inside", { count: inside })}
                </button>
              )}
            </li>
          ))}
        </ul>
        {open && (
          <EntryEditor
            key={open.id}
            campaignId={me.campaignId}
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
            ruleset={ruleset}
            known={known}
            campaign={state.campaign.fields}
            books={books}
            requestPage={requestPage}
          />
        )}
      </div>
    </div>
  );
}
