import assert from "node:assert/strict";
import { test } from "node:test";

import type { ActorLedger, Me } from "@inconsistable/core-schema";
import { Ruleset } from "@inconsistable/rules-engine";

import { SAMPLE_LEDGER_RULESET } from "../../../../packages/rules-engine/src/fixtures/sample-ledger-ruleset.ts";
import { resolveDraft } from "./ledger";
import { SAMPLE_PARAMS, sampleCatalogue } from "./sample";
import {
  ascensionMembersOf,
  catalogueOf,
  gmEntryOf,
  gmSideOf,
  playerEntryOf,
  playOf,
  roomTier,
  sheetLinesOf,
  startingBuild,
  usesLedger,
  xpEarnedOf,
  xpFiguresOf,
  xpToSpendOf,
} from "./table";

test("the saved sheet's lines: what the builder resolved, a section that does not read left out", () => {
  const { resolved } = resolveDraft({
    params: SAMPLE_PARAMS,
    catalogue: sampleCatalogue(),
    build: { tier: 1, archetypeId: "lamplighter" },
  });
  assert.ok(resolved);
  const lines = sheetLinesOf(JSON.parse(JSON.stringify(resolved.sheet)));
  assert.ok(lines);
  assert.deepEqual(
    lines.abilities.map((a) => a.name),
    resolved.sheet.abilities.map((a) => a.name),
  );
  assert.equal(lines.weapons.length, resolved.sheet.weapons.length);
  assert.deepEqual(lines.gear, resolved.sheet.gear);
  assert.equal(sheetLinesOf(null), null);
  const odd = sheetLinesOf({ talents: "x", weapons: [{ name: "w" }], gear: ["Rope"], armour: { name: "", ar: 0 } });
  assert.deepEqual(odd, { talents: [], abilities: [], weapons: [], armour: null, gear: ["Rope"], powers: [] });
});

// The engine's invented ledger game only (ADR 0001).
const ledger = Ruleset.parse(SAMPLE_LEDGER_RULESET);
const plain = Ruleset.parse({ ...SAMPLE_LEDGER_RULESET, build: undefined });
const saved = (o: Partial<ActorLedger>): ActorLedger => ({
  build: null,
  sheet: null,
  draft: null,
  xpSpent: 0,
  xpAtAscension: 0,
  packageWaived: false,
  ...o,
});

test("the page shows the ledger builder for an untyped actor or one of the type it builds, else the creation steps", () => {
  assert.equal(usesLedger({ ruleset: ledger, actor: { entity: "" } }), true);
  assert.equal(usesLedger({ ruleset: ledger, actor: { entity: "hero" } }), true);
  assert.equal(usesLedger({ ruleset: ledger, actor: { entity: "keyword" } }), false);
  assert.equal(usesLedger({ ruleset: plain, actor: { entity: "" } }), false);
  assert.equal(usesLedger({ ruleset: null, actor: { entity: "" } }), false);
});

test("the starting build: the draft, else the build, else an empty one; keys in place", () => {
  const build = { tier: 2, archetypeId: "lamplighter", skills: { Lore: 3, Brawl: 1 } };
  const draft = { skills: { Brawl: 1 }, tier: 1, archetypeId: "warden" };
  // not made: at the room's Tier
  assert.deepEqual(startingBuild({ ledger: null, tier: 3 }), { tier: 3 });
  assert.deepEqual(startingBuild({ ledger: saved({}), tier: 1 }), { tier: 1 });
  assert.equal(
    JSON.stringify(startingBuild({ ledger: saved({ draft }), tier: 2 })),
    '{"skills":{"Brawl":1},"tier":2,"archetypeId":"warden"}',
  );
  // made: at the Tier it was made at, whatever the room's
  assert.equal(
    JSON.stringify(startingBuild({ ledger: saved({ build, sheet: {} }), tier: 3 })),
    '{"tier":2,"archetypeId":"lamplighter","skills":{"Lore":3,"Brawl":1}}',
  );
  // A draft wins over the build; its tier stays where it was written.
  assert.equal(
    JSON.stringify(startingBuild({ ledger: saved({ build, sheet: {}, draft }), tier: 3 })),
    '{"skills":{"Brawl":1},"tier":2,"archetypeId":"warden"}',
  );
});

