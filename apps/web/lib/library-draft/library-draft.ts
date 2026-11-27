import { z } from "zod";

// A library draft's copy in this browser (#233, house decision #188, Auspex's builder keeps one in localStorage): every
// change is kept here at once, with the revision the server had answered when it was made, so a tab closed or a
// connection lost inside the autosave second loses nothing. Storage can throw (private mode, blocked site data): then
// the draft lives on the server only.

const KEY = "it-library-draft:";
const Stored = z.object({ rev: z.number().int(), build: z.string() });

/** Keeps the build as this browser's copy, made over the server's revision `rev`. */
export function keepLocal({ id, rev, build }: { id: string; rev: number; build: string }): void {
  try {
    localStorage.setItem(KEY + id, JSON.stringify({ rev, build }));
  } catch {
    // Storage blocked: the server's autosave still keeps it.
  }
}

/**
 * After a build reached the server at revision `rev`: this browser's copy is that build or a later change, so it is
 * made over `rev` now. Without this, a change made while that save was on its way would lose to it.
 */
export function restampLocal({ id, rev }: { id: string; rev: number }): void {
  const stored = newerLocal({ stored: readLocal(id), rev: -1 });
  if (stored !== null) keepLocal({ id, rev, build: stored });
}

/** This browser's copy as stored, or null. */
export function readLocal(id: string): string | null {
  try {
    return localStorage.getItem(KEY + id);
  } catch {
    return null;
  }
}

/**
 * The build to start from: this browser's copy when it was made over the revision the server holds now or a later one
 * (its last change never reached the server), else null, and the server's wins.
 */
export function newerLocal({ stored, rev }: { stored: string | null; rev: number }): string | null {
  try {
    const parsed = Stored.safeParse(JSON.parse(stored ?? "null"));
    return parsed.success && parsed.data.rev >= rev ? parsed.data.build : null;
  } catch {
    return null;
  }
}
