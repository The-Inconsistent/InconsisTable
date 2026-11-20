import { BuildParams, buildSchemas, type BuildCatalogue, type LedgerCreation } from "@inconsistable/rules-engine";

import {
  WIDE_CREATION_RAW,
  WIDE_PARAMS_INPUT,
  WIDE_WARGEAR_RAW,
} from "../../../../packages/rules-engine/src/build/fixtures/sample-ledger-wide.ts";

// The engine's invented ledger game, widened (packages/rules-engine/src/build/fixtures/sample-ledger-wide.ts), parsed
// into what the builder takes: for the tests and the development page only. No real game's content.

export const SAMPLE_PARAMS = BuildParams.parse(WIDE_PARAMS_INPUT);
const S = buildSchemas(SAMPLE_PARAMS);
const parsers: { [K in keyof LedgerCreation]: { parse: (x: unknown) => LedgerCreation[K][number] } } = {
  keywords: S.Keyword,
  factions: S.Faction,
  "sub-factions": S.SubFaction,
  species: S.Species,
  backgrounds: S.BackgroundTable,
  "option-groups": S.OptionGroup,
  archetypes: S.Archetype,
  talents: S.Talent,
  packages: S.Package,
  disciplines: S.Discipline,
  powers: S.PsychicPower,
  languages: S.Language,
};
const creation = Object.fromEntries(
  Object.entries(parsers).map(([k, p]) => [k, (WIDE_CREATION_RAW[k] ?? []).map((x) => p.parse(x))]),
) as unknown as LedgerCreation; // each list parsed by its own schema above

export const sampleCatalogue = (homebrew = false): BuildCatalogue => ({
  creation,
  wargear: new Map(WIDE_WARGEAR_RAW.map((w) => S.Wargear.parse(w)).map((w) => [w.id, w])),
  homebrew,
});
