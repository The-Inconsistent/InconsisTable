"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";

import { ActorKind, CodexKind, ROOM_LIMITS, type RoomImportExpect } from "@inconsistable/core-schema";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { importRoom, type RoomImport } from "@/lib/room-import/room-import";

// What the document expects, each with whether the importer holds it (a word, never a colour alone).
function Expects({ expects }: { expects: RoomImportExpect[] }) {
  const t = useTranslations("importRoom");
  if (!expects.length) return <p className="small dim">{t("noRuleset")}</p>;
  return (
    <ul className="stack small" style={{ margin: 0, paddingLeft: "1.2em" }}>
      {expects.map((e) => (
        <li key={`${e.what}/${e.slug}`}>
          {t(`what.${e.what}`)} <strong>{e.slug}</strong> {e.version} ·{" "}
          <span className="chip">{e.imported ? t("imported") : t("missing")}</span>
        </li>
      ))}
    </ul>
  );
}

// IMPORT A ROOM: a room document becomes a new room the caller owns and runs as GM (house decision #74). The file goes
// to the api as it is for a dry run, which says what it would make or the first problem by its path; then the caller
// confirms and the room opens.
export function ImportRoom() {
  const t = useTranslations("importRoom");
  const tActor = useTranslations("workspace.kind");
  const tEntry = useTranslations("codex.kind");
  const tr = useRefusal();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<RoomImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);

  // The dry run of a file, as a fresh start or not (house decision #103).
  const check = async (picked: File | null, asFresh: boolean) => {
    setResult(null);
    setFailed(false);
    setTooLarge(false);
    if (!picked) return;
    // The api refuses a document over its cap; say so before sending it (Auspex P126).
    if (picked.size > ROOM_LIMITS.bytes) return setTooLarge(true);
    setBusy(true);
    try {
      setResult(await importRoom({ file: picked, dryRun: true, fresh: asFresh }));
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };
  // A file picked: its dry run, at once.
  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    void check(picked, fresh);
  };
  // FRESH START switched: the dry run again, since it changes what the room holds.
  const handleFresh = (e: ChangeEvent<HTMLInputElement>) => {
    setFresh(e.target.checked);
    void check(file, e.target.checked);
  };
  // IMPORT: the document for real; the new room opens on success, a refusal shows in place of the dry run.
  const handleConfirm = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await importRoom({ file, dryRun: false, fresh });
      if (r.ok && r.reply.campaignId) return router.push(`/c/${r.reply.campaignId}`);
      setResult(r);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  const reply = result?.ok ? result.reply : null;
  const refusal = result && !result.ok ? result.refusal : null;
  return (
    <section id="import-room" className="card stack" aria-busy={busy}>
      <h2 className="head">{t("title")}</h2>
      <p className="small dim">{t("lede")}</p>
      <label>
        {t("file")}
        <input type="file" accept="application/json,.json" onChange={handleFile} disabled={busy} />
      </label>
      <label className="row small">
        <input type="checkbox" checked={fresh} onChange={handleFresh} disabled={busy} />
        {t("fresh")}
      </label>
      {busy && !reply && <p className="small">{t("checking")}</p>}
      {reply && (
        <div className="stack">
          <h3 className="head">{reply.name}</h3>
          <Expects expects={reply.expects} />
          <p className="small">{t("makesTable")}</p>
          <div className="row small" style={{ flexWrap: "wrap" }}>
            {ActorKind.options.map((kind) =>
              reply.counts.actors[kind] ? (
                <span key={kind} className="chip">
                  {t("count", { kind: tActor(kind), count: reply.counts.actors[kind] })}
                </span>
              ) : null,
            )}
            <span className="chip">{t("sessions", { count: reply.counts.sessions })}</span>
            <span className="chip">{t("clocks", { count: reply.counts.clocks })}</span>
          </div>
          <p className="small">{t("makesCodex")}</p>
          <div className="row small" style={{ flexWrap: "wrap" }}>
            {CodexKind.options.map((kind) =>
              reply.counts.entries[kind] ? (
                <span key={kind} className="chip">
                  {t("count", { kind: tEntry(kind), count: reply.counts.entries[kind] })}
                </span>
              ) : null,
            )}
            <span className="chip">{t("pictures", { count: reply.counts.pictures })}</span>
          </div>
          <div className="row">
            <button type="button" className="btn primary" onClick={handleConfirm} disabled={busy} aria-busy={busy}>
              {busy ? t("importing") : t("confirm")}
            </button>
          </div>
        </div>
      )}
      {result && !result.ok && (
        <div className="stack" role="alert">
          {refusal?.name && <h3 className="head">{refusal.name}</h3>}
          {refusal?.expects && <Expects expects={refusal.expects} />}
          <p className="error">
            {refusal ? tr(refusal) : t("failed")}
            {refusal?.path && (
              <span className="small" style={{ display: "block" }}>
                {t("at", { path: refusal.path })}
              </span>
            )}
          </p>
        </div>
      )}
      {tooLarge && (
        <p className="error" role="alert">
          {t("tooLarge")}
        </p>
      )}
      {failed && (
        <p className="error" role="alert">
          {t("failed")}
        </p>
      )}
    </section>
  );
}
