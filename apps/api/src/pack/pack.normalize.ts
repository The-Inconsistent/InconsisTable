import {
  byteSize,
  canonicalJson,
  contentHash,
  sha256Hex,
  type Pack,
  type PackEntry,
} from "@inconsistable/rules-engine";

// Per-owner quota (docs/design.md §4.6). Counted over every stored version, hidden packs included, until they are really
// removed. A new version drops the older ones no room has attached, so re-importing a fix doesn't eat the quota.
// ponytail: flat numbers for every user; per-role limits when there is a plan to sell
export const MAX_PACKS_PER_USER = 50;
export const MAX_PACK_BYTES_PER_USER = 50 * 1024 * 1024;

export interface NormalizedPack {
  entries: { entry: PackEntry; contentHash: string }[];
  /** Of the whole version: what a repeat import is compared with. */
  hash: string;
  bytes: number;
}

/**
 * What an import writes, from a pack that passed `validatePack`: each entry with its content hash, the hash of the
 * whole version, and its size. The version's hash covers the ruleset version it was checked against, so the same file
 * re-imported after a ruleset change is a new version with an empty diff.
 */
export function normalizePack({ pack, rulesetVersionId }: { pack: Pack; rulesetVersionId: string }): NormalizedPack {
  const entries = pack.entries.map((entry) => ({ entry, contentHash: contentHash(entry) }));
  const keyed = entries.map((e): [string, string] => [e.entry.key, e.contentHash]).sort(([a], [b]) => (a < b ? -1 : 1));
  const hash = sha256Hex(
    canonicalJson({
      version: pack.version,
      ruleset: pack.ruleset,
      rulesetVersionId,
      attribution: pack.attribution,
      sources: pack.sources,
      entries: keyed,
    }),
  );
  return { entries, hash, bytes: byteSize(pack) ?? 0 };
}
