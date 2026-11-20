import assert from "node:assert/strict";
import { test } from "node:test";

import { SAMPLE_PARAMS, SAMPLE_PARAMS_INPUT, SAMPLE_WARGEAR, sampleCatalogue } from "./fixtures/sample-ledger.ts";
import { BuildParams } from "./params.ts";
import { meets, outOfReach, wargearMatches, type BuildCtx } from "./requirements.ts";
import { resolveBuild } from "./resolve.ts";
import type { CharacterBuildInput } from "./schemas.ts";
import { buildReady, purchaseKey } from "./types.ts";

// Invented game throughout (fixtures/sample-ledger.ts): its prices and limits are the fixture's own.

const params = SAMPLE_PARAMS;
type Play = { tier: number; xpEarned: number; packageWaived?: boolean };
const run = (build: CharacterBuildInput, opts: { play?: Play; homebrew?: boolean } = {}) =>
  resolveBuild({ params, catalogue: sampleCatalogue(opts.homebrew), build, play: opts.play });
const lamplighter = { tier: 1, archetypeId: "lamplighter" };
const whats = (r: ReturnType<typeof run>) => r.problems.map((p) => p.what);

test("a build is priced from the cumulative tables and the budget is the Tier's", () => {
  const r = run({ ...lamplighter, attributes: { MGT: 4 }, skills: { Brawl: 1, Craft: 1, Sneak: 3 } });
  assert.deepEqual(
    r.ledger.map((l) => [l.what, l.xp, l.cite]),
    [
      ["Lamplighter (archetype, with its species)", 20, "Base p.20"],
      ["Might 2 → 4", 16 - 3, "Base p.4"],
      ["Brawl 0 → 1", 1, "Base p.5"],
      ["Craft 0 → 1", 1, "Base p.5"],
      ["Sneak 2 → 3", 9 - 4, "Base p.5"],
    ],
  );
  assert.equal(r.spent, 40);
  assert.equal(r.budget, 80);
  assert.equal(run({ tier: 2, archetypeId: "lamplighter" }).budget, 160);
  assert.deepEqual(r.sheet.attributes, { MGT: 4, AGI: 3, WIT: 3, PRE: 2 });
  assert.equal(r.sheet.wealth, 2); // starting Wealth is startingPerTier x Tier
});

test("spending past the budget is a problem naming the excess, and a custom budget replaces the Tier's", () => {
  const r = run({ ...lamplighter, budget: 30, attributes: { MGT: 4 }, skills: { Brawl: 1, Craft: 1, Sneak: 3 } });
  const over = r.problems.find((p) => p.what.includes("over the budget"));
  assert.equal(over?.what, "10 XP over the budget of 30");
  assert.equal(over?.cite, "Base p.2");
  assert.equal(over?.severity, "error");
  assert.ok(!run(lamplighter).problems.some((p) => p.what.includes("over the budget")));
});

test("the Tree of Learning needs as many Skills with points as the rating, and the species maximum caps a rating", () => {
  const two = run({ ...lamplighter, skills: { Sneak: 3 } }); // Sneak and Lore only: two Skills
  assert.ok(whats(two).includes("Sneak 3 needs 3 Skills with points (the Tree of Learning)"));
  assert.equal(two.problems.find((p) => p.what.includes("Tree"))?.cite, "Base p.7");
  const three = run({ ...lamplighter, skills: { Sneak: 3, Brawl: 1 } });
  assert.ok(!whats(three).some((w) => w.includes("Tree")));
  // the same build with the switch off in the params
  const off = resolveBuild({
    params: BuildParams.parse({ ...SAMPLE_PARAMS_INPUT, treeOfLearning: { enabled: false, cite: "Base p.7" } }),
    catalogue: sampleCatalogue(),
    build: { ...lamplighter, skills: { Sneak: 3 } },
  });
  assert.ok(!whats(off).some((w) => w.includes("Tree")));

  const tall = run({ ...lamplighter, attributes: { MGT: 5 } });
  assert.ok(whats(tall).includes("Might 5 is over the Heron-kin maximum of 4"));
  assert.equal(tall.problems.find((p) => p.what.includes("maximum"))?.cite, "Base p.19");
  assert.ok(!whats(run({ ...lamplighter, attributes: { MGT: 4 } })).some((w) => w.includes("maximum")));
});