test("play: a made character's room Tier, XP earned and Ascension figures; none before it is made", () => {
  const made = {
    fields: { xp: 34 },
    ledger: saved({ build: { tier: 1 }, sheet: {}, xpSpent: 12, xpAtAscension: 20, packageWaived: true }),
  };
  assert.deepEqual(playOf({ ruleset: ledger, actor: made, campaign: { tier: 2 } }), {
    tier: 2,
    xpEarned: 34,
    xpAtAscension: 20,
    packageWaived: true,
  });
  assert.equal(
    playOf({ ruleset: ledger, actor: { fields: {}, ledger: saved({ draft: {} }) }, campaign: {} }),
    undefined,
  );
  assert.equal(playOf({ ruleset: ledger, actor: { fields: {}, ledger: null }, campaign: {} }), undefined);
  // XP unset, or a ruleset that names no XP field: 0
  assert.equal(xpEarnedOf({ ruleset: ledger, actor: { fields: {} } }), 0);
  assert.equal(xpEarnedOf({ ruleset: ledger, actor: { fields: { xp: "x" } } }), 0);
  assert.equal(xpEarnedOf({ ruleset: plain, actor: { fields: { xp: 9 } } }), 0);
  assert.equal(xpToSpendOf({ ruleset: ledger, actor: made }), 22);
  assert.equal(xpToSpendOf({ ruleset: ledger, actor: { ...made, ledger: saved({ xpSpent: 0 }) } }), 0);
});

test("the room's Tier is the campaign field the build names, the lowest Tier while unset", () => {
  assert.equal(roomTier({ ruleset: ledger, campaign: { tier: 3 } }), 3);
  assert.equal(roomTier({ ruleset: ledger, campaign: {} }), 1);
  assert.equal(roomTier({ ruleset: ledger, campaign: { tier: "x" } }), 1);
});

test("the catalogue reply is used as served: records kept as they are, the wargear by id, every source let in", () => {
  const { creation, wargear } = sampleCatalogue();
  const reply = { params: {}, kinds: creation, wargear: [...wargear.values()] };
  const got = catalogueOf(JSON.parse(JSON.stringify(reply)));
  assert.ok(got);
  assert.equal(got.homebrew, true);
  assert.deepEqual(got.creation, JSON.parse(JSON.stringify(creation)));
  assert.deepEqual([...got.wargear.keys()], [...wargear.keys()]);
  // The same objects, never re-parsed (a parse would add defaults and reorder keys).
  const record = { name: "X", id: "x", extra: 1 };
  const one = catalogueOf({ ...reply, kinds: { ...creation, talents: [record] } });
  assert.equal(one?.creation.talents[0], record);
  // Not a catalogue.
  assert.equal(catalogueOf(null), null);
  assert.equal(catalogueOf({ kinds: {}, wargear: [] }), null);
  assert.equal(catalogueOf({ ...reply, wargear: [1] }), null);
});

const me = (seat: Me["seat"], o: Partial<Me> = {}): Me => ({
  campaignId: "c",
  userId: "u",
  campaignOwnerId: "owner",
  tableMode: "gm",
  seat,
  ...o,
});
const member = (role: "gm" | "cogm" | "player", scopes: ("party" | "combat")[] = []): Me["seat"] => ({
  kind: "member",
  role,
  scopes,
  characterIds: [],
});

