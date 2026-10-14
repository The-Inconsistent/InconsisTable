// The Seat view module (CONTEXT.md): the one place that decides what a seat receives, sees and may write. Pure, no
// database. Everything outside this folder imports it from here.
export { seatManifest, seatView, type SeatView, type Snapshot } from "./view.seat.ts";
export {
  actorGmSide,
  actorWriteSide,
  heldBy,
  readableEntryVisibilities,
  runsAsGm,
  sightOf,
  type Sight,
} from "./view.sight.ts";
