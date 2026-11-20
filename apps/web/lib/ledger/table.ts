import { z } from "zod";

import {
  canInCampaign,
  gmPermOf,
  type Actor,
  type ActorKind,
  type ActorLedger,
  type Me,
} from "@inconsistable/core-schema";
import type { BuildCatalogue, LedgerCreation, LedgerWargear, Ruleset } from "@inconsistable/rules-engine";

import type { LedgerBuild, LedgerPlay } from "./ledger";
import { toSpend } from "./play";

// The ledger builder at the table (docs/adr/0011, house decision #63): which builder a character's page shows, the
// build it starts from, the catalogue as the api serves it, the entry each seat gets to it, and what the saved sheet
// adds to a character's sheet. Pure.

type Ledgered = Pick<Actor, "entity" | "ledger" | "fields">;

/** The ledger builder builds a character that is untyped or of the type the ruleset's `build` names. */
export const usesLedger = ({ ruleset, actor }: { ruleset: Ruleset | null; actor: Pick<Actor, "entity"> }) =>
  ruleset?.build !== undefined && (actor.entity === "" || actor.entity === ruleset.build.actor);

/** A GM-side seat of an actor of this kind, as the Seat view decides who reads and approves the GM's part. */
export const gmSideOf = ({ me, kind }: { me: Me; kind: ActorKind }) =>
  me.seat.kind === "admin" ||
  (me.userId !== null && me.userId === me.campaignOwnerId) ||
  (me.tableMode === "gm" && canInCampaign({ ctx: me, perm: gmPermOf(kind) }));

/** The room's Tier: its value of the campaign field `build.tier` names; the lowest Tier while it has none. */
export function roomTier({ ruleset, campaign }: { ruleset: Ruleset; campaign: Readonly<Record<string, unknown>> }) {
  const build = ruleset.build;
  if (!build) return 0;
  const value = campaign[build.tier];
  return typeof value === "number" ? value : build.params.tiers.min;
}

// The stored document is the server's own: it read the text in order before storing it, and the builder parses the
// build again on every resolve and shows what it cannot read. So it is passed on as it is, never re-parsed here: a
// parse would put its keys in the schema's order, and the builder reads them in the order they were written.
const AsStored = z.custom<LedgerBuild>((x) => typeof x === "object" && x !== null && !Array.isArray(x));

/** What the screens start from: the draft, else the saved build, else an empty build; at the room's Tier, or for a made
 * character at the Tier it was made at, which the server holds it to (house decision #64). */
export function startingBuild({ ledger, tier }: { ledger: ActorLedger | null; tier: number }): LedgerBuild {
  const stored = AsStored.safeParse(ledger?.draft ?? ledger?.build);
  const madeAt = ledger?.build?.["tier"];
  const at = typeof madeAt === "number" ? madeAt : tier;
  // A spread keeps a stored `tier` where it was written.
  return stored.success ? { ...stored.data, tier: at } : { tier: at };
}

/** The XP a character has earned: its value of the field `build.xp` names; 0 unset or unnamed. */
export function xpEarnedOf({ ruleset, actor }: { ruleset: Ruleset | null; actor: Pick<Actor, "fields"> }) {
  const id = ruleset?.build?.xp;
  const value = id === undefined ? undefined : actor.fields[id];
  return typeof value === "number" ? value : 0;
}

/** A made character's `play` (house decision #64): the room's Tier, its XP earned and where its Ascension count
 * restarted. None for a character with no stored build, which is still being created. */
export function playOf({
  ruleset,
  actor,
  campaign,
}: {
  ruleset: Ruleset;
  actor: Pick<Actor, "fields" | "ledger">;
  campaign: Readonly<Record<string, unknown>>;
}): LedgerPlay | undefined {
  const ledger = actor.ledger;
  if (!ledger?.build) return undefined;
  return {
    tier: roomTier({ ruleset, campaign }),
    xpEarned: xpEarnedOf({ ruleset, actor }),
    xpAtAscension: ledger.xpAtAscension,
    packageWaived: ledger.packageWaived,
  };
}

/** The XP a made character has left to spend; 0 for one not made. */
export const xpToSpendOf = ({
  ruleset,
  actor,
}: {
  ruleset: Ruleset | null;
  actor: Pick<Actor, "fields" | "ledger">;
}) => (actor.ledger?.build ? toSpend({ earned: xpEarnedOf({ ruleset, actor }), spent: actor.ledger.xpSpent }) : 0);