test("a granted talent whose requirement fails is the GM's to tick, and the approval path clears it", () => {
  const r = run(lamplighter);
  const item = r.problems.find((p) => p.what.startsWith("Old Rite"));
  assert.equal(item?.what, "Old Rite (granted): needs Lore 3");
  assert.equal(item?.severity, "gm");
  assert.ok(item?.path);
  const ticked = run({ ...lamplighter, gm: { approved: [item!.path!] } });
  assert.ok(!whats(ticked).some((w) => w.startsWith("Old Rite")));
  // a bought talent with the same requirement is a refusal, not a tick
  const bought = run({ ...lamplighter, talents: [{ id: "hardy" }], attributes: {} });
  assert.equal(bought.problems.find((p) => p.what.startsWith("Hardy"))?.severity, "error");
  // raising Lore meets it, so nothing is asked
  const met = run({ ...lamplighter, skills: { Lore: 3, Brawl: 1 } });
  assert.ok(!whats(met).some((w) => w.startsWith("Old Rite")));
});

test("a [PLACEHOLDER] keyword is filled by a sub-faction, and a successor with no traits takes its founder's", () => {
  const open = run(lamplighter);
  const ask = open.pending.find((p) => p.path === "fill/guild");
  assert.equal(ask?.of, "Ironhand, Sparrow"); // the unofficial guild is not offered
  const ironhand = run({ ...lamplighter, fills: { "[GUILD]": { id: "ironhand" } } });
  assert.deepEqual(ironhand.sheet.keywords, ["WARDEN", "IRONHAND"]);
  assert.ok(ironhand.sheet.abilities.some((a) => a.name === "Forged"));
  assert.ok(ironhand.sheet.abilities.some((a) => a.name === "Temper"));
  assert.ok(!ironhand.pending.some((p) => p.path === "fill/guild"));
  const sparrow = run({ ...lamplighter, fills: { "[GUILD]": { id: "sparrow" } } });
  assert.deepEqual(sparrow.sheet.keywords, ["WARDEN", "SPARROW"]);
  assert.ok(sparrow.sheet.abilities.some((a) => a.name === "Forged")); // the founder's trait
  assert.ok(sparrow.who.keywords.includes("SPARROW"));
  // a sub-faction of another kind of placeholder, or not in the catalogue, fills nothing
  assert.ok(
    whats(run({ ...lamplighter, fills: { "[GUILD]": { id: "nobody" } } })).includes("nobody doesn't fill [GUILD]"),
  );
  // a holder of the gene-seed keyword ignores a trait flagged for it
  const hardened = run({
    tier: 2,
    archetypeId: "beacon-keeper",
    speciesId: "heron-kin",
    fills: { "[GUILD]": { id: "ironhand" } },
  });
  assert.ok(hardened.sheet.abilities.some((a) => a.name === "Forged"));
  assert.ok(!hardened.sheet.abilities.some((a) => a.name === "Temper"));
});

test("a write-in needs the GM unless the keyword allows it, and the second any-keyword pick must differ", () => {
  const writeIn = run({ ...lamplighter, fills: { "[GUILD]": { writeIn: "WANDERERS" } } });
  const tick = writeIn.problems.find((p) => p.what.includes("can't be written in"));
  assert.equal(tick?.severity, "gm");
  assert.equal(tick?.path, "fill/guild");
  assert.equal(tick?.cite, "House rule 2");
  assert.deepEqual(writeIn.sheet.keywords, ["WARDEN", "WANDERERS"]);
  const cleared = run({
    ...lamplighter,
    fills: { "[GUILD]": { writeIn: "WANDERERS" } },
    gm: { approved: ["fill/guild"] },
  });
  assert.ok(!whats(cleared).some((w) => w.includes("can't be written in")));

  const wayfarer = { tier: 1, archetypeId: "wayfarer", speciesId: "heron-kin" };
  const same = run({ ...wayfarer, fills: { "[WILD]": { writeIn: "WARDEN" }, "[WILD 2]": { writeIn: "WARDEN" } } });
  assert.ok(whats(same).some((w) => w.startsWith("[WILD 2] repeats WARDEN")));
  const differ = run({ ...wayfarer, fills: { "[WILD]": { writeIn: "WARDEN" }, "[WILD 2]": { writeIn: "ASHEN-KIN" } } });
  assert.ok(!whats(differ).some((w) => w.includes("repeats")));
  assert.deepEqual(differ.sheet.keywords, ["DRIFTER", "WARDEN", "ASHEN-KIN"]);
});

