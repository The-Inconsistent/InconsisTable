import type { RulesEntry } from "@/lib/library/library";

/** The name of a pack entry this seat already holds (the page's own read or a picker's results), or undefined. */
export function knownName({ known, type, key }: { known: readonly RulesEntry[]; type: string; key: string }) {
  return known.find((k) => k.type === type && k.key === key)?.name;
}

const entries = new Map<string, Promise<RulesEntry | null>>();
const names = new Map<string, Promise<string | null>>();

/**
 * A pack entry by the seat-scoped rules read of its URL (type and key), read once per URL for the session. Null when the
 * seat may not read the entry, the room no longer serves it, or the read failed.
 */
// ponytail: a failed read stays unknown until the page reloads, retry on a later open if refusals turn out transient;
// a pack update reaches an entry read here after a reload (the page's own `known` entries follow sooner).
export function readEntry({
  url,
  key,
  read,
}: {
  url: string;
  key: string;
  read: (url: string) => Promise<readonly RulesEntry[]>;
}): Promise<RulesEntry | null> {
  const cached = entries.get(url);
  if (cached) return cached;
  const lookup = async () => {
    try {
      return (await read(url)).find((e) => e.key === key) ?? null;
    } catch {
      return null;
    }
  };
  const found = lookup();
  entries.set(url, found);
  return found;
}

/** A ref's entry name by `readEntry`: null where the field then shows the key. */
export function readName(args: Parameters<typeof readEntry>[0]): Promise<string | null> {
  const cached = names.get(args.url);
  if (cached) return cached;
  const named = readEntry(args).then((e) => e?.name ?? null);
  names.set(args.url, named);
  return named;
}
