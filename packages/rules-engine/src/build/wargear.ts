import { sourceCite, type BuildParams } from "./params.ts";
import type { Wargear, WargearWeapon } from "./schemas.ts";

// A melee weapon adds Strength or prints one short reach; a gun prints three bands or one long range. A throw is not a
// reach.
export const isMeleeProfile = (params: BuildParams, w: { addStrength?: boolean; range?: number[] }) =>
  !!w.addStrength || (w.range?.length === 1 && w.range[0]! <= params.weapon.meleeMaxReach);

// A throw reaches Strength x N metres.
export const thrownMetres = (strength: number, n: number) => strength * n;
const thrownTrait = (params: BuildParams, m: number) => params.weapon.thrownTrait.replace("{m}", String(m));

// A catalogue weapon as a sheet weapon. A thrown range becomes N x the character's Strength in metres; a weapon that is
// also melee keeps its reach and notes the throw as a trait. `melee` is decided here, while a throw is still told apart
// from a reach.
export function sheetWeapon(
  params: BuildParams,
  { name, weapon: { thrown, range, ...w } }: { name: string; weapon: WargearWeapon },
  strength: number,
) {
  const throwM = thrown === undefined ? undefined : thrownMetres(strength, thrown);
  const melee = isMeleeProfile(params, { addStrength: w.addStrength, range });
  if (range === undefined) return { name, ...w, range: [throwM ?? 1], melee };
  return {
    name,
    ...w,
    range,
    melee,
    traits: throwM === undefined ? w.traits : [...w.traits, thrownTrait(params, throwM)],
  };
}

// A catalogue item as a gear line on the sheet (at most 200 characters): the name, armour's AR, and where to read it.
export function gearLine(
  params: BuildParams,
  { name, armour: a, source, page }: Pick<Wargear, "name" | "armour" | "source" | "page">,
) {
  const ar = a
    ? `AR ${a.ar}${a.invulnerable ? "*" : ""}${a.powered ? `, Powered (${a.powered})` : ""}${a.traits.length ? `, ${a.traits.join(", ")}` : ""}; `
    : "";
  return `${name} (${ar}${sourceCite(params, { source, page })})`.slice(0, 200);
}

export type AdvancedWargearProblem = { what: string; gm?: boolean };

// What breaks the Tier's limits: Total Value strictly under the number, no item over the Max. Value, and the Rarity
// allowance. The table stops at its last row, so a higher Tier is checked against that row and the GM is asked to
// agree. An item with no printed Value or Rarity can't be counted: the GM's call.
export function advancedWargearProblems(
  params: BuildParams,
  items: readonly Pick<Wargear, "name" | "value" | "rarity">[],
  tier: number,
): AdvancedWargearProblem[] {
  const rows = params.advanced.wargear.rows;
  const top = rows.length;
  const row = rows[Math.min(top, Math.max(1, tier)) - 1]!;
  const { rare: rareName, veryRare: veryRareName, refused } = params.rarity;
  const out: AdvancedWargearProblem[] = [];
  if (tier > top)
    out.push({
      what: `Advanced Creation's Wargear table stops at Tier ${top}; Tier ${tier} uses its Tier ${top} row`,
      gm: true,
    });
  let total = 0;
  let rare = 0;
  let veryRare = 0;
  for (const w of items) {
    if (w.value === null || w.rarity === null) {
      out.push({ what: `${w.name} has no printed ${w.value === null ? "Value" : "Rarity"}`, gm: true });
      continue;
    }
    total += w.value;
    if (row.max !== null && w.value > row.max)
      out.push({ what: `${w.name} is Value ${w.value}, over the Tier ${Math.min(tier, top)} maximum of ${row.max}` });
    if (w.rarity === rareName) rare++;
    else if (w.rarity === veryRareName) veryRare++;
    else if (refused.includes(w.rarity)) out.push({ what: `${w.name} is ${w.rarity}: no Tier takes one` });
  }
  if (total >= row.total) out.push({ what: `Total Value ${total} must be under ${row.total}` });
  if (rare > row.rare) out.push({ what: `${rare} ${rareName} pieces; Tier ${Math.min(tier, top)} allows ${row.rare}` });
  if (veryRare > row.veryRare)
    out.push({ what: `${veryRare} ${veryRareName} pieces; Tier ${Math.min(tier, top)} allows ${row.veryRare}` });
  return out;
}