test("Ascension at creation takes one package, priced at the campaign Tier, and not an advancement one", () => {
  const r = run({ tier: 3, archetypeId: "lamplighter", packages: ["rising-banner"] });
  const row = r.ledger.find((l) => l.what.startsWith("Rising Banner"));
  assert.equal(row?.xp, 5 * 3); // { perTier: 5 } x the campaign Tier
  assert.equal(r.sheet.mods.influence, 2); // { perTier: 1 } x the two Tiers ascended
  assert.ok(r.sheet.keywords.includes("BANNERED"));
  assert.ok(!r.pending.some((p) => p.path === "ascension"));
  // none bought: asked for, naming the Tiers
  const none = run({ tier: 3, archetypeId: "lamplighter" });
  assert.equal(none.pending.find((p) => p.path === "ascension")?.what, "Buy one Ascension Package (Tier 1 → 3)");
  // two at once, or one with no Tier to ascend
  assert.ok(
    whats(run({ tier: 3, archetypeId: "lamplighter", packages: ["rising-banner", "veil-cloak"] })).includes(
      "Creation Ascension takes one Ascension Package",
    ),
  );
  assert.ok(
    whats(run({ ...lamplighter, packages: ["veil-cloak"] })).includes(
      "Lamplighter is already Tier 1: no Creation Ascension",
    ),
  );
  // an advancement package that is not for creation
  const late = run({ ...lamplighter, packages: ["second-wind"] });
  assert.ok(whats(late).includes("Second Wind can't be taken at creation"));
  assert.equal(late.ledger.find((l) => l.what.startsWith("Second Wind"))?.xp, 6);
});

test("in play, each Tier gained is one package slot, priced at the Tier its Ascension reached", () => {
  const play = { tier: 3, xpEarned: 100 };
  const build = { ...lamplighter, advancement: { packages: ["rising-banner", "veil-cloak"] } };
  const r = run(build, { play });
  const rows = r.ledger.filter((l) => l.pool === "advancement");
  assert.deepEqual(
    rows.map((l) => [l.what, l.xp]),
    [
      ["Rising Banner (ascension package)", 5 * 2], // the first Ascension reached Tier 2
      ["Veil Cloak (ascension package)", 12],
    ],
  );
  assert.ok(!r.pending.some((p) => p.path === "advance/ascension"));
  assert.deepEqual(r.advancement, { budget: 100, spent: 22, rank: 4, tier: 3 });
  // one slot short: asked for, and the Milestone waiver excuses only the latest
  const short = run({ ...lamplighter, advancement: { packages: ["veil-cloak"] } }, { play });
  assert.equal(
    short.pending.find((p) => p.path === "advance/ascension")?.what,
    "Buy one Ascension Package (Tier 2 → 3)",
  );
  const waived = run(
    { ...lamplighter, advancement: { packages: ["veil-cloak"] } },
    { play: { ...play, packageWaived: true } },
  );
  assert.ok(!waived.pending.some((p) => p.path === "advance/ascension"));
  // one more than the Ascensions, or any at all before the group has Ascended
  assert.ok(
    whats(
      run({ ...lamplighter, advancement: { packages: ["veil-cloak", "veil-cloak", "veil-cloak"] } }, { play }),
    ).some((w) => w.includes("each Ascension takes one Ascension Package")),
  );
  assert.ok(
    whats(run({ ...lamplighter, advancement: { packages: ["veil-cloak"] } }, { play: { tier: 1, xpEarned: 10 } })).some(
      (w) => w.includes("there has been no Ascension"),
    ),
  );
  // an advancement package is not a slot
  const adv = run({ ...lamplighter, advancement: { packages: ["second-wind"] } }, { play: { tier: 1, xpEarned: 10 } });
  assert.equal(adv.ledger.find((l) => l.what.startsWith("Second Wind"))?.pool, "advancement");
  // the budget is what was earned
  assert.ok(!whats(adv).some((w) => w.includes("earned in play")));
  const broke = run({ ...lamplighter, advancement: { packages: ["second-wind"] } }, { play: { tier: 1, xpEarned: 3 } });
  assert.ok(whats(broke).includes("3 XP more than the 3 earned in play"));
  assert.equal(broke.problems.find((p) => p.what.includes("earned in play"))?.cite, "Base p.3");
});

test("an Archetype Ascension needs the Rank, the Faction, a Tier the group reached, and the GM's word", () => {
  const to = (archetypeId: string) => ({ ...lamplighter, advancement: { archetypeAscension: { archetypeId } } });
  const ok = run(to("beacon-keeper"), { play: { tier: 2, xpEarned: 40 } });
  assert.ok(
    ok.ledger.some((l) => l.what === "Beacon-keeper (Archetype Ascension)" && l.xp === 0 && l.pool === "advancement"),
  );
  assert.ok(ok.sheet.abilities.some((a) => a.name === "Tall Light"));
  assert.ok(ok.sheet.archetype.includes("Beacon-keeper"));
  const gm = ok.problems.find((p) => p.what.startsWith("Archetype Ascension to Beacon-keeper"));
  assert.equal(gm?.path, "advance/archetype/beacon-keeper");
  // the ratings it grants none of are bought: the new Archetype prints more than the old left
  assert.ok(whats(ok).some((w) => w.startsWith("Beacon-keeper needs Might 2 of 3")));
  const rank = run(to("beacon-keeper"), { play: { tier: 2, xpEarned: 10 } });
  assert.ok(whats(rank).includes("Archetype Ascension needs Rank 2; 10 XP earned is Rank 1"));
  assert.ok(
    whats(run(to("wayfarer"), { play: { tier: 2, xpEarned: 40 } })).includes(
      "Wayfarer is not an Archetype of Lamplighter's Faction",
    ),
  );
  assert.ok(
    whats(run(to("pyre-lord"), { play: { tier: 2, xpEarned: 40 } })).some((w) =>
      w.includes("not a Tier the group Ascended to (2–2)"),
    ),
  );
  assert.ok(
    whats(run(to("beacon-keeper"), { play: { tier: 1, xpEarned: 40 } })).some((w) =>
      w.includes("so there has been no Ascension"),
    ),
  );
  // it takes the Ascension's slot, so a package then has none left
  const both = run(
    {
      ...to("beacon-keeper"),
      advancement: { archetypeAscension: { archetypeId: "beacon-keeper" }, packages: ["veil-cloak"] },
    },
    { play: { tier: 2, xpEarned: 40 } },
  );
  assert.ok(
    whats(both).some((w) => w.includes("each Ascension takes one Ascension Package or an Archetype Ascension")),
  );
});

