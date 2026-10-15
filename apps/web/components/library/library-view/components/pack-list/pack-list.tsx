"use client";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ApiMessage, readJson } from "@/lib/api-reply/api-reply";
import { HideReply, formatBytes, type PackList as PackListData } from "@/lib/library/library";

type PackListProps = { packs: PackListData["packs"]; onChanged: () => void };

// The owner's packs: what each is, the credit its license asks for, and the two things they can do with it.
export function PackList({ packs, onChanged }: PackListProps) {
  const t = useTranslations("packList");
  const tStatus = useTranslations("status");
  const tr = useRefusal();
  const locale = useLocale();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // EXPORT: downloads the pack as the importer takes it back.
  const handleExport = async ({ id, slug }: { id: string; slug: string }) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/packs/${id}/export`);
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

  // DELETE: hides the pack; it is removed for good once no room uses it.
  const handleDelete = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/packs/${id}/hide`, { method: "POST" });
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

  if (packs.length === 0) return <p className="dim">{t("empty")}</p>;
  return (
    <>
      <ul className="stack library-list">
        {packs.map((p) => {
          const latest = p.versions[0];
          return (
            <li key={p.id} className="card">
              <div className="row between">
                <strong>{p.slug}</strong>
                <span className="row">
                  <span className="chip">{p.license}</span>
                  <span className="chip">{t("forRuleset", { slug: p.rulesetSlug })}</span>
                </span>
              </div>
              {latest && (
                <p className="small dim">
                  {t("latest", {
                    version: latest.version,
                    count: latest.entryCount,
                    size: formatBytes(latest.bytes, locale),
                  })}
                </p>
              )}
              {p.attribution && <p className="small credit">{t("credit", { text: p.attribution })}</p>}
              {p.disabled && (
                <p className="error" role="status">
                  {t("takenDown")}
                </p>
              )}
              <div className="row">
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy === p.id || p.disabled}
                  onClick={() => handleExport({ id: p.id, slug: p.slug })}
                  aria-label={t("exportLabel", { slug: p.slug })}
                >
                  {t("export")}
                </button>
                {confirming === p.id ? (
                  <>
                    <span className="small">{t("keepCopy")}</span>
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled={busy === p.id}
                      onClick={() => handleDelete(p.id)}
                      aria-label={t("confirmDeleteLabel", { slug: p.slug })}
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
                    disabled={busy === p.id}
                    onClick={() => setConfirming(p.id)}
                    aria-label={t("deleteLabel", { slug: p.slug })}
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
