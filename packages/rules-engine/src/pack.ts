import { z } from "zod";

import { ATTRIBUTION_LICENSES, EntryVisibility, PackLicense } from "./enums.ts";
import { checkFieldValue, FieldValueInput } from "./field-value.ts";
import { byteSize, Cite, FieldId, Id, RulesetId, SemVer, SemVerRange, Source, type Ruleset } from "./manifest.ts";
import { own } from "./own.ts";
import { formatPath, type Problem } from "./problem.ts";

// Limits of docs/design.md §4.6 (storage). The importer enforces the same numbers.
export const MAX_PACK_BYTES = 5 * 1024 * 1024;
export const MAX_PACK_ENTRIES = 5000;
export const MAX_ENTRY_BODY_BYTES = 16 * 1024;
/** A text value in a `private` pack longer than this draws a warning: it is probably copied, not summarised. */
export const PRIVATE_TEXT_WARN_CHARS = 280;

export const PackId = RulesetId;
/** Unique within a pack; the importer namespaces it as `pack:key`. */
export const EntryKey = z
  .string()
  .max(80)
  .regex(/^[a-z0-9]+([-_.][a-z0-9]+)*$/, "use lowercase letters, digits and - _ .");

export const PackEntry = z.object({
  key: EntryKey,
  /** An entity type of the ruleset: `monster`, `spell`, `gear`… */
  type: Id,
  name: z.string().min(1).max(120),
  level: z.int().min(0).max(100).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  /** Printed page, e.g. "Sample p.12". Required unless the pack is `original` or the ruleset is homebrew. */
  cite: Cite.optional(),
  /** Fail-closed: an entry that does not say who sees it is for the GM. */
  visibility: EntryVisibility.default("gm"),
  /** Field values, keyed by the entity type's field ids, checked against their `FieldDef`. */
  body: z.record(FieldId, FieldValueInput).default({}),
});
export type PackEntry = z.infer<typeof PackEntry>;

export const Pack = z.object({
  id: PackId,
  version: SemVer,
  /** The ruleset this pack's entries are written for. */
  ruleset: z.object({ id: RulesetId, range: SemVerRange }),
  license: PackLicense,
  /** Required for `srd`, `cc-by` and `orc`: who must be credited, as the license asks. */
  attribution: z.string().min(1).max(500).optional(),
  sources: z.array(Source).max(20).default([]),
  entries: z.array(PackEntry).max(MAX_PACK_ENTRIES),
});
export type Pack = z.infer<typeof Pack>;
export type PackInput = z.input<typeof Pack>;

export type PackResult =
  { ok: true; pack: Pack; warnings: Problem[] } | { ok: false; problems: Problem[]; warnings: Problem[] };

/** Rule entries need a printed page, unless nothing printed backs them (the pack is the author's own). */
function citeExempt({ pack, ruleset }: { pack: Pack; ruleset: Ruleset }): boolean {
  return pack.license === "original" || ruleset.sources.every((s) => s.license === "homebrew");
}

function semanticProblems({ pack, ruleset }: { pack: Pack; ruleset: Ruleset }): {
  problems: Problem[];
  warnings: Problem[];
} {
  const problems: Problem[] = [];
  const warnings: Problem[] = [];
  // ponytail: the ruleset's version is not matched against `ruleset.range` (the range is only shape-checked, like
  // the manifest's `core`); matching comes with the importer's version pinning.
  if (pack.ruleset.id !== ruleset.id)
    problems.push({ path: "ruleset.id", message: `written for "${pack.ruleset.id}", not "${ruleset.id}"` });
  if (ATTRIBUTION_LICENSES.has(pack.license) && pack.attribution === undefined)
    problems.push({ path: "attribution", message: `a ${pack.license} pack must name its attribution` });

  const exempt = citeExempt({ pack, ruleset });
  const seen = new Set<string>();
  pack.entries.forEach((entry, i) => {
    const at = `entries[${i}]`;
    if (seen.has(entry.key)) problems.push({ path: `${at}.key`, message: `duplicate key "${entry.key}"` });
    seen.add(entry.key);
    if (!exempt && entry.cite === undefined) problems.push({ path: `${at}.cite`, message: "an entry needs a cite" });

    const bytes = byteSize(entry.body) ?? 0;
    if (bytes > MAX_ENTRY_BODY_BYTES)
      problems.push({ path: `${at}.body`, message: `${bytes} bytes, over the cap of ${MAX_ENTRY_BODY_BYTES}` });

    const entity = ruleset.entities.find((e) => e.id === entry.type);
    if (entity === undefined) {
      problems.push({ path: `${at}.type`, message: `unknown entity "${entry.type}"` });
      return;
    }
    for (const [field, value] of Object.entries(entry.body)) {
      const def = own(entity.fields, field);
      if (def === undefined) {
        problems.push({ path: `${at}.body.${field}`, message: `${entity.id} has no field "${field}"` });
        continue;
      }
      const why = checkFieldValue({ def, value });
      if (why !== null) problems.push({ path: `${at}.body.${field}`, message: why });
      else if (pack.license === "private" && typeof value === "string" && def.type === "text") {
        if (value.length > PRIVATE_TEXT_WARN_CHARS)
          warnings.push({
            path: `${at}.body.${field}`,
            message: `${value.length} characters: summarise in your own words, with the page, instead of copying the book`,
          });
      }
    }
  });
  const sourceIds = new Set<string>();
  pack.sources.forEach((s, i) => {
    if (sourceIds.has(s.id)) problems.push({ path: `sources[${i}].id`, message: `duplicate id "${s.id}"` });
    sourceIds.add(s.id);
  });
  return { problems, warnings };
}

/**
 * Size cap, schema, then what a schema can't say: cites (unless the pack is `original` or the ruleset homebrew),
 * attribution, unique keys, and every body against the `FieldDef`s of its entity type. A long text in a `private`
 * pack is a warning, never a refusal. Every problem carries its path, e.g. `entries[3].cite`.
 */
export function validatePack({ input, ruleset }: { input: unknown; ruleset: Ruleset }): PackResult {
  const size = byteSize(input);
  if (size === null) return { ok: false, problems: [{ path: "(root)", message: "not a JSON document" }], warnings: [] };
  if (size > MAX_PACK_BYTES) {
    const message = `${size} bytes, over the cap of ${MAX_PACK_BYTES}`;
    return { ok: false, problems: [{ path: "(root)", message }], warnings: [] };
  }
  const parsed = Pack.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => ({ path: formatPath(i.path), message: i.message }));
    return { ok: false, problems, warnings: [] };
  }
  const { problems, warnings } = semanticProblems({ pack: parsed.data, ruleset });
  return problems.length > 0 ? { ok: false, problems, warnings } : { ok: true, pack: parsed.data, warnings };
}