test("the purchase history dates rows and prices nothing, with one key per rating point", () => {
  const advancement = {
    attributes: { AGI: 5 },
    talents: [{ id: "toughened" }, { id: "toughened" }],
    languages: ["old-cant"],
  };
  const play = { tier: 1, xpEarned: 100 };
  const plain = run({ ...lamplighter, advancement }, { play });
  const rows = plain.ledger.filter((l) => l.pool);
  assert.deepEqual(
    rows.map((l) => [l.key, l.xp]),
    [
      ["advance/talent/toughened", 2], // talents are priced before ratings, as the source orders them
      ["advance/talent/toughened~2", 2],
      ["advance/attribute/AGI/4", 16 - 8], // one row per rating point, the cumulative table's difference
      ["advance/attribute/AGI/5", 28 - 16],
      ["advance/language/old-cant", 2],
    ],
  );
  assert.ok(rows.every((l) => l.session === undefined));
  const dated = run(
    {
      ...lamplighter,
      advancement: { ...advancement, boughtIn: { "advance/attribute/AGI/4": 2, "advance/talent/toughened~2": 5 } },
    },
    { play },
  );
  assert.deepEqual(
    dated.ledger.filter((l) => l.pool).map((l) => l.session),
    [undefined, 5, 2, undefined, undefined],
  );
  const strip = (r: ReturnType<typeof run>) => ({ ...r, ledger: r.ledger.map(({ session: _, ...l }) => l) });
  assert.deepEqual(strip(dated), strip(plain));
  assert.equal(purchaseKey({ kind: "talent", id: "keen-sense", choice: "sight" }), "advance/talent/keen-sense:sight");
  // a power's later price holds only in play, and an attribute row is cumulative
  const power = run({
    tier: 1,
    archetypeId: "tinker",
    speciesId: "stoneborn",
    powers: ["kindle"],
    advancement: { powers: [] },
  });
  assert.equal(power.ledger.find((l) => l.what.startsWith("Kindle"))?.xp, 3);
  const later = run(
    { tier: 1, archetypeId: "tinker", speciesId: "stoneborn", advancement: { powers: ["kindle"] } },
    { play },
  );
  assert.equal(later.ledger.find((l) => l.what.startsWith("Kindle"))?.xp, 6);
});

test("keyword grants run until nothing new arrives, and a gated grant waits for the character", () => {
  const tinker = run({ tier: 1, archetypeId: "tinker", speciesId: "stoneborn" });
  // GIFTED gives EMBER-BORN, which gives SPARKED, which gives a Trait bonus
  assert.deepEqual(tinker.sheet.keywords, ["DRIFTER", "GIFTED", "EMBER-BORN", "SPARKED"]);
  assert.equal(tinker.sheet.mods.grit, 1);
  assert.ok(!tinker.sheet.keywords.includes("SEER")); // gated on HARDENED, which a Tinker is not
  const bought = run({ tier: 1, archetypeId: "tinker", speciesId: "stoneborn", powers: ["spark", "ebb"] });
  assert.ok(!whats(bought).some((w) => w.startsWith("Spark")));
  assert.ok(whats(bought).some((w) => w.startsWith("Ebb is from a Discipline you can't learn")));
  // the same grant for a character that holds the gate keyword
  const gated = run({ tier: 1, archetypeId: "tinker", speciesId: "stoneborn", gm: { keywords: ["HARDENED"] } });
  assert.ok(gated.sheet.keywords.includes("SEER")); // a keyword the GM rules in is held when the gate is checked
  const seer = resolveBuild({
    params,
    catalogue: {
      ...sampleCatalogue(),
      creation: {
        ...sampleCatalogue().creation,
        archetypes: sampleCatalogue().creation.archetypes.map((a) =>
          a.id === "tinker" ? { ...a, keywords: [...a.keywords, "HARDENED"] } : a,
        ),
      },
    },
    build: { tier: 1, archetypeId: "tinker", speciesId: "stoneborn" },
  });
  assert.ok(seer.sheet.keywords.includes("SEER"));
});

