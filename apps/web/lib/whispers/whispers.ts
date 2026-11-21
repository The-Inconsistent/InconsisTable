import type { Whisper, WhisperReader } from "@inconsistable/core-schema";

/** One whisper as one of its readers has it. */
export type Unread = { whisper: Whisper; reader: WhisperReader; key: string };

/** The whispers this seat has not read, oldest first, one per reader, leaving out those closed on this page. */
export const unreadOf = ({
  whispers,
  closed,
}: {
  whispers: readonly Whisper[];
  closed: ReadonlySet<string>;
}): Unread[] =>
  [...whispers]
    .reverse()
    .flatMap((whisper) =>
      whisper.readers
        .filter((r) => r.readAt === null)
        .map((reader) => ({ whisper, reader, key: `${whisper.id}:${reader.actorId}` })),
    )
    .filter((u) => !closed.has(u.key));

/** A key per reply as it stands: a changed reply is a new key, so it counts as unseen again. */
export const replyKeys = (whispers: readonly Whisper[]): string[] =>
  whispers.flatMap((w) =>
    w.readers.flatMap((r) => (r.repliedAt === null ? [] : [`${w.id}:${r.actorId}:${r.repliedAt}`])),
  );
