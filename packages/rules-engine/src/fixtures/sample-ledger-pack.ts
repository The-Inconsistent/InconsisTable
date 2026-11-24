import { SAMPLE_CREATION_RAW, SAMPLE_WARGEAR_RAW } from "../build/fixtures/sample-ledger.ts";
import type { LedgerKind } from "../manifest.ts";
import type { PackInput } from "../pack.ts";
import { SAMPLE_LEDGER_KINDS } from "./sample-ledger-ruleset.ts";

// The catalogue of build/fixtures/sample-ledger.ts as a pack for SAMPLE_LEDGER_RULESET: one entry per record (house
// decision #62). Invented content only.

type RawRecord = { id: string; name: string; source: string; page: number };

/**
 * One entry per record, keyed `<kind>.<id>` as the catalogue generator keys them: a record's id is unique within its
 * kind only. Each record's cite is its source's and page.
 */
export const ledgerEntry = (kind: LedgerKind, record: RawRecord) => ({
  key: `${kind}.${record.id}`,
  type: SAMPLE_LEDGER_KINDS[kind],
  name: record.name,
  cite: `${record.source === "base" ? "Base" : "Extra"} p.${record.page}`,
  visibility: "public" as const,
  record,
});

type RawGear = RawRecord & { kind: string; upgrade?: { slot: string } };

// What each piece of gear gives in play (house decision #95): a Guard the holder carries, or one a fitting gives.
const GUARD = [{ path: "derived.guard", mode: "add", value: "1", phase: "derived" }] as const;
const GEAR_EFFECTS: Record<string, typeof GUARD> = { lens: GUARD, "sight-lens": GUARD };

/**
 * A piece of gear as an item (house decision #95): tagged with its kind, so the items block tells arms from fittings
 * and kit, its slot in the body, and its effects.
 */
const gearEntry = (r: RawGear) => ({
  ...ledgerEntry("wargear", r),
  tags: [r.kind],
  ...(r.upgrade && { body: { slot: r.upgrade.slot } }),
  ...(GEAR_EFFECTS[r.id] !== undefined && { effects: [...GEAR_EFFECTS[r.id]!] }),
});

export const SAMPLE_LEDGER_PACK: PackInput = {
  id: "sample-ledger-catalogue",
  // 0.1.1: gear tagged by kind with slots and effects, stores, and a pair only the GM fits (house decision #95).
  version: "0.1.1",
  ruleset: { id: "sample-ledger", range: "^0.1.0" },
  license: "private",
  entries: [
    ...Object.entries(SAMPLE_CREATION_RAW).flatMap(([kind, list]) =>
      (list as RawRecord[]).map((r) => ledgerEntry(kind as LedgerKind, r)),
    ),
    ...(SAMPLE_WARGEAR_RAW as RawGear[]).map(gearEntry),
    {
      ...gearEntry({
        id: "twin-mount",
        name: "Twin Mount",
        source: "base",
        page: 41,
        category: "Kit",
        kind: "upgrade",
        value: 2,
        rarity: "Scarce",
        upgrade: { slot: "grip", fits: { weapon: "melee" }, mods: [] },
      } as RawGear),
      tags: ["upgrade", "pair"],
    },
    // A second fitting for the sight slot, so a slot taken is a refusal of its own.
    gearEntry({
      id: "long-sight",
      name: "Long Sight",
      source: "base",
      page: 41,
      category: "Kit",
      kind: "upgrade",
      value: 3,
      rarity: "Scarce",
      upgrade: { slot: "sight", fits: { weapon: "ranged" }, mods: [] },
    } as RawGear),
    { key: "supply.pellets", type: "supply", name: "Pellets", cite: "Base p.42", visibility: "public" },
    { key: "supply.oil", type: "supply", name: "Lamp Oil", cite: "Base p.42", visibility: "public" },
  ],
};