test("the GM side of a character: the GM, a co-GM with the party, the owner and an admin; not a player", () => {
  assert.equal(gmSideOf({ me: me(member("gm")), kind: "pc" }), true);
  assert.equal(gmSideOf({ me: me(member("cogm", ["party"])), kind: "pc" }), true);
  assert.equal(gmSideOf({ me: me(member("cogm", ["combat"])), kind: "pc" }), false);
  assert.equal(gmSideOf({ me: me({ kind: "admin" }, { userId: null }), kind: "pc" }), true);
  assert.equal(gmSideOf({ me: me(member("player")), kind: "pc" }), false);
  assert.equal(
    gmSideOf({ me: me({ kind: "token", role: "player", characterIds: ["a"] }, { userId: null }), kind: "pc" }),
    false,
  );
  // Without a GM only the owner, who runs the room, is on it.
  assert.equal(gmSideOf({ me: me(member("player"), { tableMode: "gmless", userId: "owner" }), kind: "pc" }), true);
  assert.equal(gmSideOf({ me: me(member("player"), { tableMode: "gmless" }), kind: "pc" }), false);
});

test("the entry each seat gets: Build, Review build with a draft, Open builder once built; a player levels up", () => {
  const actor = (entity: string, l: Partial<ActorLedger> | null, xp = 0) => ({
    entity,
    ledger: l && saved(l),
    fields: { xp },
  });
  assert.equal(gmEntryOf({ ruleset: ledger, actor: actor("", null) }), "build");
  assert.equal(gmEntryOf({ ruleset: ledger, actor: actor("", { draft: {} }) }), "review");
  assert.equal(gmEntryOf({ ruleset: ledger, actor: actor("hero", { build: {}, sheet: {} }) }), "open");
  assert.equal(gmEntryOf({ ruleset: ledger, actor: actor("hero", { build: {}, sheet: {}, draft: {} }) }), "review");
  assert.equal(gmEntryOf({ ruleset: ledger, actor: actor("keyword", null) }), null);
  assert.equal(gmEntryOf({ ruleset: plain, actor: actor("", null) }), null);

  assert.equal(playerEntryOf({ ruleset: ledger, actor: actor("", null) }), "build");
  assert.equal(playerEntryOf({ ruleset: ledger, actor: actor("hero", { draft: {} }) }), "continue");
  // built: Level up while it has XP to spend, else nothing (the sheet's XP box keeps the way in)
  assert.equal(playerEntryOf({ ruleset: ledger, actor: actor("hero", { build: {}, sheet: {} }) }), null);
  assert.equal(
    playerEntryOf({ ruleset: ledger, actor: actor("hero", { build: {}, sheet: {}, xpSpent: 4 }, 10) }),
    "levelUp",
  );
  assert.equal(
    playerEntryOf({ ruleset: ledger, actor: actor("hero", { build: {}, sheet: {}, xpSpent: 10 }, 10) }),
    null,
  );
  assert.equal(playerEntryOf({ ruleset: plain, actor: actor("", null) }), null);
});

test("the Party tab's XP figures and the Ascension's members: the ledger's player characters, counted from their last Ascension", () => {
  const hero = (
    id: string,
    xp: number,
    l: Partial<ActorLedger> | null,
    kind: "pc" | "npc" = "pc",
    entity = "hero",
  ) => ({
    id,
    name: id.toUpperCase(),
    kind,
    entity,
    fields: { xp },
    ledger: l && saved(l),
  });
  const a = hero("a", 45, { build: {}, sheet: {}, xpSpent: 30, xpAtAscension: 20 });
  // The invented ruleset's Rank: one more per 30 XP, so 45 XP is Rank 2.
  assert.deepEqual(xpFiguresOf({ ruleset: ledger, actor: a }), { earned: 45, rank: 2, toSpend: 15 });
  assert.equal(xpFiguresOf({ ruleset: ledger, actor: hero("k", 5, null, "pc", "keyword") }), null);
  assert.equal(xpFiguresOf({ ruleset: plain, actor: a }), null);
  const members = ascensionMembersOf({
    ruleset: ledger,
    actors: [a, hero("b", 12, null), hero("n", 99, null, "npc"), hero("k", 5, null, "pc", "keyword")],
  });
  assert.deepEqual(
    members.map((m) => [m.id, m.name, m.earnedThisTier, m.rank]),
    [
      ["a", "A", 25, 2],
      ["b", "B", 12, 1],
    ],
  );
  assert.deepEqual(ascensionMembersOf({ ruleset: plain, actors: [a] }), []);
});
