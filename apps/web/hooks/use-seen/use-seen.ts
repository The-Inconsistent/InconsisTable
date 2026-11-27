"use client";
import { useEffect, useState } from "react";

import { initialSeen, markAllSeen, nextSeen, readSeen, unseenCount, writeSeen } from "@/lib/seen/seen";

/**
 * What this device has not been shown of `keys` (null: not loaded yet). `count`: how many, 0 while `viewing` (the thing
 * is on screen), which marks everything it lists. `fresh`: what was unseen when this viewing marked it, kept until the
 * viewer leaves or calls `markAll` (MARK ALL READ). The first visit seeds the list, so nothing is fresh.
 */
export function useSeen({
  storageKey,
  keys,
  viewing,
}: {
  storageKey: string;
  keys: readonly string[] | null;
  viewing: boolean;
}): { count: number; fresh: ReadonlySet<string>; markAll: () => void } {
  const [seen, setSeen] = useState(() => initialSeen(readSeen({ storageKey })));
  const signature = keys?.join("\n") ?? null;

  // Adjusting state during render: the first visit seeds, an open list marks what it lists, leaving forgets `fresh`.
  const next = nextSeen({ state: seen, keys, viewing });
  if (next !== seen) setSeen(next);

  // Syncs with the device's storage: what was marked is kept for the next load.
  useEffect(() => {
    if (keys !== null && seen.marked === signature) writeSeen({ storageKey, keys });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands for `keys`
  }, [signature, seen.marked, storageKey]);

  // MARK ALL READ: what is listed now is seen and nothing stays fresh.
  const markAll = () => {
    if (keys !== null) setSeen((s) => markAllSeen({ state: s, keys }));
  };

  return {
    count: viewing || keys === null ? 0 : unseenCount({ keys, seen: seen.set }),
    fresh: seen.fresh,
    markAll,
  };
}
