// What this device has already been shown, kept per device so a reload keeps the NEW count (house decision #112).
// General on purpose: the notebook's count uses it now, the codex marks (#218) will too.

/** The key of one thing as it stands: a changed `stamp` (a new reveal) makes it unseen again. */
export const seenKey = ({ id, stamp }: { id: string; stamp: string | null }): string => `${id}:${stamp ?? ""}`;

/** How many keys are not in `seen`. `seen` null is the first visit on this device: nothing counts, the caller seeds. */
export const unseenCount = ({ keys, seen }: { keys: readonly string[]; seen: ReadonlySet<string> | null }): number =>
  seen === null ? 0 : keys.filter((k) => !seen.has(k)).length;

type Store = Pick<Storage, "getItem" | "setItem">;

/** The stored set, or null when nothing is stored or storage is unavailable (private mode, blocked site data). */
export function readSeen({ storageKey, storage }: { storageKey: string; storage?: Store }): Set<string> | null {
  try {
    const raw = (storage ?? localStorage).getItem(storageKey);
    if (raw === null) return null;
    const list: unknown = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return null;
  }
}

/** Stores the set; without storage the page's own memory keeps it until a reload. */
export function writeSeen({
  storageKey,
  keys,
  storage,
}: {
  storageKey: string;
  keys: readonly string[];
  storage?: Store;
}) {
  try {
    (storage ?? localStorage).setItem(storageKey, JSON.stringify(keys));
  } catch {
    // No storage: the count restarts when the page reloads.
  }
}
