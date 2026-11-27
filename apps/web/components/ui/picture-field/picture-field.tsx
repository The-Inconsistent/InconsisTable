"use client";
import { useTranslations } from "next-intl";
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ApiMessage, PictureSaved, readJson } from "@/lib/api-reply/api-reply";
import { shrinkPicture } from "@/lib/entry-picture/entry-picture";

type PictureFieldProps = {
  /** The picture this seat received, if any. */
  imageId: string | null | undefined;
  /** Whether the table sees it. */
  shown: boolean;
  /** The picture as its surface draws it. */
  preview: ReactNode;
  /** Where the bytes go: the room's route for an entry, the actor's for a character (house decisions #70, #155). */
  uploadUrl: string;
  can: { write: boolean; reveal: boolean };
  /** Attaches the uploaded picture, or none. */
  onAttach: (imageId: string | null) => Promise<unknown>;
  /** Shows the picture to the table or holds it back. */
  onShow: (shown: boolean) => Promise<unknown>;
  /** The legend; the codex's PICTURE when absent. */
  legend?: string;
  className?: string;
};

// PICTURE: add, replace or remove a picture, and show it to the table apart from what it hangs on. A picked file is
// shrunk on this device, uploaded, then attached at once.
export function PictureField({
  imageId,
  shown,
  preview,
  uploadUrl,
  can,
  onAttach,
  onShow,
  legend,
  className = "stack",
}: PictureFieldProps) {
  const t = useTranslations("codex");
  const tr = useRefusal();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Uploads the bytes and answers the new id, or null after showing why not.
  const upload = async (picture: Blob) => {
    try {
      const res = await fetch(uploadUrl, { method: "POST", headers: { "content-type": picture.type }, body: picture });
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

  // A file picked: shrink it, upload it, attach it in place of any picture there was.
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
    if (id) await onAttach(id);
    setBusy(false);
  };

  return (
    <fieldset className={className}>
      <legend>{legend ?? t("picture")}</legend>
      {imageId ? preview : <p className="dim small">{t("noPicture")}</p>}
      {can.write && (
        <div className="row">
          <input ref={input} type="file" accept="image/*" hidden onChange={handlePick} />
          <button className="btn" disabled={busy} onClick={() => input.current?.click()}>
            {imageId ? t("replacePicture") : t("addPicture")}
          </button>
          {imageId && (
            <button className="btn" disabled={busy} onClick={() => onAttach(null)}>
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
      {can.reveal && imageId && (
        <label className="row">
          <input type="checkbox" role="switch" checked={shown} onChange={(e) => onShow(e.target.checked)} />
          {t("showPicture")}
        </label>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
