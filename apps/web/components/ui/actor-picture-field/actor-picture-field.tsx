"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Actor } from "@inconsistable/core-schema";

import { ActorPicture } from "@/components/ui/actor-picture/actor-picture";
import { PictureField } from "@/components/ui/picture-field/picture-field";
import type { Send } from "@/hooks/use-table/use-table";
import { actorPictureUploadUrl } from "@/lib/entry-picture/entry-picture";

type ActorPictureFieldProps = {
  campaignId: string;
  actor: Actor;
  send: Send;
  className?: string;
};

// A character's PICTURE, for the seat holding it or its GM side (house decision #155): add, replace or remove it, and
// show it to the table or hold it back, through actor.picture.
export function ActorPictureField({ campaignId, actor, send, className }: ActorPictureFieldProps) {
  const t = useTranslations("sheet");
  const [error, setError] = useState<string | null>(null);

  // Attaches the uploaded picture, or none; a refusal shows under the field.
  const handleAttach = async (imageId: string | null) => {
    const r = await send({ type: "actor.picture", actorId: actor.id, imageId });
    setError(r.ok ? null : r.error);
  };

  // The switch: whether the whole table sees it.
  const handleShow = async (imageRevealed: boolean) => {
    const r = await send({ type: "actor.picture", actorId: actor.id, imageRevealed });
    setError(r.ok ? null : r.error);
  };

  return (
    <>
      <PictureField
        className={className}
        legend={t("picture", { name: actor.name })}
        imageId={actor.imageId}
        shown={actor.imageRevealed ?? false}
        preview={<ActorPicture campaignId={campaignId} actor={actor} portrait />}
        uploadUrl={actorPictureUploadUrl({ campaignId, actorId: actor.id })}
        can={{ write: true, reveal: true }}
        onAttach={handleAttach}
        onShow={handleShow}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
