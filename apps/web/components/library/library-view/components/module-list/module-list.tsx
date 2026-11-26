"use client";
import { useTranslations } from "next-intl";
import { useState, type CSSProperties } from "react";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ApiMessage, readJson } from "@/lib/api-reply/api-reply";
import { HideReply, exportUrl, type ModuleList as ModuleListData } from "@/lib/library/library";

type ModuleListProps = { modules: ModuleListData; canImport: boolean; onChanged: () => void };

// The owner's game modules (house decisions #122 to #125): the parts that make one game, each listed with its version.
// Imported and exported as JSON only; the export is the list, never the documents. Deleting one leaves its parts.
export function ModuleList({ modules, canImport, onChanged }: ModuleListProps) {
  const t = useTranslations("moduleList");
  const tStatus = useTranslations("status");
  const tr = useRefusal();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // EXPORT: downloads the newest version, each part with its hash, as the importer takes it back.
  const handleExport = async ({ id, slug }: { id: string; slug: string }) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(exportUrl("module", id));
      if (!res.ok) {
        const refusal = ApiMessage.safeParse(await readJson(res));
        setError(refusal.success ? tr(refusal.data) : t("exportFailed"));
      } else {
        const url = URL.createObjectURL(await res.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = `${slug}.module.json`;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      setError(tStatus("nosignal"));
    }
    setBusy(null);
  };

  // DELETE: removes the module at once; its ruleset, packs and World stay, and so do the rooms made from it.
  const handleDelete = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/modules/${encodeURIComponent(id)}/hide`, { method: "POST" });
      const body = HideReply.safeParse(await readJson(res));
      if (res.ok && body.success) {
        setConfirming(null);
        onChanged();
      } else setError(t("deleteFailed"));
    } catch {
      setError(tStatus("nosignal"));
    }
    setBusy(null);
  };

  if (modules.length === 0) return <p className="dim">{t(canImport ? "empty" : "emptyCreatorsOnly")}</p>;
  return (
    <>
      <ul className="stack library-list rise-list">
        {modules.map((m, i) => {
          const newest = m.versions[0];
          const name = newest?.name ?? m.slug;
          return (
            <li key={m.id} className="card" style={{ "--i": i } as CSSProperties}>
              <div className="row between">
                <strong className="card-name">{name}</strong>
                <span className="chip">{m.slug}</span>
              </div>
              <p className="row small">
                {m.versions.map((v) => (
                  <span key={v.id} className="chip">
                    {v.version}
                  </span>
                ))}
              </p>
              {newest && (
                <p className="small dim">
                  {t("parts", {
                    ruleset: `${newest.ruleset.slug} ${newest.ruleset.version}`,
                    packs: newest.packs.length,
                    world: newest.world ? `${newest.world.slug} ${newest.world.version}` : "none",
                  })}
                </p>
              )}
              <div className="row">
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy === m.id}
                  onClick={() => handleExport({ id: m.id, slug: m.slug })}
                  aria-label={t("exportLabel", { name })}
                >
                  {t("export")}
                </button>
                {confirming === m.id ? (
                  <>
                    <span className="small">{t("keepParts")}</span>
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled={busy === m.id}
                      onClick={() => handleDelete(m.id)}
                      aria-label={t("confirmDeleteLabel", { name })}
                    >
                      {t("delete")}
                    </button>
                    <button type="button" className="btn sm" onClick={() => setConfirming(null)}>
                      {t("keep")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy === m.id}
                    onClick={() => setConfirming(m.id)}
                    aria-label={t("deleteLabel", { name })}
                  >
                    {t("delete")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