test("a talent with options, per choice, repeatable", () => {
  const sense = (choice?: string) => ({ id: "keen-sense", choice });
  const two = run({ ...lamplighter, talents: [sense("sight"), sense("smell")] });
  assert.deepEqual(
    two.sheet.talents.map((t) => t.name).filter((n) => n.startsWith("Keen")),
    ["Keen Sense (sight)", "Keen Sense (smell)"],
  );
  assert.equal(two.ledger.filter((l) => l.what.startsWith("Keen Sense")).length, 2);
  assert.ok(
    whats(run({ ...lamplighter, talents: [sense("sight"), sense("sight")] })).includes("Keen Sense is already taken"),
  );
  assert.ok(whats(run({ ...lamplighter, talents: [sense()] })).includes("Keen Sense: choose what it applies to"));
  assert.ok(
    whats(run({ ...lamplighter, talents: [sense("taste")] })).includes("Keen Sense: choose one of sight, smell, touch"),
  );
  // an option may be written in any case
  assert.ok(!whats(run({ ...lamplighter, talents: [sense("SIGHT")] })).some((w) => w.startsWith("Keen")));
  // a choice with no list of options
  const quarry = run({
    ...lamplighter,
    talents: [
      { id: "quarry", choice: "wolves" },
      { id: "quarry", choice: "crows" },
    ],
  });
  assert.ok(!whats(quarry).some((w) => w.startsWith("Quarry")));
  // plainly repeatable, and one that is not
  const tough = run({ ...lamplighter, talents: [{ id: "toughened" }, { id: "toughened" }] });
  assert.equal(tough.sheet.talents.filter((t) => t.name === "Toughened").length, 2);
  assert.ok(
    whats(run({ ...lamplighter, talents: [{ id: "iron-nerve" }, { id: "iron-nerve" }] })).includes(
      "Iron Nerve is already taken",
    ),
  );
  // a granted talent with options asks for its choice at the grant's own path
  const granted = run({ tier: 1, archetypeId: "tinker", speciesId: "stoneborn" });
  const ask = granted.pending.find((p) => p.path.endsWith("/choice"));
  assert.deepEqual(ask?.options, ["sight", "smell", "touch"]);
  const answered = run({ tier: 1, archetypeId: "tinker", speciesId: "stoneborn", choices: { [ask!.path]: [1] } });
  assert.ok(answered.sheet.talents.some((t) => t.name === "Keen Sense (smell)"));
});

const wargear = (id: string) => SAMPLE_WARGEAR.get(id)!;
const match = (id: string, f: Parameters<typeof wargearMatches>[1], t = { tier: 1, newTier: 1 }) =>
  wargearMatches(wargear(id), f, t, params);

test("wargearMatches narrows by every filter field", () => {
  assert.ok(match("rope", {})); // an empty filter is any item
  assert.ok(match("plate", { kinds: ["armour", "upgrade"] }) && !match("rope", { kinds: ["armour"] }));
  assert.ok(match("hunting-bow", { weapon: "ranged" }) && !match("hunting-bow", { weapon: "melee" }));
  assert.ok(match("lantern-staff", { weapon: "melee" }) && !match("rope", { weapon: "melee" }));
  assert.ok(!match("hand-axe", { weapon: "melee" })); // a weapon that is thrown is not melee here, whatever its reach
  assert.ok(match("rope", { categories: ["Kit"] }) && !match("rope", { categories: ["Arms"] }));
  assert.ok(match("signal-horn", { nameIncludes: "SIGNAL" }) && !match("rope", { nameIncludes: "horn" }));
  assert.ok(match("hunting-bow", { wargearKeywords: ["BOW", "TOOL"] }) && !match("rope", { wargearKeywords: ["BOW"] }));
  assert.ok(
    match("hunting-bow", { allKeywords: ["WARDEN", "BOW"] }) &&
      !match("lantern-staff", { allKeywords: ["WARDEN", "BOW"] }),
  );
  assert.ok(match("hunting-bow", { weaponTraits: ["slow"] })); // by name, without the rating
  assert.ok(!match("hunting-bow", { notWeaponTraits: ["Slow"] }) && match("sling", { notWeaponTraits: ["Slow"] }));
  assert.ok(match("plate", { weaponTraits: ["Heavy (2)"] }) && !match("plate", { weaponTraits: ["Heavy (3)"] })); // a bracket must match
  assert.ok(match("hunting-bow", { maxValue: 3 }) && !match("hunting-bow", { maxValue: 2 }));
  assert.ok(
    match("hunting-bow", { maxValue: { tierPlus: 2 } }, { tier: 1, newTier: 9 }) &&
      !match("hunting-bow", { maxValue: { tierPlus: 1 } }),
  );
  assert.ok(
    match("hunting-bow", { maxValue: { newTierPlus: 1 } }, { tier: 0, newTier: 2 }) &&
      !match("hunting-bow", { maxValue: { newTierPlus: 1 } }),
  );
  assert.ok(match("sling", { rarity: { atMost: "Scarce" } }) && !match("plate", { rarity: { atMost: "Scarce" } }));
  assert.ok(match("plate", { rarity: { atLeast: "Hard" } }) && !match("sling", { rarity: { atLeast: "Hard" } }));
  assert.ok(
    match("plate", { rarity: { atLeast: "Hard", atMost: "Hard" } }) &&
      !match("twin-blades", { rarity: { atLeast: "Hard", atMost: "Hard" } }),
  );
  // the rarity order is the params'
  const flipped = BuildParams.parse({
    ...SAMPLE_PARAMS_INPUT,
    rarity: { ...SAMPLE_PARAMS_INPUT.rarity, order: [...SAMPLE_PARAMS_INPUT.rarity.order].reverse() },
  });
  assert.ok(wargearMatches(wargear("plate"), { rarity: { atMost: "Hard" } }, { tier: 1, newTier: 1 }, flipped));
});

