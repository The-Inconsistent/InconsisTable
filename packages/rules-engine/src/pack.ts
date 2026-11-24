import { z } from "zod";

import { buildSchemas, type Schemas as LedgerSchemas } from "./build/schemas.ts";
import { entryEffectProblems } from "./compile.ts";
import { ATTRIBUTION_LICENSES, EntryVisibility, PackLicense } from "./enums.ts";
import { checkFieldValue, FieldValueInput } from "./field-value.ts";
import {
  byteSize,
  Cite,
  Effect,
  FieldId,
  Id,
  LEDGER_KINDS,
  RulesetId,
  SemVer,
  SemVerRange,
  Source,
  type LedgerKind,
  type Ruleset,
} from "./manifest.ts";
import { own } from "./own.ts";
import { formatPath, type Problem } from "./problem.ts";

// Limits of docs/design.md §4.6 (storage). The importer enforces the same numbers.
export const MAX_PACK_BYTES = 5 * 1024 * 1024;
export const MAX_PACK_ENTRIES = 5000;
export const MAX_ENTRY_BODY_BYTES = 16 * 1024;
/** A text value in a `private` pack longer than this draws a warning: it is probably copied, not summarised. */
export const PRIVATE_TEXT_WARN_CHARS = 280;

export const MAX_ENTRY_EFFECTS = 20;
/** The most a catalogue record may take, as serialised JSON (house decision #62). */
export const MAX_ENTRY_RECORD_BYTES = 32 * 1024;

/** The builder's schema of each kind of record. */
const RECORD_SCHEMA = {
  keywords: "Keyword",
  factions: "Faction",
  "sub-factions": "SubFaction",
  species: "Species",
  backgrounds: "BackgroundTable",
  "option-groups": "OptionGroup",
  archetypes: "Archetype",
  talents: "Talent",
  packages: "Package",
  disciplines: "Discipline",
  powers: "PsychicPower",
  languages: "Language",
  wargear: "Wargear",
} as const satisfies Record<LedgerKind, keyof LedgerSchemas>;

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
  /**
   * What an actor that chose this entry in a `choose` step gets in its numbers (house decision #61). Cited by the
   * entry's own cite unless an effect has one.
   */
  effects: z.array(Effect).max(MAX_ENTRY_EFFECTS).default([]),
  /**
   * The catalogue record the ledger builder reads (house decision #62), on an entry of a type `build.kinds` names. Once
   * validated it is the record its kind's schema answers, keys in the schema's order, which the builder reads.
   */
  record: z.record(z.string(), z.unknown()).optional(),
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
  records: Map<number, Record<string, unknown>>;
} {
  const problems: Problem[] = [];
  const warnings: Problem[] = [];
  const build = ruleset.build;
  const kindOf = new Map<string, LedgerKind>(build === undefined ? [] : LEDGER_KINDS.map((k) => [build.kinds[k], k]));
  const records = new Map<number, Record<string, unknown>>(); // entry index → its parsed record
  const recordIds = new Map<string, Set<string>>(); // entry type → the record ids seen
  // ponytail: the ruleset's version is not matched against `ruleset.range` (the range is only shape-checked, like
  // the manifest's `core`); matching comes with the importer's version pinning.
  if (pack.ruleset.id !== ruleset.id)
    problems.push({ path: "ruleset.id", message: `written for "${pack.ruleset.id}", not "${ruleset.id}"` });
  if (ATTRIBUTION_LICENSES.has(pack.license) && pack.attribution === undefined)
    problems.push({ path: "attribution", message: `a ${pack.license} pack must name its attribution` });

  const exempt = citeExempt({ pack, ruleset });
  const seen = new Set<string>();
  const withEffects = new Map<string, { entry: PackEntry; at: string }[]>();
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
    if (entry.effects.length > 0) withEffects.set(entry.type, [...(withEffects.get(entry.type) ?? []), { entry, at }]);
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
    const record = recordOf({ entry, at, i, build, kind: kindOf.get(entry.type), problems });
    if (record === null) return;
    records.set(i, record);
    // A record's id is unique within its kind, not across the pack, so a reader finds it by type and id, never by key.
    const id = String(record.id);
    const ids = recordIds.get(entry.type) ?? new Set<string>();
    if (ids.has(id))
      problems.push({
        path: `${at}.record.id`,
        message: `another "${entry.type}" in this pack already has the id "${id}"`,
      });
    ids.add(id);
    recordIds.set(entry.type, ids);
  });
  // Effects hold for every actor type that picks the entry's type in a `choose` step, or holds it as a record of a held
  // kind (house decision #88).
  for (const [type, list] of withEffects) {
    const pickers = new Set([
      ...ruleset.creation.flatMap((c) => (c.kind === "choose" && c.pick === type ? [c.actor] : [])),
      ...Object.values(ruleset.held ?? {}).flatMap((k) => (k.entry === type ? k.entities : [])),
    ]);
    const pool = ruleset.entities.filter((e) => pickers.has(e.id));
    if (pool.length === 0) {
      for (const { at } of list)
        problems.push({ path: `${at}.effects`, message: `nothing chooses a "${type}", so these could never apply` });
      continue;
    }
    problems.push(
      ...entryEffectProblems({
        ruleset,
        entries: list.map((l) => l.entry),
        pool,
        pathOf: (i, j) => `${list[i]?.at ?? ""}.effects[${j}]`,
      }),
    );
  }
  const sourceIds = new Set<string>();
  pack.sources.forEach((s, i) => {
    if (sourceIds.has(s.id)) problems.push({ path: `sources[${i}].id`, message: `duplicate id "${s.id}"` });
    sourceIds.add(s.id);
  });
  return { problems, warnings, records };
}

