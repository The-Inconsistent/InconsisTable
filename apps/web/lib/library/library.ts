import { z } from "zod";

// The importer's replies (apps/api/src/pack/pack.controller.ts). Parsed on arrival like every other reply.

export const Problem = z.object({ path: z.string(), message: z.string() });
export type Problem = z.infer<typeof Problem>;

/** A refused import (422): every problem with the path of what is wrong. */
export const ImportRefusal = z.object({ ok: z.literal(false), problems: z.array(Problem), warnings: z.array(Problem) });

export const RulesetImported = z.object({
  ok: z.literal(true),
  rulesetId: z.string(),
  versionId: z.string(),
  slug: z.string(),
  version: z.string(),
  unchanged: z.boolean(),
});
export type RulesetImported = z.infer<typeof RulesetImported>;

export const PackDiff = z.object({
  added: z.array(z.string()),
  changed: z.array(z.string()),
  removed: z.array(z.string()),
});
export type PackDiff = z.infer<typeof PackDiff>;

export const PackImported = z.object({
  ok: z.literal(true),
  packId: z.string(),
  versionId: z.string(),
  version: z.string(),
  unchanged: z.boolean(),
  diff: PackDiff,
  warnings: z.array(Problem),
});
export type PackImported = z.infer<typeof PackImported>;

export const RulesetList = z.array(
  z.object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    versions: z.array(z.object({ id: z.string(), version: z.string(), createdAt: z.string() })),
  }),
);
export type RulesetList = z.infer<typeof RulesetList>;

export const PackList = z.object({
  packs: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      license: z.string(),
      attribution: z.string().nullable(),
      disabled: z.boolean(),
      rulesetSlug: z.string(),
      versions: z.array(
        z.object({
          id: z.string(),
          version: z.string(),
          entryCount: z.number(),
          bytes: z.number(),
          createdAt: z.string(),
        }),
      ),
    }),
  ),
  usage: z.object({ packs: z.number(), bytes: z.number(), maxPacks: z.number(), maxBytes: z.number() }),
});
export type PackList = z.infer<typeof PackList>;

export const HideReply = z.object({ deleted: z.boolean() });

/** What the GM's Rules tab reads on the server: the room's pin and attached packs, and the owner's own libraries. */
export interface RulesTabData {
  rulesets: RulesetList;
  packs: PackList;
  pinned: { versionId: string; slug: string; version: string } | null;
  attached: { id: string; slug: string; version: string; license: string }[];
}

/** One entry of an attached pack, as the seat-scoped rules route serves it (`GET /api/campaigns/:id/rules`). */
export const RulesEntry = z.object({
  pack: z.string(),
  key: z.string(),
  type: z.string(),
  name: z.string(),
  level: z.number().nullable(),
  tags: z.array(z.string()),
  cite: z.string().nullable(),
  visibility: z.string(),
  body: z.record(z.string(), z.unknown()),
});
export type RulesEntry = z.infer<typeof RulesEntry>;

/** What a room has: its pinned ruleset (with the manifest as this seat may read it) and the packs attached to it. */
export const RulesReply = z.object({
  ruleset: z.object({ versionId: z.string(), slug: z.string(), version: z.string(), manifest: z.unknown() }).nullable(),
  packs: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      version: z.string(),
      license: z.string(),
      attribution: z.string().nullable(),
    }),
  ),
  entries: z.array(RulesEntry),
  total: z.number(),
});
export type RulesReply = z.infer<typeof RulesReply>;

/** What a pasted document is, by its shape: a ruleset has `entities`, a pack has `entries`. */
export function kindOf(doc: unknown): "ruleset" | "pack" | null {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
  if ("entries" in doc) return "pack";
  if ("entities" in doc) return "ruleset";
  return null;
}

/** The position in a JSON.parse error message ("... at position 123", or Firefox's "line 3 column 5"), if it names one. */
export function parseErrorAt({ message, text }: { message: string; text: string }): number | null {
  const pos = /position (\d+)/.exec(message);
  if (pos?.[1]) return Number(pos[1]);
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (!lc?.[1] || !lc[2]) return null;
  const lines = text.split("\n");
  const before = lines.slice(0, Number(lc[1]) - 1).reduce((n, l) => n + l.length + 1, 0);
  return before + Number(lc[2]) - 1;
}

/** "3.1 MB" / "420 KB": stored sizes as people read them. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
