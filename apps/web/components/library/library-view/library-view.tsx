"use client";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";

import { PageHead } from "@/components/ui/page-head/page-head";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ApiMessage, readJson } from "@/lib/api-reply/api-reply";
import {
  exportUrl,
  formatBytes,
  type PackList as PackListData,
  type RulesetList,
  type WorldList as WorldListData,
} from "@/lib/library/library";
import { newPack, newRuleset, stripNulls, type Doc, type FormKind } from "@/lib/manifest-form/manifest-form";

import { ImportPanel } from "./components/import-panel/import-panel";
import { ManifestForm } from "./components/manifest-form/manifest-form";
import { PackList } from "./components/pack-list/pack-list";
import { WorldList } from "./components/world-list/world-list";

type OpenForm = { kind: FormKind; doc: Doc; editing: boolean; n: number };

// canImport: the caller is a creator (the lobby's canCreate). With sign-in on, an anonymous device is not one, and
// the api refuses its imports and saves, so neither the importer nor the form is offered.
type LibraryViewProps = { rulesets: RulesetList; packs: PackListData; worlds: WorldListData; canImport: boolean };

// MY RULESETS, PACKS & WORLDS: everything the device's user imported. Nothing here is shared; a room can use what its
// owner imported, and a private pack or a World only in rooms its owner runs.
export function LibraryView({ rulesets, packs, worlds, canImport }: LibraryViewProps) {
  const t = useTranslations("library");
  const tWs = useTranslations("workspace");
  const locale = useLocale();
  const router = useRouter();
  const { usage } = packs;
  const [importing, setImporting] = useState(canImport && rulesets.length === 0);
  const [toggled, setToggled] = useState(false);
  const [form, setForm] = useState<OpenForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tr = useRefusal();
  const rulesetIds = rulesets.map((r) => r.slug);
  const ownRulesets = rulesets.map((r) => ({ id: r.id, slug: r.slug }));

  // IMPORT in the head: shows or folds the importer, and moves the cursor into it when it opens.
  const handleToggle = () => {
    setImporting(!importing);
    setToggled(true);
  };
  const handleChanged = () => router.refresh();

  // NEW / OPEN: the guided form over a document; `n` makes each opening a fresh form, not the last one edited on.
  const openForm = ({ kind, doc, editing }: { kind: FormKind; doc: Doc; editing: boolean }) => {
    setError(null);
    setForm((prev) => ({ kind, doc, editing, n: (prev?.n ?? 0) + 1 }));
  };
  const handleNewRuleset = () => openForm({ kind: "ruleset", doc: newRuleset(), editing: false });
  const handleNewPack = () => openForm({ kind: "pack", doc: newPack({ rulesetId: rulesetIds[0] }), editing: false });
  // The importer's document opens in the form as it is (a template, a pasted draft).
  const handleOpenDoc = ({ kind, doc }: { kind: FormKind; doc: Doc }) => openForm({ kind, doc, editing: false });
  // EDIT a ruleset or pack: its newest version comes back from the owner's export and opens in the form; saving adds a
  // version (the form's validator and the server both want the version raised).
  const handleEdit = async (kind: FormKind, id: string) => {
    setError(null);
    try {
      const res = await fetch(exportUrl(kind, id));
      const body: unknown = await readJson(res);
      const refusal = ApiMessage.safeParse(body);
      if (!res.ok) return setError(refusal.success ? tr(refusal.data) : t("editFailed"));
      const doc = stripNulls(body);
      if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return setError(t("editFailed"));
      openForm({ kind, doc: doc as Doc, editing: true });
    } catch {
      setError(t("editFailed"));
    }
  };

  return (
    <main className="page library">
      <PageHead title={t("title")} lede={tWs("lede.library")}>
        {canImport && (
          <div className="row">
            <button type="button" className="btn primary" onClick={handleNewRuleset}>
              {t("newRuleset")}
            </button>
            <button type="button" className="btn primary" onClick={handleNewPack} disabled={rulesets.length === 0}>
              {t("newPack")}
            </button>
            <button
              type="button"
              className="btn"
              aria-expanded={importing}
              aria-controls="import-panel"
              onClick={handleToggle}
            >
              {tWs("importToggle")}
            </button>
          </div>
        )}
      </PageHead>
      {form && (
        <ManifestForm
          key={form.n}
          kind={form.kind}
          initial={form.doc}
          editing={form.editing}
          rulesets={ownRulesets}
          onClose={() => setForm(null)}
          onSaved={handleChanged}
        />
      )}
      {canImport && importing && <ImportPanel onSaved={handleChanged} autoFocus={toggled} onOpenForm={handleOpenDoc} />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="stack">
        <h2 className="head">
          {t("rulesets")} <span className="ws-tally">{rulesets.length}</span>
        </h2>
        {rulesets.length === 0 ? (
          <p className="dim">{t(canImport ? "noRulesets" : "noRulesetsCreatorsOnly")}</p>
        ) : (
          <ul className="grid library-list rise-list">
            {rulesets.map((r, i) => (
              <li key={r.id} className="card" style={{ "--i": i } as CSSProperties}>
                <strong className="card-name">{r.slug}</strong>
                <p className="row small">
                  {r.versions.map((v) => (
                    <span key={v.id} className="chip">
                      {v.version}
                    </span>
                  ))}
                </p>
                <div className="row">
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => handleEdit("ruleset", r.id)}
                    aria-label={t("editRulesetLabel", { slug: r.slug })}
                  >
                    {t("edit")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack">
        <h2 className="head">
          {t("packs")} <span className="ws-tally">{packs.packs.length}</span>
        </h2>
        <p className="small dim">
          {t("usage", {
            packs: usage.packs,
            maxPacks: usage.maxPacks,
            bytes: formatBytes(usage.bytes, locale),
            maxBytes: formatBytes(usage.maxBytes, locale),
          })}
        </p>
        <PackList
          packs={packs.packs}
          canImport={canImport}
          onChanged={handleChanged}
          onEdit={(id) => handleEdit("pack", id)}
        />
      </section>

      <section className="stack">
        <h2 className="head">
          {t("worlds")} <span className="ws-tally">{worlds.length}</span>
        </h2>
        <p className="small dim">{t("worldsHint")}</p>
        <WorldList worlds={worlds} canImport={canImport} onChanged={handleChanged} />
      </section>
    </main>
  );
}
