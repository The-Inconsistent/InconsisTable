import type { Actor } from "@inconsistable/core-schema";

import { pictureUrl } from "@/lib/entry-picture/entry-picture";

type ActorPictureProps = {
  campaignId: string;
  actor: Pick<Actor, "name" | "imageId">;
  /** The sheet's portrait; a row's thumbnail beside the name otherwise, which says nothing the name does not. */
  portrait?: boolean;
};

// A character's picture, when this seat received its id: the server sends it only to a seat that may see it (house
// decision #155).
export function ActorPicture({ campaignId, actor, portrait = false }: ActorPictureProps) {
  if (!actor.imageId) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the api to this seat only; nothing to optimise
    <img
      className={portrait ? "actor-picture" : "actor-thumb"}
      src={pictureUrl({ campaignId, imageId: actor.imageId })}
      alt={portrait ? actor.name : ""}
      loading="lazy"
    />
  );
}
