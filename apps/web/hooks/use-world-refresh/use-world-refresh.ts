"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { needsRefresh } from "@/lib/world/room";

/**
 * Re-dresses an open room page when its World changes: `rendered` is the World the server rendered the page with
 * (null without one), `live` the room's pin from the socket state. The page's server data is read again once per new
 * pin, so a GM pinning a World mid-session re-dresses every phone and the TV without a reload by hand.
 */
export function useWorldRefresh({ rendered, live }: { rendered: string | null; live: string | null | undefined }) {
  const router = useRouter();
  const refreshed = useRef<string | null | undefined>(undefined);

  // External system: the server's render of this page, read again when the room's World is not the one it shows.
  useEffect(() => {
    if (!needsRefresh({ rendered, live, refreshed: refreshed.current })) return;
    refreshed.current = live;
    router.refresh();
  }, [rendered, live, router]);
}
