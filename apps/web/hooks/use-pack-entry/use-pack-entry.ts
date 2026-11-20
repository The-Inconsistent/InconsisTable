"use client";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { useRefusal } from "@/hooks/use-refusal/use-refusal";
import { ApiMessage, readJson } from "@/lib/api-reply/api-reply";
import { RulesReply, type RulesEntry } from "@/lib/library/library";

/** The entries a seat-scoped rules read answers. Throws the api's own words (or `fallback`) when it refuses. */
export async function readEntries({
  url,
  fallback,
  tr,
}: {
  url: string;
  fallback: string;
  tr: ReturnType<typeof useRefusal>;
}): Promise<RulesEntry[]> {
  const res = await fetch(url);
  const body = await readJson(res);
  const parsed = RulesReply.safeParse(body);
  if (res.ok && parsed.success) return parsed.data.entries;
  const refusal = ApiMessage.safeParse(body);
  throw new Error(refusal.success ? tr(refusal.data) : fallback);
}

/** A pack entry a ref field opened: the entry, or null when the room no longer serves it; or the read's error. */
export type OpenedEntry = { title: string; entry: RulesEntry | null; error: string | null };

// Opens one pack entry by its rules-route URL (a codex ref field's type and key) for the sheet that shows it.
export function usePackEntry() {
  const tr = useRefusal();
  const fallback = useTranslations("entryFields")("readFailed");
  const [opened, setOpened] = useState<OpenedEntry | null>(null);
  const openEntry = useCallback(
    async ({ url, title, known }: { url: string; title: string; known?: RulesEntry }) => {
      if (known !== undefined) {
        setOpened({ title, entry: known, error: null });
        return;
      }
      try {
        const [entry = null] = await readEntries({ url, fallback, tr });
        setOpened({ title, entry, error: null });
      } catch (err) {
        setOpened({ title, entry: null, error: err instanceof Error ? err.message : fallback });
      }
    },
    [fallback, tr],
  );
  const close = useCallback(() => setOpened(null), []);
  return { opened, openEntry, close };
}