test("a wargear pick takes only items that qualify, and the best armour is the one worn", () => {
  const tinker = { tier: 1, archetypeId: "tinker", speciesId: "stoneborn" };
  const path = "archetype/tinker/wargear/0";
  assert.equal(run(tinker).pending.find((p) => p.path === path)?.what, "Pick 1 wargear");
  const rope = run({ ...tinker, choices: { [path]: ["rope"] } });
  assert.ok(rope.sheet.gear.some((g) => g.startsWith("Rope")));
  assert.ok(!rope.pending.some((p) => p.path === path));
  const bad = run({ ...tinker, choices: { [path]: ["plate"] } });
  assert.ok(whats(bad).includes("Plate Harness doesn't qualify for this pick"));
  assert.ok(!bad.sheet.gear.some((g) => g.startsWith("Plate")));
  // Value 3 is over "Tier + 1"
  assert.ok(
    whats(run({ ...tinker, choices: { [path]: ["signal-horn"] } })).includes(
      "Signal Horn doesn't qualify for this pick",
    ),
  );
  // a count of items matching a filter
  const held = ctx({ gear: [{ name: "Rope", qty: 1, scope: "character", wargearId: "rope", from: "x" }] });
  assert.equal(meets({ kind: "wargearCount", of: { kinds: ["equipment"] }, min: 1 }, held), true);
  assert.equal(meets({ kind: "wargearCount", of: { kinds: ["armour"] }, min: 1 }, held), "needs 1 of armour");

  // two suits: the better is worn, the other is a gear line; a mod adds to the worn one's AR
  const kit = run({ tier: 1, advanced: { wargear: ["leather-coat", "plate"] }, speciesId: "stoneborn" });
  assert.equal(kit.sheet.armour.name, "Plate Harness");
  assert.equal(kit.sheet.armour.ar, 5);
  assert.ok(kit.sheet.gear.some((g) => g.startsWith("Leather Coat")));
  assert.ok(!kit.sheet.gear.some((g) => g.startsWith("Plate")));
  // powered armour adds to Might for a throw, and a "+N Pace" trait adds Speed
  const frame = run({ ...tinker, choices: { [path]: ["rope"] } });
  assert.equal(frame.sheet.armour.ar, 3 + 1); // the Tinker's armourRating grant
  assert.equal(frame.sheet.mods.speed, 1);
  const axe = frame.sheet.weapons.find((w) => w.name === "Hand Axe");
  assert.ok(axe?.traits.includes(`Hurled (${(3 + 2) * 3} m)`)); // (Might 3 + Powered 2) x 3
  assert.equal(axe?.melee, true);
});

