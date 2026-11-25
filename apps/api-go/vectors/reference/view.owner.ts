import type { Ctx } from "../../../../packages/core-schema/src/index.ts";
import { canonicalJson, type Problem, type Ruleset } from "../../../../packages/rules-engine/src/index.ts";
import { problemsOf } from "./view.compiles.ts";
import { seatManifest } from "./view.seat.ts";

const PLAYER: Ctx = {
  campaignId: "",
  userId: null,
  campaignOwnerId: null,
  tableMode: "gm",
  seat: { kind: "member", role: "player", scopes: [], characterIds: [] },
} as Ctx;

/**
 * What an import refuses of a strike its owner sends (house decision #112; the twin of internal/view/owner_strikes.go):
 * one a player's copy (house decision #101) does not carry as declared, because the cut that makes that copy compile
 * took or narrowed it for reading a value players may not read. Each is refused at the strike's path, naming where it
 * reads one. The ruleset is the normalized one of a manifest that compiles.
 */
export function ownerStrikeProblems(ruleset: Ruleset): Problem[] {
  const owned = (ruleset.strikes ?? []).flatMap((s, i) => (s.byOwner === true ? [i] : []));
  if (owned.length === 0) return [];
  const served = seatManifest({ ruleset, ctx: PLAYER });
  const kept = new Map((served.strikes ?? []).map((s) => [s.id, canonicalJson(s)]));
  return owned.flatMap((i) => {
    const strike = ruleset.strikes![i]!;
    if (kept.get(strike.id) === canonicalJson(strike)) return [];
    return [
      {
        path: `strikes[${i}]`,
        message: `a strike sent from a phone reads a value players may not read: ${readAt(served, strike, i)}`,
      },
    ];
  });
}

/**
 * Where the strike, put back as declared into the player's copy, does not compile: the first problem inside it, at the
 * strike's own index. The strike's path when nothing inside it is named.
 */
function readAt(served: Ruleset, strike: NonNullable<Ruleset["strikes"]>[number], i: number): string {
  const others = (served.strikes ?? []).filter((s) => s.id !== strike.id);
  const at = `strikes[${others.length}]`;
  for (const p of problemsOf({ ...served, strikes: [...others, strike] })) {
    if (p.path.startsWith(at) && (p.path.length === at.length || p.path[at.length] === "."))
      return `strikes[${i}]${p.path.slice(at.length)}`;
  }
  return `strikes[${i}]`;
}
