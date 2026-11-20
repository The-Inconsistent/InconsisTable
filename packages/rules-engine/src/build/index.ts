// ponytail: problem and effect texts are English sentences with the game's terms, as in Auspex, upgrade: codes worded by the ruleset

// The ledger builder (docs/adr/0011): a character bought with XP from a catalogue of records, as one pure function,
// `resolveBuild`. Nothing here is a ruleset's content: the numbers, names and cites are `BuildParams`.
export { BuildParams } from "./params.ts";
export {
  buildSchemas,
  type Archetype as LedgerArchetype,
  type CharacterBuild,
  type CharacterBuildInput,
  type CharacterStats as LedgerSheet,
  type Creation as LedgerCreation,
  type Grant as LedgerGrant,
  type Requirement as LedgerRequirement,
  type Schemas as LedgerSchemas,
  type Wargear as LedgerWargear,
} from "./schemas.ts";
export { resolveBuild } from "./resolve.ts";
export { meets, outOfReach, wargearMatches, type BuildCtx } from "./requirements.ts";
export {
  buildReady,
  purchaseKey,
  type BuildCatalogue,
  type BuildChoicePrompt,
  type BuildEffect,
  type BuildProblem,
  type BuildStep,
  type ChoicePick,
  type LedgerRow,
  type PendingChoice,
  type Purchase,
  type ResolvedBuild,
  type Who,
} from "./types.ts";