test("Advanced Creation takes a kit within the Tier's limits, strictly under the total", () => {
  const adv = (wargear: string[], tier = 1) => run({ tier, advanced: { wargear }, speciesId: "stoneborn" });
  assert.equal(adv([]).budget, 80 + 8);
  assert.ok(adv(["rope", "lens"]).problems.every((p) => !p.what.includes("Total Value")));
  // Tier 1: total under 12, no item over 6, no rare piece
  assert.ok(whats(adv(["plate", "plate"])).includes("Total Value 12 must be under 12"));
  assert.ok(whats(adv(["plate"])).some((w) => w.includes("1 Hard pieces; Tier 1 allows 0")));
  assert.ok(whats(adv(["twin-blades"])).includes("Twin Blades is Value 8, over the Tier 1 maximum of 6"));
  assert.ok(whats(adv(["void-glaive"], 3)).includes("Void Glaive is Unique: no Tier takes one"));
  assert.ok(whats(adv(["twin-blades"], 3)).every((w) => !w.includes("maximum"))); // the Tier 3 row has no maximum
  // the table stops at its last row, so a higher Tier uses it and asks the GM
  const high = adv(["rope"], 4);
  const stop = high.problems.find((p) => p.what.startsWith("Advanced Creation's Wargear table stops"));
  assert.equal(stop?.what, "Advanced Creation's Wargear table stops at Tier 3; Tier 4 uses its Tier 3 row");
  assert.equal(stop?.severity, "gm");
  // an upgrade is fitted, not carried; an unknown id is refused
  assert.ok(whats(adv(["sight-lens"])).includes("Sight Lens is an upgrade, not Wargear"));
  assert.ok(whats(adv(["nope"])).includes("Unknown wargear nope"));
  // the species pays its own XP
  assert.ok(adv([]).ledger.some((l) => l.what === "Stoneborn (species)" && l.xp === 4));
  // a build takes an Archetype or Advanced Creation, not both
  assert.throws(() => run({ tier: 1, archetypeId: "lamplighter", advanced: { wargear: [] } }));
});

test("the homebrew gate follows the sources' official flag", () => {
  const outlander = { tier: 1, archetypeId: "outlander", speciesId: "heron-kin" };
  const closed = run(outlander);
  assert.ok(whats(closed).includes("Outlander is homebrew (Extra), and this campaign allows none"));
  assert.ok(closed.sheet.abilities.some((a) => a.name === "Far Roads"));
  assert.ok(!closed.sheet.abilities.some((a) => a.name === "Borrowed Rule")); // a homebrew rule on a record
  const open = run(outlander, { homebrew: true });
  assert.ok(!whats(open).some((w) => w.includes("homebrew")));
  assert.ok(open.sheet.abilities.some((a) => a.name === "Borrowed Rule"));
  // the flag is the params': the same source made official lets it in
  const official = BuildParams.parse({
    ...SAMPLE_PARAMS_INPUT,
    sources: {
      ...SAMPLE_PARAMS_INPUT.sources,
      list: [SAMPLE_PARAMS_INPUT.sources.list[0], { id: "extra", cite: "Extra", official: true }],
    },
  });
  const r = resolveBuild({ params: official, catalogue: sampleCatalogue(), build: outlander });
  assert.ok(!r.problems.some((p) => p.what.includes("homebrew")));
  // a homebrew sub-faction is not offered while the campaign allows none
  assert.equal(run(lamplighter).pending.find((p) => p.path === "fill/guild")?.of, "Ironhand, Sparrow");
  assert.equal(
    run(lamplighter, { homebrew: true }).pending.find((p) => p.path === "fill/guild")?.of,
    "Ironhand, Sparrow, Ashen",
  );
});

test("a gm requirement and a story grant put their id in the approval path, not their wording", () => {
  const r = run({ tier: 1, archetypeId: "oathkeeper" });
  const req = r.problems.find((p) => p.what.startsWith("Oath Witness"));
  assert.ok(req?.path?.endsWith("/requires/oath-witness"));
  assert.equal(req?.what, "Oath Witness: Swore before a witness");
  const story = r.problems.find((p) => p.what === "Owes an old debt");
  assert.equal(story?.severity, "gm");
  assert.equal(story?.path, "archetype/oathkeeper/0/old-debt");
  // rewording the label moves nothing
  const reworded = resolveBuild({
    params,
    catalogue: (() => {
      const c = sampleCatalogue();
      return {
        ...c,
        creation: {
          ...c.creation,
          talents: c.creation.talents.map((t) =>
            t.id === "oath-witness"
              ? { ...t, requires: [{ kind: "gm" as const, id: "oath-witness", label: "Another wording" }] }
              : t,
          ),
        },
      };
    })(),
    build: { tier: 1, archetypeId: "oathkeeper" },
  });
  assert.equal(reworded.problems.find((p) => p.what.startsWith("Oath Witness"))?.path, req?.path);
  // both approved: nothing is left to tick
  const ticked = run({ tier: 1, archetypeId: "oathkeeper", gm: { approved: [req!.path!, story!.path!] } });
  assert.ok(!whats(ticked).some((w) => w.startsWith("Oath Witness") || w === "Owes an old debt"));
  assert.ok(buildReady(ticked) === false); // pending choices remain (the background and the language)
});

