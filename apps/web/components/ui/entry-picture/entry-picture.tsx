import type { CodexEntry } from "@inconsistable/core-schema";

import { pictureUrl } from "@/lib/entry-picture/entry-picture";

type EntryPictureProps = { campaignId: string; entry: CodexEntry };

// An entry's picture, when this seat received its id: the server sends the id only to a seat that may see it.
export function EntryPicture({ campaignId, entry }: EntryPictureProps) {
  if (!entry.imageId) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by the api to this seat only; nothing to optimise
    <img
      className="entry-picture"
      src={pictureUrl({ campaignId, imageId: entry.imageId })}
      alt={entry.title}
      loading="lazy"
    />
  );
}
