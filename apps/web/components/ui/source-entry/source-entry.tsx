"use client";
import { Suspense, use, type ReactNode } from "react";

import { readEntries } from "@/hooks/use-pack-entry/use-pack-entry";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { entryUrl, type EntryRow } from "@/lib/entry-fields/entry-fields";
import type { RulesEntry } from "@/lib/library/library";
import { readEntry } from "@/lib/ref-name/ref-name";

type SourceEntryProps = {
  /** The room whose rules read the entry; null where nothing is read (the table screen). */
  campaignId: string | null;
  /** The pack entry a row was filled from; none for a row written by hand. */
  from: EntryRow["from"];
  /** Pack entries this seat already read: nothing is read for one of them. */
  known: readonly RulesEntry[];
  /** Draws with the entry, or without it while it is unknown or when this seat may not read it. */
  children: (entry: RulesEntry | undefined) => ReactNode;
};

// The pack entry a row follows (house decision #89): the one the page holds, else the seat-scoped rules read of its
// key (read once per key for the session). The rules read serves only what this seat may read, so a row never shows
// an entry the seat may not read: it draws the GM's own cells then.
export function SourceEntry({ campaignId, from, known, children }: SourceEntryProps) {
  const held = from && known.find((k) => k.type === from.entity && k.key === from.key);
  if (!from || held || campaignId === null) return children(held);
  return (
    <Suspense fallback={children(undefined)}>
      <ReadEntry url={entryUrl({ campaignId, type: from.entity, key: from.key })} entryKey={from.key}>
        {children}
      </ReadEntry>
    </Suspense>
  );
}

function ReadEntry({
  url,
  entryKey,
  children,
}: {
  url: string;
  entryKey: string;
  children: SourceEntryProps["children"];
}) {
  const tr = useRefusal();
  // The server never reads (its cache would outlive the request): it draws the GM's cells, as the client does until it knows.
  if (typeof window === "undefined") return children(undefined);
  const entry = use(readEntry({ url, key: entryKey, read: (u) => readEntries({ url: u, fallback: "", tr }) }));
  return children(entry ?? undefined);
}
