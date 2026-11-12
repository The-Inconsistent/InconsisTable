"use client";
import { createContext, useContext, type ReactNode } from "react";

import type { TableMode } from "@inconsistable/core-schema";

// How the room sits, for the parts of the GM's panels a phone also runs without a GM: they drop the choices that need a
// GM (an entry or a clock only the GM sees). The api refuses them anyway (docs/adr/0009-table-modes.md).
const Mode = createContext<TableMode>("gm");

export function TableModeProvider({ mode, children }: { mode: TableMode; children: ReactNode }) {
  return <Mode value={mode}>{children}</Mode>;
}

export const useTableMode = (): TableMode => useContext(Mode);

/** The visibilities offered where a GM-only one makes no sense without a GM. */
export function useVisibilities<T extends string>(all: readonly T[]): T[] {
  const mode = useTableMode();
  return mode === "gm" ? [...all] : all.filter((v) => v !== "gm");
}
