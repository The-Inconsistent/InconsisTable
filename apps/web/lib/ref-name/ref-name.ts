import type { RulesEntry } from "@/lib/library/library";

/** The name of a pack entry this seat already holds (the page's own read or a picker's results), or undefined. */
export function knownName({ known, type, key }: { known: readonly RulesEntry[]; type: string; key: string }) {
  return known.find((k) => k.type === type && k.key === key)?.name;
}

const names = new Map<string, Promise<string | null>>();

/**
 * A ref's entry name by the seat-scoped rules read of its URL (type and key), read once per URL for the session. Null
 * when the seat may not read the entry, the room no longer serves it, or the read failed: the field then shows the key.
 */
// ponytail: a failed read stays the key until the page reloads, retry on a later open if refusals turn out transient.
export function readName({
  url,
  key,
  read,
}: {
  url: string;
  key: string;
  read: (url: string) => Promise<readonly RulesEntry[]>;
}): Promise<string | null> {
  const cached = names.get(url);
  if (cached) return cached;
  const lookup = async () => {
    try {
      const entries = await read(url);
      return entries.find((e) => e.key === key)?.name ?? null;
    } catch {
      return null;
    }
  };
  const named = lookup();
  names.set(url, named);
  return named;
}
