"use client";
import { useEffect, useState } from "react";

import { readSeen, unseenCount, writeSeen } from "@/lib/seen/seen";

/**
 * How many of `keys` this device has not been shown. `keys` null: not loaded yet. While `viewing` (the thing is on
 * screen) everything it lists counts as shown, which is what leaving it would mark. The first visit seeds the list.
 */
export function useSeen({
  storageKey,
  keys,
  viewing,
}: {
  storageKey: string;
  keys: readonly string[] | null;
  viewing: boolean;
}): number {
  // `marked` is the list the set was last made from, so a changed list is noticed once.
  const [seen, setSeen] = useState<{ set: ReadonlySet<string> | null; marked: string | null }>(() => ({
    set: readSeen({ storageKey }),
    marked: null,
  }));
  const signature = keys?.join("\n") ?? null;

  // Adjusting state during render: the first visit seeds, and an open tab marks what it lists.
  if (keys !== null && (seen.set === null || viewing) && seen.marked !== signature)
    setSeen({ set: new Set(keys), marked: signature });

  // Syncs with the device's storage: what was marked is kept for the next load.
  useEffect(() => {
    if (keys !== null && seen.marked === signature) writeSeen({ storageKey, keys });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands for `keys`
  }, [signature, seen.marked, storageKey]);

  return viewing || keys === null ? 0 : unseenCount({ keys, seen: seen.set });
}
