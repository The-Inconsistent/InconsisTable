"use client";
import { useTranslations } from "next-intl";
import { useRef, useState, type ChangeEvent } from "react";

import type { ActionInput, CodexEntry } from "@inconsistable/core-schema";

import { EntryPicture } from "@/components/ui/entry-picture/entry-picture";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ApiMessage, PictureSaved, readJson } from "@/lib/api-reply/api-reply";
import { shrinkPicture } from "@/lib/entry-picture/entry-picture";

type PictureFieldProps = {
  campaignId: string;
  entry: CodexEntry;
  can: { write: boolean; reveal: boolean };
  act: (a: ActionInput) => Promise<{ ok: boolean }>;
};

// PICTURE: add, replace or remove the entry's picture, and show it to the table apart from the entry itself. A picked
// file is shrunk on this device, uploaded, then attached at once (house decision #70).
export function PictureField({ campaignId, entry, can, act }: PictureFieldProps) {
  const t = useTranslations("codex");
  const tr = useRefusal();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Uploads the bytes and answers the new id, or null after showing why not.
  const upload = async (picture: Blob) => {
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/images`, {
        method: "POST",
        headers: { "content-type": picture.type },
        body: picture,
      });
      const body = await readJson(res);
      const saved = PictureSaved.safeParse(body);
      if (res.ok && saved.success) return saved.data.id;
      const message = ApiMessage.safeParse(body);
      setError(message.success ? tr(message.data) : t("pictureFailed"));
    } catch {
      setError(t("pictureFailed"));
    }
    return null;
  };

  // A file picked: shrink it, upload it, attach it in place of any picture the entry had.
  const handlePick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    let picture: Blob | null = null;
    try {
      picture = await shrinkPicture(file);
    } catch {
      setError(t("pictureUnreadable"));
    }
    const id = picture && (await upload(picture));
    if (id) await act({ type: "codex.save", id: entry.id, kind: entry.kind, imageId: id });
    setBusy(false);
  };

  // REMOVE: the entry keeps no picture; the server deletes it when nothing else uses it.
  const handleRemove = async () => {
    await act({ type: "codex.save", id: entry.id, kind: entry.kind, imageId: null });
  };

  // The switch: whether the table sees the picture, apart from who reads the entry.
  const handleShow = async (e: ChangeEvent<HTMLInputElement>) => {
    await act({ type: "codex.reveal", id: entry.id, imageRevealed: e.target.checked });
  };

  return (
    <fieldset className="stack">
      <legend>{t("picture")}</legend>
      {entry.imageId ? (
        <EntryPicture campaignId={campaignId} entry={entry} />
      ) : (
        <p className="dim small">{t("noPicture")}</p>
      )}
      {can.write && (
        <div className="row">
          <input ref={input} type="file" accept="image/*" hidden onChange={handlePick} />
          <button className="btn" disabled={busy} onClick={() => input.current?.click()}>
            {entry.imageId ? t("replacePicture") : t("addPicture")}
          </button>
          {entry.imageId && (
            <button className="btn" disabled={busy} onClick={handleRemove}>
              {t("removePicture")}
            </button>
          )}
        </div>
      )}
      {busy && (
        <p className="dim small" role="status">
          {t("pictureWorking")}
        </p>
      )}
      {can.reveal && entry.imageId && (
        <label className="row">
          <input type="checkbox" role="switch" checked={entry.imageRevealed} onChange={handleShow} />
          {t("showPicture")}
        </label>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
