"use client";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type ChangeEvent } from "react";

import { ROOM_LIMITS, RoomDocument, type CodexEntry } from "@inconsistable/core-schema";

import type { Send } from "@/hooks/use-table/use-table";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { adventuresIn, planAdventures, UNSERVED_SOURCE, type Ids } from "@/lib/adventure-import/adventure-import";
import { ApiMessage, PictureSaved, readJson } from "@/lib/api-reply/api-reply";

type ImportAdventureProps = {
  campaignId: string;
  entries: readonly CodexEntry[];
  actors: readonly { id: string; name: string }[];
  send: Send;
};

// `unserved`: entries saved without the pack entry they came from, which this room is not served (#232).
type Progress = { done: number; total: number; stopped: string | null; finished: boolean; unserved: number };

// IMPORT ADVENTURE (house decision #103): the GM picks a room document on this device, which never sends it anywhere,
// picks the adventures to bring, reads what will be made and what the room already has by name, and confirms. The
// adventures come in as the table's ordinary codex actions, one at a time, the pictures through the picture upload;
// the first refusal stops the run and what was made stays, as any prep does. An entry whose pack entry this room is not
// served is saved without it and counted, rather than stopping the run (#232).
export function ImportAdventure({ campaignId, entries, actors, send }: ImportAdventureProps) {
  const t = useTranslations("importAdventure");
  const tKind = useTranslations("codex.kind");
  const tr = useRefusal();
  const fileId = useId();
  const [doc, setDoc] = useState<RoomDocument | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const running = progress !== null && !progress.finished && progress.stopped === null;
  const plan = useMemo(
    () => (doc ? planAdventures({ doc, picked, room: { entries, actors } }) : null),
    [doc, picked, entries, actors],
  );

  // A file picked: read and checked here; nothing of it leaves the device.
  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    setDoc(null);
    setPicked([]);
    setProgress(null);
    setProblem(null);
    if (!file) return;
    if (file.size > ROOM_LIMITS.bytes) return setProblem(t("tooLarge"));
    let parsed: ReturnType<typeof RoomDocument.safeParse> | null = null;
    try {
      parsed = RoomDocument.safeParse(JSON.parse(await file.text()));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) return setProblem(t("notADocument"));
    if (adventuresIn(parsed.data).length === 0) return setProblem(t("noAdventures"));
    setDoc(parsed.data);
  };
  const handlePick = (id: string) => (e: ChangeEvent<HTMLInputElement>) =>
    setPicked((was) => (e.target.checked ? [...was, id] : was.filter((x) => x !== id)));

  // Uploads one picture as the codex upload does and answers its id, or the refusal's words.
  const upload = async (mime: string, base64: string): Promise<{ id: string } | { error: string }> => {
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/images`, {
        method: "POST",
        headers: { "content-type": mime },
        body: new Blob([bytes], { type: mime }),
      });
      const body = await readJson(res);
      const saved = PictureSaved.safeParse(body);
      if (res.ok && saved.success) return { id: saved.data.id };
      const message = ApiMessage.safeParse(body);
      return { error: message.success ? tr(message.data) : t("pictureFailed") };
    } catch {
      return { error: t("pictureFailed") };
    }
  };

  // IMPORT: every step in order; the first refusal stops the run, except a pack entry the room is not served.
  const handleImport = async () => {
    if (!plan) return;
    const total = plan.steps.length;
    const ids: Ids = {};
    let unserved = 0;
    setProgress({ done: 0, total, stopped: null, finished: false, unserved });
    for (const [i, step] of plan.steps.entries()) {
      if (step.kind === "picture") {
        const r = await upload(step.mime, step.base64);
        if ("error" in r) return setProgress({ done: i, total, stopped: r.error, finished: false, unserved });
        ids[step.imageId] = r.id;
      } else {
        let r = await send(step.action(ids));
        if (!r.ok && step.withoutSource && r.code && UNSERVED_SOURCE.has(r.code)) {
          r = await send(step.withoutSource(ids));
          if (r.ok) unserved++;
        }
        if (!r.ok) return setProgress({ done: i, total, stopped: r.error, finished: false, unserved });
        if (step.makes && r.id) ids[step.makes] = r.id;
      }
      setProgress({ done: i + 1, total, stopped: null, finished: false, unserved });
    }
    setProgress({ done: total, total, stopped: null, finished: true, unserved });
    setPicked([]);
  };

  return (
    <section className="card stack" aria-busy={running}>
      <label className="btn" htmlFor={fileId} style={{ justifySelf: "start" }}>
        {t("open")}
      </label>
      <input
        id={fileId}
        className="sr-only"
        type="file"
        accept="application/json,.json"
        onChange={handleFile}
        disabled={running}
      />
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {doc && plan && (
        <div id="import-adventure" className="stack">
          <h3 className="head">{t("from", { name: doc.room.name })}</h3>
          <fieldset className="stack" disabled={running}>
            <legend className="small">{t("pick")}</legend>
            {adventuresIn(doc).map((a) => (
              <label key={a.id} className="row">
                <input type="checkbox" checked={picked.includes(a.id)} onChange={handlePick(a.id)} />
                <span>
                  {a.title} <span className="dim small">· {t("scenes", { count: a.scenes })}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {picked.length > 0 && (
            <div className="stack small">
              <p>{t("comesAsPrep")}</p>
              <p>
                <strong>{t("willMake", { count: plan.create.length })}</strong>{" "}
                {plan.create.map((e) => `${e.title} (${tKind(e.kind)})`).join(", ")}
              </p>
              {plan.link.length > 0 && (
                <p>
                  <strong>{t("willLink", { count: plan.link.length })}</strong>{" "}
                  {plan.link.map((e) => `${e.title} (${tKind(e.kind)})`).join(", ")}
                </p>
              )}
              {plan.pictures > 0 && <p>{t("pictures", { count: plan.pictures })}</p>}
              {plan.dropped > 0 && <p className="dim">{t("dropped", { count: plan.dropped })}</p>}
            </div>
          )}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn primary"
              onClick={handleImport}
              disabled={picked.length === 0 || running}
              aria-busy={running}
            >
              {t("import", { count: picked.length })}
            </button>
            <button type="button" className="btn" onClick={() => setDoc(null)} disabled={running}>
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
      {progress && (
        <p className={progress.stopped ? "error" : "small"} role={progress.stopped ? "alert" : "status"}>
          {progress.stopped
            ? t("stopped", { done: progress.done, total: progress.total, why: progress.stopped })
            : progress.finished
              ? t("finished", { total: progress.total })
              : t("progress", { done: progress.done, total: progress.total })}
        </p>
      )}
      {progress && progress.unserved > 0 && <p className="small dim">{t("unserved", { count: progress.unserved })}</p>}
    </section>
  );
}