// The catalogue reply, `{ params, kinds, wargear }`. Its records were parsed and normalised at import and are used as
// served: only their place is checked here (a list of objects per kind), never their fields.
const served = <T>() => z.array(z.custom<T>((x) => typeof x === "object" && x !== null && !Array.isArray(x)));
type Of<K extends keyof LedgerCreation> = LedgerCreation[K][number];
const CatalogueReply = z.object({
  kinds: z.object({
    keywords: served<Of<"keywords">>(),
    factions: served<Of<"factions">>(),
    "sub-factions": served<Of<"sub-factions">>(),
    species: served<Of<"species">>(),
    backgrounds: served<Of<"backgrounds">>(),
    "option-groups": served<Of<"option-groups">>(),
    archetypes: served<Of<"archetypes">>(),
    talents: served<Of<"talents">>(),
    packages: served<Of<"packages">>(),
    disciplines: served<Of<"disciplines">>(),
    powers: served<Of<"powers">>(),
    languages: served<Of<"languages">>(),
  }),
  wargear: served<LedgerWargear>(),
});

/** The builder's catalogue from the api's reply; null when the reply is not one. Every source is let in, as the server
 * resolves (house decision #63). */
export function catalogueOf(reply: unknown): BuildCatalogue | null {
  const r = CatalogueReply.safeParse(reply);
  if (!r.success) return null;
  return { creation: r.data.kinds, wargear: new Map(r.data.wargear.map((w) => [w.id, w])), homebrew: true };
}

// The entry the GM's Party tab gives a character to its builder, and the one a player's phone gives.
export const GM_ENTRIES = ["build", "review", "open"] as const;
export type GmEntry = (typeof GM_ENTRIES)[number];
export const PLAYER_ENTRIES = ["build", "continue", "levelUp"] as const;
export type PlayerEntry = (typeof PLAYER_ENTRIES)[number];

/** BUILD with neither a build nor a draft, REVIEW with a draft, OPEN once built; null when the ledger does not build it. */
export function gmEntryOf({ ruleset, actor }: { ruleset: Ruleset | null; actor: Ledgered }): GmEntry | null {
  if (!usesLedger({ ruleset, actor })) return null;
  if (actor.ledger?.draft) return "review";
  return actor.ledger?.build ? "open" : "build";
}

/** A player builds a character not yet built, or continues its draft; a built one levels up while it has XP to spend,
 * else has no entry here (the sheet's XP box keeps the way in). Null when the ledger does not build it. */
export function playerEntryOf({ ruleset, actor }: { ruleset: Ruleset | null; actor: Ledgered }): PlayerEntry | null {
  if (!usesLedger({ ruleset, actor })) return null;
  if (actor.ledger?.build) return xpToSpendOf({ ruleset, actor }) > 0 ? "levelUp" : null;
  return actor.ledger?.draft ? "continue" : "build";
}

// What the saved sheet carries that the field rows do not, read leniently: a section that does not read is left out,
// never the whole sheet.
const Rule = z.object({ name: z.string(), page: z.string().optional(), summary: z.string().optional() });
const Weapon = z.object({
  name: z.string(),
  count: z.number().optional(),
  damage: z.number(),
  ed: z.union([z.number(), z.string()]),
  ap: z.number().optional(),
  range: z.array(z.number()),
  salvo: z.number().nullable().optional(),
  traits: z.array(z.string()).catch([]),
});
const Power = z.object({
  name: z.string(),
  page: z.string(),
  summary: z.string().optional(),
  dn: z.union([z.number(), z.string()]),
  activation: z.string(),
  duration: z.string(),
  range: z.string(),
});
const Armour = z.object({ name: z.string(), ar: z.number(), traits: z.array(z.string()).catch([]) });
const SheetLines = z.object({
  talents: z.array(Rule).catch([]),
  abilities: z.array(Rule).catch([]),
  weapons: z.array(Weapon).catch([]),
  armour: Armour.nullable().catch(null),
  gear: z.array(z.string()).catch([]),
  powers: z.array(Power).catch([]),
});
export type LedgerSheetLines = z.infer<typeof SheetLines>;

/** The talents, abilities, weapons, armour, gear and powers of a saved sheet; null without one. */
export function sheetLinesOf(sheet: Record<string, unknown> | null | undefined): LedgerSheetLines | null {
  if (!sheet) return null;
  const lines = SheetLines.parse(sheet); // every key catches, so this never throws
  return { ...lines, armour: lines.armour?.name ? lines.armour : null };
}
