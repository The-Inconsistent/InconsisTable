import { z } from "zod";

import { byteSize, RulesetId, SemVer, SemVerRange } from "./manifest.ts";
import { MAX_PACK_BYTES } from "./pack.ts";
import { canonicalJson, sha256Hex } from "./pack-hash.ts";
import { formatPath, type Problem } from "./problem.ts";

// A game module (docs/adr/0010, decision 4; house decisions #122 to #125): the list that makes one game of an owner's
// parts. It names one ruleset version, the pack versions that go with it and, optionally, a World version, each by the
// owner's slug, its version and the hash it must have when one is given. It may carry those documents too, so that one
// file imports a whole game; the importers of each part check what it carries, not this schema.

/** The largest module file the importer reads, carried documents included: one pack's cap, the body cap of every import. */
export const MAX_MODULE_BYTES = MAX_PACK_BYTES;
/** The most packs one module names (and carries). */
export const MAX_MODULE_PACKS = 20;

/** One part a module names. */
export const ModulePart = z.strictObject({
  slug: RulesetId,
  version: SemVer,
  /** The stored version's hash, as a room document's `expects` gives it; absent, any content of that version is taken. */
  hash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "use the sha-256 hash in lower-case hex")
    .optional(),
});
export type ModulePart = z.infer<typeof ModulePart>;

export const GameModule = z.strictObject({
  /** The module's own id: one owner imports it under this slug, version after version. */
  id: RulesetId,
  version: SemVer,
  /** The core versions it was written for, as a ruleset's is. */
  core: SemVerRange,
  name: z.string().min(1).max(80),
  ruleset: ModulePart,
  packs: z.array(ModulePart).max(MAX_MODULE_PACKS),
  world: ModulePart.optional(),
  /** The documents themselves, each in the form its own importer takes. Left out of the stored module and its hash. */
  documents: z
    .strictObject({
      ruleset: z.unknown().optional(),
      packs: z.array(z.unknown()).max(MAX_MODULE_PACKS).optional(),
      world: z.unknown().optional(),
    })
    .optional(),
});
export type GameModule = z.infer<typeof GameModule>;
export type GameModuleInput = z.input<typeof GameModule>;

export type ModuleResult = { ok: true; module: GameModule } | { ok: false; problems: Problem[] };

/**
 * Size cap (as serialised), schema, then no pack named twice. `core` is checked as a ruleset's is: by the shape of its
 * range. The Go twin is `engine.ValidateModule`.
 */
export function validateModule(input: unknown): ModuleResult {
  const size = byteSize(input);
  if (size === null) return { ok: false, problems: [{ path: "(root)", message: "not a JSON document" }] };
  if (size > MAX_MODULE_BYTES) {
    return { ok: false, problems: [{ path: "(root)", message: `${size} bytes, over the cap of ${MAX_MODULE_BYTES}` }] };
  }
  const parsed = GameModule.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })),
    };
  }
  const seen = new Set<string>();
  const problems: Problem[] = [];
  parsed.data.packs.forEach((p, i) => {
    if (seen.has(p.slug)) problems.push({ path: `packs[${i}].slug`, message: `"${p.slug}" is named twice` });
    seen.add(p.slug);
  });
  return problems.length > 0 ? { ok: false, problems } : { ok: true, module: parsed.data };
}

/** The hash a module version is stored under: of the canonical parsed document without the documents it carries. */
export function moduleHash(module: GameModule): string {
  const { documents: _documents, ...named } = module;
  return sha256Hex(canonicalJson(named));
}
