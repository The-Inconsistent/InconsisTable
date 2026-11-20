"use client";
import { useTranslations } from "next-intl";
import { useState, type CSSProperties } from "react";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ApiMessage, readJson } from "@/lib/api-reply/api-reply";
import { HideReply, exportUrl, type WorldList as WorldListData } from "@/lib/library/library";

type WorldListProps = { worlds: WorldListData; canImport: boolean; onChanged: () => void };

// The owner's Worlds (house decision #65): a look a room can wear. Imported and exported as JSON only; no form.
export function WorldList({ worlds, canImport, onChanged }: WorldListProps) {
  const t = useTranslations("worldList");
  const tStatus = useTranslations("status");
  const tr = useRefusal();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // EXPORT: downloads the newest version as the importer takes it back.
  const handleExport = async ({ id, slug }: { id: string; slug: string }) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(exportUrl("world", id));
      if (!res.ok) {
        const refusal = ApiMessage.safeParse(await readJson(res));
        setError(refusal.success ? tr(refusal.data) : t("exportFailed"));
      } else {
        const url = URL.createObjectURL(await res.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = `${slug}.json`;
        link.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      setError(tStatus("nosignal"));
    }
    setBusy(null);
  };

  // DELETE: hides the World; it is removed for good once no room wears it.
  const handleDelete = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/worlds/${encodeURIComponent(id)}/hide`, { method: "POST" });
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

  if (worlds.length === 0) return <p className="dim">{t(canImport ? "empty" : "emptyCreatorsOnly")}</p>;
  return (
    <>
      <ul className="stack library-list rise-list">
        {worlds.map((w, i) => {
          const name = w.versions[0]?.name ?? w.slug;
          return (
            <li key={w.id} className="card" style={{ "--i": i } as CSSProperties}>
              <div className="row between">
                <strong className="card-name">{name}</strong>
                <span className="chip">{w.slug}</span>
              </div>
              <p className="row small">
                {w.versions.map((v) => (
                  <span key={v.id} className="chip">
                    {v.version}
                  </span>
                ))}
              </p>
              {w.disabled && (
                <p className="error" role="status">
                  {t("takenDown")}
                </p>
              )}
              <div className="row">
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy === w.id || w.disabled}
                  onClick={() => handleExport({ id: w.id, slug: w.slug })}
                  aria-label={t("exportLabel", { name })}
                >
                  {t("export")}
                </button>
                {confirming === w.id ? (
                  <>
                    <span className="small">{t("keepCopy")}</span>
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled={busy === w.id}
                      onClick={() => handleDelete(w.id)}
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
                    disabled={busy === w.id}
                    onClick={() => setConfirming(w.id)}
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
