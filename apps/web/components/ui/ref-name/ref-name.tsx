"use client";
import { Suspense, use, type ReactNode } from "react";

import { readEntries } from "@/hooks/use-pack-entry/use-pack-entry";
import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { entryUrl } from "@/lib/entry-fields/entry-fields";
import { readName } from "@/lib/ref-name/ref-name";

type RefNameProps = {
  /** The room whose rules read names the entry; null where nothing is read (the table screen). */
  campaignId: string | null;
  type: string;
  entryKey: string;
  /** The name the page already holds, when it does: nothing is read then. */
  name: string | undefined;
  /** False where no read may start yet (a closed card in a list): the key shows. */
  read?: boolean;
  /** Draws the name (the key while it is unknown). */
  children: (name: string) => ReactNode;
};

// A ref field's pack entry by its name: the one the page holds, else the seat-scoped rules read of its key (read once
// per key for the session), and the key itself while that is unknown or when the seat may not read the entry.
export function RefName({ campaignId, type, entryKey, name, read = true, children }: RefNameProps) {
  if (name !== undefined || campaignId === null || !read) return children(name ?? entryKey);
  return (
    <Suspense fallback={children(entryKey)}>
      <ReadName url={entryUrl({ campaignId, type, key: entryKey })} entryKey={entryKey}>
        {children}
      </ReadName>
    </Suspense>
  );
}

function ReadName({ url, entryKey, children }: { url: string; entryKey: string; children: RefNameProps["children"] }) {
  const tr = useRefusal();
  // The server never reads (its cache would outlive the request): it draws the key, as the client does until it knows.
  if (typeof window === "undefined") return children(entryKey);
  const name = use(readName({ url, key: entryKey, read: (u) => readEntries({ url: u, fallback: "", tr }) }));
  return children(name ?? entryKey);
}
