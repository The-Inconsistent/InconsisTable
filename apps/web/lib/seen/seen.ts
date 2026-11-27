import type { CodexEntry } from "@inconsistable/core-schema";

import { newestRevealed } from "@/lib/codex/codex";

// What this device has already been shown, kept per device so a reload keeps the NEW count (house decision #112): the
// notebook tab's count, its INBOX and the archive's NEW marks (#218).
// ponytail: per-device marks, a server read mark per seat is the upgrade.

/** The key of one thing as it stands: a changed `stamp` (a new reveal) or `picture` (a newly shown one) makes it unseen
 * again. Without a picture the key is the one stored before pictures counted, so an upgrade floods nothing. */
export const seenKey = ({
  id,
  stamp,
  picture,
}: {
  id: string;
  stamp: string | null;
  picture?: string | null;
}): string => `${id}:${stamp ?? ""}${picture ? `#${picture}` : ""}`;

/** A codex entry's key: its last reveal and the picture this seat is shown (a phone gets `imageId` once it is shown). */
export const entrySeenKey = (e: Pick<CodexEntry, "id" | "revealedAt" | "imageId">): string =>
  seenKey({ id: e.id, stamp: e.revealedAt, picture: e.imageId });

/** How many keys are not in `seen`. `seen` null is the first visit on this device: nothing counts, the caller seeds. */
export const unseenCount = ({ keys, seen }: { keys: readonly string[]; seen: ReadonlySet<string> | null }): number =>
  seen === null ? 0 : keys.filter((k) => !seen.has(k)).length;

/** The marks of one list on this device. `set`: what is stored (null before the first visit). `fresh`: what was unseen
 * when it was marked during this viewing, which the INBOX and the NEW marks show until the viewer leaves or marks all
 * read. `marked`: the list `set` was last made from. */
export type SeenState = {
  set: ReadonlySet<string> | null;
  fresh: ReadonlySet<string>;
  marked: string | null;
  viewing: boolean;
};

const NONE: ReadonlySet<string> = new Set();

/** The state before the device's list is read. */
export const initialSeen = (set: ReadonlySet<string> | null): SeenState => ({
  set,
  fresh: NONE,
  marked: null,
  viewing: false,
});

// The marks once `keys` are listed (null: not loaded) and the list is or is not on screen; the same object when nothing
// changes. The first visit seeds with nothing fresh, so a new device is not flooded. Opening the list marks everything
// in it and keeps what was unseen in `fresh`; what arrives while it is open joins `fresh`; leaving forgets `fresh`.
export function nextSeen({
  state,
  keys,
  viewing,
}: {
  state: SeenState;
  keys: readonly string[] | null;
  viewing: boolean;
}): SeenState {
  if (keys === null) return state;
  const marked = keys.join("\n");
  if (state.set === null) return { set: new Set(keys), fresh: NONE, marked, viewing };
  if (!viewing) return state.viewing ? { ...state, fresh: NONE, viewing: false } : state;
  if (state.viewing && state.marked === marked) return state;
  const seen = state.set;
  const fresh = new Set([...(state.viewing ? state.fresh : []), ...keys.filter((k) => !seen.has(k))]);
  return { set: new Set(keys), fresh, marked, viewing: true };
}

/** MARK ALL READ: everything listed is seen, and nothing is fresh any more. */
export const markAllSeen = ({ state, keys }: { state: SeenState; keys: readonly string[] }): SeenState => ({
  ...state,
  set: new Set(keys),
  fresh: NONE,
  marked: keys.join("\n"),
});

/** The INBOX: the entries fresh as they stand now, newest revealed first, then those without a time. */
export const inboxEntries = ({
  entries,
  fresh,
}: {
  entries: readonly CodexEntry[];
  fresh: ReadonlySet<string>;
}): CodexEntry[] => newestRevealed(entries.filter((e) => fresh.has(entrySeenKey(e))));

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
