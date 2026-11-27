import { z } from "zod";

import type { BuildCatalogue, BuildParams } from "@inconsistable/rules-engine";

import { isReady, resolveDraft, type LedgerBuild } from "@/lib/ledger/ledger";

// The character library (house decision #104): a user's own characters outside any room, as GET /api/library and its
// neighbours answer them (apps/api-go/internal/library), and what decides whether one can come into a room's builder.

const Version = z.object({ slug: z.string(), version: z.string(), title: z.string().optional() });

export const LibraryCard = z.object({
  id: z.string(),
  name: z.string(),
  done: z.boolean(),
  /** The chosen archetype's or species' name of a finished character, as its ruleset names (house decision #187). */
  line: z.string().nullable(),
  ruleset: Version,
  rev: z.number().int(),
  updatedAt: z.string(),
});
export type LibraryCard = z.infer<typeof LibraryCard>;
export const LibraryCards = z.array(LibraryCard);

export const LibraryEntry = LibraryCard.extend({
  /** The builder's document as it wrote it: kept as text, so its keys keep their order (house decision #63). */
  build: z.string().nullable(),
  packs: z.array(Version),
  /** Its owner owns its ruleset and every pack: it is edited outside a room. */
  editable: z.boolean(),
});
export type LibraryEntry = z.infer<typeof LibraryEntry>;

/** The most characters a user keeps (the api's library.Cap). */
export const LIBRARY_CAP = 20;

/** Why a library character cannot come into this room's builder: the source app's refusals in the platform's terms. */
export type NotHere =
  | { why: "notDone" }
  | { why: "otherGame"; slug: string }
  | { why: "missingPack"; slug: string }
  | { why: "otherTier"; tier: number }
  | { why: "otherVersion"; version: string; detail: string };

/** The build a library character holds, read as the room's builder reads a stored one (never re-parsed: key order). */
export function buildOf(entry: Pick<LibraryEntry, "build">): LedgerBuild | null {
  try {
    const parsed: unknown = entry.build === null ? null : JSON.parse(entry.build);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as LedgerBuild) : null;
  } catch {
    return null;
  }
}

/**
 * Whether a library character can come into a room's builder, or why not: it must be done, of the room's ruleset, made
 * with no pack the room is not served, at the room's Tier; one made with another version of that ruleset comes only when it still resolves
 * ready against the room's catalogue (the compatible check of house decision #51, in the builder's own terms). Null
 * when it can come.
 */
export function notHere({
  entry,
  room,
  params,
  catalogue,
}: {
  entry: LibraryEntry;
  room: { slug: string; version: string; packs: readonly string[]; tier: number };
  params: BuildParams;
  catalogue: BuildCatalogue;
}): NotHere | null {
  if (!entry.done) return { why: "notDone" };
  if (entry.ruleset.slug !== room.slug) return { why: "otherGame", slug: entry.ruleset.slug };
  const missing = entry.packs.find((p) => !room.packs.includes(p.slug));
  if (missing) return { why: "missingPack", slug: missing.slug };
  // A new character is built at the room's Tier (house decision #63's buildTierMismatch).
  const build = buildOf(entry);
  if (typeof build?.tier === "number" && build.tier !== room.tier) return { why: "otherTier", tier: build.tier };
  if (entry.ruleset.version === room.version) return null;
  const { resolved, error } = build ? resolveDraft({ params, catalogue, build }) : { resolved: null, error: "" };
  if (isReady(resolved)) return null;
  const first = resolved?.problems[0]?.what ?? resolved?.pending[0]?.what ?? error ?? "";
  return { why: "otherVersion", version: entry.ruleset.version, detail: first };
}

type Refusal = { code?: string | undefined; message: string; params?: Record<string, string | number> | undefined };
type Reply<T> = { ok: true; value: T } | { ok: false; error: Refusal | null };

async function call<T>(schema: z.ZodType<T>, path: string, init?: RequestInit): Promise<Reply<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
      cache: "no-store",
    });
    const body: unknown = await res.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (res.ok && parsed.success) return { ok: true, value: parsed.data };
    const refusal = z
      .object({
        code: z.string().optional(),
        message: z.string(),
        params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      })
      .safeParse(body);
    return { ok: false, error: refusal.success ? refusal.data : null };
  } catch {
    return { ok: false, error: null };
  }
}

export const listLibrary = () => call(LibraryCards, "/api/library");
export const readCharacter = (id: string) => call(LibraryEntry, `/api/library/${encodeURIComponent(id)}`);
export const newCharacter = (rulesetVersionId: string) =>
  call(LibraryCard, "/api/library", { method: "POST", body: JSON.stringify({ rulesetVersionId }) });
export const saveCharacter = (id: string, patch: { rev: number; name?: string; build?: string; done?: boolean }) =>
  call(LibraryCard, `/api/library/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
export const deleteCharacter = (id: string) =>
  call(z.object({ ok: z.literal(true) }), `/api/library/${encodeURIComponent(id)}`, { method: "DELETE" });
export const saveFromRoom = (campaignId: string, actorId: string) =>
  call(LibraryCard, "/api/library/from-room", { method: "POST", body: JSON.stringify({ campaignId, actorId }) });
