import { z } from "zod";

import { TableMode } from "@inconsistable/core-schema";
import { TermId, TermWords, WorldHandouts, WorldTheme } from "@inconsistable/rules-engine";

// The importer's replies (apps/api-go/internal/pack/http.go). Parsed on arrival like every other reply.

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

/** The descriptive part of a manifest's game block, as the api lists it for Choose game. */
const GameBlock = z.object({
  title: z.string(),
  family: z.string().optional(),
  genres: z.array(z.string()).default([]),
  players: z.object({ min: z.number(), max: z.number() }),
});

export const RulesetList = z.array(
  z.object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    versions: z.array(
      z.object({
        id: z.string(),
        version: z.string(),
        createdAt: z.string(),
        modes: z.array(TableMode).default(["gm"]),
        /** The manifest's game block, for Choose game; null when the ruleset has none. */
        game: GameBlock.nullable().default(null),
      }),
    ),
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

/** What the GM's Rules tab reads on the server: the room's pin, attached packs and World, and the caller's libraries. */
export interface RulesTabData {
  rulesets: RulesetList;
  packs: PackList;
  worlds: WorldList;
  pinned: { versionId: string; slug: string; version: string } | null;
  attached: { id: string; slug: string; version: string; license: string }[];
  /** The room's World while it is served, null without one. */
  world: { versionId: string; name: string; version: string } | null;
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
  /** What an actor that chose the entry gets in its numbers; the builder's preview reads them later. */
  effects: z.array(z.unknown()).optional(),
  /** The ledger builder's catalogue record (house decision #62), null when the entry has none; nothing reads it yet. */
  record: z.record(z.string(), z.unknown()).nullable().optional(),
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
  /** The room's World while it is served (house decision #65), the same for every seat; null without one. Its handout
   * layouts are null when it brings none (house decision #72). */
  world: z
    .object({
      versionId: z.string(),
      slug: z.string(),
      version: z.string(),
      name: z.string(),
      theme: WorldTheme,
      handouts: WorldHandouts.nullable(),
      /** Its words for the app's terms (issue #159); null when it brings none. */
      terms: z.partialRecord(TermId, TermWords).nullable(),
    })
    .nullable(),
});
export type RulesReply = z.infer<typeof RulesReply>;

/** What importing a World answers (house decision #65). */
export const WorldImported = z.object({
  ok: z.literal(true),
  worldId: z.string(),
  versionId: z.string(),
  slug: z.string(),
  version: z.string(),
  unchanged: z.boolean(),
});
export type WorldImported = z.infer<typeof WorldImported>;

/** The owner's Worlds that are not hidden (`GET /api/worlds`), each with its versions, newest first. */
export const WorldList = z.array(
  z.object({
    id: z.string(),
    slug: z.string(),
    disabled: z.boolean(),
    versions: z.array(z.object({ id: z.string(), version: z.string(), name: z.string(), createdAt: z.string() })),
  }),
);
export type WorldList = z.infer<typeof WorldList>;

/** What importing a game module answers (house decision #122): its carried packs' warnings by path in the file. */
export const ModuleImported = z.object({
  ok: z.literal(true),
  moduleId: z.string(),
  versionId: z.string(),
  slug: z.string(),
  version: z.string(),
  unchanged: z.boolean(),
  warnings: z.array(Problem),
});
export type ModuleImported = z.infer<typeof ModuleImported>;

const ModulePart = z.object({ versionId: z.string(), slug: z.string(), version: z.string() });

/** The owner's game modules (`GET /api/modules`), each version newest first, with its parts and its ruleset's game. */
export const ModuleList = z.array(
  z.object({
    id: z.string(),
    slug: z.string(),
    versions: z.array(
      z.object({
        id: z.string(),
        version: z.string(),
        name: z.string(),
        createdAt: z.string(),
        ruleset: ModulePart,
        packs: z.array(ModulePart),
        world: ModulePart.nullable(),
        modes: z.array(TableMode).default(["gm"]),
        game: GameBlock.nullable().default(null),
      }),
    ),
  }),
);
export type ModuleList = z.infer<typeof ModuleList>;

/** What the library imports, by the route each goes to (`/api/<kind>s`). */
export type ImportKind = "ruleset" | "pack" | "world" | "module";

/**
 * What a pasted document is, by its shape: a ruleset has `entities`, a pack has `entries`, a game module `packs` (the
 * documents it carries are nested), a World a `theme` alone.
 */
export function kindOf(doc: unknown): ImportKind | null {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
  if ("entries" in doc) return "pack";
  if ("entities" in doc) return "ruleset";
  if ("packs" in doc) return "module";
  if ("theme" in doc) return "world";
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

/** "3.1 MB" / "420 KB": stored sizes as people read them, with the locale's digits and separators. */
export function formatBytes(bytes: number, locale = "en"): string {
  if (bytes >= 1024 * 1024) {
    const mb = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `${mb.format(bytes / (1024 * 1024))} MB`;
  }
  return `${new Intl.NumberFormat(locale).format(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** The owner's export route for a ruleset, a pack, a World or a game module (newest version, as its importer takes it). */
export function exportUrl(kind: ImportKind, id: string): string {
  return `/api/${kind}s/${encodeURIComponent(id)}/export`;
}
