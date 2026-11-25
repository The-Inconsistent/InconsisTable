// The Seat view module (CONTEXT.md) of the TypeScript api, kept after the flip as the reference the Go view
// (internal/view) is held to: vectors/table.ts runs it and the Go tests compare. Pure, no database. A change to what a
// seat sees is made here and in internal/view together. Everything outside this folder imports it from here.
export { seatManifest, seatView, type SeatView, type Snapshot } from "./view.seat.ts";
export { ownerStrikeProblems } from "./view.owner.ts";
export {
  actorGmSide,
  actorWriteSide,
  heldBy,
  readableEntryVisibilities,
  runsAsGm,
  sightOf,
  type Sight,
} from "./view.sight.ts";