test("resolveBuild reads nothing but its arguments: two params on one catalogue give two ledgers", () => {
  const build = { ...lamplighter, attributes: { MGT: 4 }, wealth: 2 };
  const other = BuildParams.parse({
    ...SAMPLE_PARAMS_INPUT,
    startingXp: { perTier: 100, cite: "Other p.1" },
    attributeXp: { table: [0, 0, 5, 11, 20, 33, 50], cite: "Other p.2" },
    wealth: { ...SAMPLE_PARAMS_INPUT.wealth, xp: 3 },
  });
  const catalogue = sampleCatalogue();
  const a = resolveBuild({ params, catalogue, build });
  const b = resolveBuild({ params: other, catalogue, build });
  assert.deepEqual(
    a.ledger.map((l) => l.xp),
    [20, 13, 4],
  );
  assert.deepEqual(
    b.ledger.map((l) => l.xp),
    [20, 15, 6],
  );
  assert.deepEqual([a.budget, b.budget], [80, 100]);
  assert.equal(b.ledger[1]?.cite, "Other p.2");
  assert.equal(a.ledger[2]?.what, "Wealth +2");
  // and the first again, unchanged by the second
  assert.deepEqual(resolveBuild({ params, catalogue, build }), a);
});

test("params are checked: every skill links a listed attribute and the builder's own keys are listed", () => {
  assert.throws(() => BuildParams.parse({ ...SAMPLE_PARAMS_INPUT, links: { influence: "XXX", poweredArmour: "MGT" } }));
  assert.throws(() =>
    BuildParams.parse({
      ...SAMPLE_PARAMS_INPUT,
      vocabulary: { ...SAMPLE_PARAMS_INPUT.vocabulary, mods: [{ key: "guard" }] },
    }),
  );
  assert.throws(() => BuildParams.parse({ ...SAMPLE_PARAMS_INPUT, movementTrait: "(" }));
});

test("a background gives only its bonus row's bonus and grants; an option group prices by order", () => {
  const bg = { tableId: "warden-roots", roots: "Lowland", deed: "Walked Alone", dream: "A Quiet Hearth" };
  const roots = run({ ...lamplighter, background: { ...bg, bonus: "roots" } });
  assert.equal(roots.sheet.mods.guard, 2); // Steady Flame, and the Lowland row
  assert.ok(!roots.sheet.talents.some((t) => t.name === "Iron Nerve"));
  const deed = run({ ...lamplighter, background: { ...bg, bonus: "deed" } });
  assert.ok(deed.sheet.talents.some((t) => t.name === "Iron Nerve"));
  assert.equal(
    run({ ...lamplighter, background: { tableId: "warden-roots" } }).pending.filter((p) =>
      p.path.startsWith("background/"),
    ).length,
    4,
  );
  const marks = run({
    ...lamplighter,
    options: [
      { groupId: "marks", name: "Wing Mark" },
      { groupId: "marks", name: "Beak Mark" },
    ],
  });
  assert.deepEqual(
    marks.ledger.filter((l) => l.what.includes("(Marks)")).map((l) => l.xp),
    [0, 2],
  );
  assert.ok(whats(marks).includes("Marks: at most 1")); // pick "tier" at Tier 1
  assert.equal(marks.sheet.mods.speed, 1);
});

test("requirements and reach", () => {
  const c = ctx({});
  assert.equal(meets({ kind: "attribute", attribute: "MGT", min: 2 }, c), true);
  assert.equal(meets({ kind: "attribute", attribute: "MGT", min: 3 }, c), "needs Might 3");
  assert.equal(meets({ kind: "tier", min: 2 }, c), "needs Tier 2–4"); // the upper bound is the params'
  assert.deepEqual(meets({ kind: "gm", id: "x", label: "Judge it" }, c), { gm: "Judge it" });
  assert.equal(
    meets(
      {
        kind: "either",
        of: [
          { kind: "rank", min: 3 },
          { kind: "influence", min: 1 },
        ],
      },
      c,
    ),
    true,
  );
  const who = { species: ["heron-kin"], archetypeId: "lamplighter", keywords: ["WARDEN"], buyable: ["SEER"] };
  assert.equal(outOfReach([{ kind: "keyword", anyOf: ["SEER"] }], who), false);
  assert.equal(outOfReach([{ kind: "keyword", anyOf: ["DRIFTER"] }], who), true);
  assert.equal(outOfReach([{ kind: "species", anyOf: ["stoneborn"] }], who), true);
  assert.equal(outOfReach([{ kind: "species", anyOf: ["stoneborn"] }], { ...who, species: null }), false);
});

function ctx(over: Partial<BuildCtx>): BuildCtx {
  return {
    params,
    attributes: { MGT: 2, AGI: 3, WIT: 3, PRE: 2 },
    skills: {},
    keywords: new Set(),
    species: [],
    archetypeId: null,
    subFactionIds: new Set(),
    talents: new Set(),
    talentCategories: [],
    powers: [],
    gear: [],
    wargear: SAMPLE_WARGEAR,
    options: [],
    influence: 1,
    rank: 1,
    tier: 1,
    ...over,
  };
}