/**
 * An entry's catalogue record (house decision #62): there exactly when the entry's type holds a kind the ledger builder
 * reads, within the size cap, valid for its kind, and naming the entry's name. Null when there is none or it
 * is refused.
 */
function recordOf({
  entry,
  at,
  i,
  build,
  kind,
  problems,
}: {
  entry: PackEntry;
  at: string;
  i: number;
  build: Ruleset["build"];
  kind: LedgerKind | undefined;
  problems: Problem[];
}): Record<string, unknown> | null {
  if (entry.record === undefined) {
    if (kind !== undefined) problems.push({ path: `${at}.record`, message: `a "${entry.type}" needs its record` });
    return null;
  }
  if (build === undefined || kind === undefined) {
    problems.push({ path: `${at}.record`, message: `nothing reads a record on a "${entry.type}"` });
    return null;
  }
  // One catalogue for every seat, and a saved sheet with no name a player may not read (house decision #63).
  if (entry.visibility === "gm")
    problems.push({ path: `${at}.visibility`, message: "every seat reads a catalogue record" });
  const bytes = byteSize(entry.record) ?? 0;
  if (bytes > MAX_ENTRY_RECORD_BYTES) {
    problems.push({ path: `${at}.record`, message: `${bytes} bytes, over the cap of ${MAX_ENTRY_RECORD_BYTES}` });
    return null;
  }
  const parsed = buildSchemas(build.params)[RECORD_SCHEMA[kind]].safeParse(entry.record);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      problems.push({ path: formatPath(["entries", i, "record", ...issue.path]), message: issue.message });
    return null;
  }
  const record = parsed.data as Record<string, unknown>;
  if (record.name !== entry.name)
    problems.push({ path: `${at}.record.name`, message: `must be the entry's name "${entry.name}"` });
  return record;
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
  const { problems, warnings, records } = semanticProblems({ pack: parsed.data, ruleset });
  if (problems.length > 0) return { ok: false, problems, warnings };
  // What is stored and hashed is each record as its kind's schema answers it.
  const entries = parsed.data.entries.map((e, i) => {
    const record = records.get(i);
    return record === undefined ? e : { ...e, record };
  });
  return { ok: true, pack: { ...parsed.data, entries }, warnings };
}
