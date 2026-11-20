"use client";
import { createContext, useContext } from "react";

import type { WorldHandouts } from "@inconsistable/rules-engine";

// The room's World's handout layouts and names (house decision #72), for the GM's picker and every drawn handout. The
// value is the server's reply as the page rendered it, so it is stable between refreshes and needs no memo.
const RoomHandoutsContext = createContext<WorldHandouts | null | undefined>(undefined);

type RoomHandoutsProps = { handouts: WorldHandouts | null; children: React.ReactNode };

/** Provides the room's handout layouts: null when the room has no World, or its World brings none. */
export function RoomHandouts({ handouts, children }: RoomHandoutsProps) {
  return <RoomHandoutsContext.Provider value={handouts}>{children}</RoomHandoutsContext.Provider>;
}

/** The room's handout layouts and names, null for the platform's own. Throws outside RoomHandouts. */
export function useRoomHandouts(): WorldHandouts | null {
  const handouts = useContext(RoomHandoutsContext);
  if (handouts === undefined) throw new Error("useRoomHandouts outside RoomHandouts");
  return handouts;
}
