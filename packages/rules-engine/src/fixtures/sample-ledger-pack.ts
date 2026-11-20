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

export const SAMPLE_LEDGER_PACK: PackInput = {
  id: "sample-ledger-catalogue",
  version: "0.1.0",
  ruleset: { id: "sample-ledger", range: "^0.1.0" },
  license: "private",
  entries: [
    ...Object.entries(SAMPLE_CREATION_RAW).flatMap(([kind, list]) =>
      (list as RawRecord[]).map((r) => ledgerEntry(kind as LedgerKind, r)),
    ),
    ...(SAMPLE_WARGEAR_RAW as RawRecord[]).map((r) => ledgerEntry("wargear", r)),
  ],
};
