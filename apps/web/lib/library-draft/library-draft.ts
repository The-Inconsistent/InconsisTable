import { z } from "zod";

// A library draft's copy in this browser (#233, house decision #188, Auspex's builder keeps one in localStorage): every
// change is kept here at once, with the revision the server had answered when it was made, so a tab closed or a
// connection lost inside the autosave second loses nothing. It is kept per user and character, so a shared browser never
// offers one user another's draft, and goes once the server holds the same build. Storage can throw (private mode,
// blocked site data): then the draft lives on the server only.

const PREFIX = "it-library-draft:";
const Stored = z.object({ rev: z.number().int(), build: z.string() });

type Where = { userId: string; id: string };

/** The storage key of one user's copy of one character. */
export const draftKey = ({ userId, id }: Where): string => `${PREFIX}${userId}:${id}`;

/** Keeps the build as this browser's copy, made over the server's revision `rev`. */
export function keepLocal({ userId, id, rev, build }: Where & { rev: number; build: string }): void {
  try {
    localStorage.setItem(draftKey({ userId, id }), JSON.stringify({ rev, build }));
  } catch {
    // Storage blocked: the server's autosave still keeps it.
  }
}

/** This browser's copy as stored, or null. */
export function readLocal(where: Where): string | null {
  try {
    return localStorage.getItem(draftKey(where));
  } catch {
    return null;
  }
}

/** Forgets every user's copy of a character: it is done or deleted. */
export function forgetLocal(id: string): void {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    for (const key of keys) if (key?.startsWith(PREFIX) && key.endsWith(`:${id}`)) localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

/** Whether two builds' texts are the same document (whitespace aside; keys keep their order, house decision #63). */
export function sameBuild(a: string | null, b: string | null): boolean {
  try {
    return a !== null && b !== null && JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return false;
  }
}

/**
 * After a draft reached the server at revision `rev`: this browser's copy goes when it is that build, else it is a later
 * change and is made over `rev` now (without this, a change made while that save was on its way would lose to it).
 */
export function afterSave({ userId, id, rev, build }: Where & { rev: number; build: string }): void {
  const stored = newerLocal({ stored: readLocal({ userId, id }), rev: -1 });
  if (stored === null) return;
  if (!sameBuild(stored, build)) return keepLocal({ userId, id, rev, build: stored });
  try {
    localStorage.removeItem(draftKey({ userId, id }));
  } catch {
    // Storage blocked: nothing was kept.
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
