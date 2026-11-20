import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerRow } from "@inconsistable/rules-engine";

import {
  answerChoice,
  ascensionOf,
  backgroundRows,
  ctxFor,
  factionOffers,
  declineChoice,
  filterRows,
  gearName,
  issuesByStep,
  isReady,
  languageRows,
  languageWayOf,
  LEDGER_STEPS,
  ledgerGroups,
  lookupsOf,
  openingStep,
  pickArchetype,
  pickAscension,
  pickBackgroundBonus,
  pickBackgroundRow,
  pickBackgroundTable,
  pickPlayAscension,
  ratingRow,
  reachOf,
  recordCite,
  removeTalentAt,
  resolveDraft,
  setAdvancedFaction,
  setFill,
  setGmMod,
  setLanguage,
  setRating,
  setTalentChoice,
  setWealth,
  startAdvanced,
  stepsFor,
  tapLanguage,
  tapTalent,
  toggleApproval,
  toggleArchetypeAscension,
  toggleGmGearAdd,
  toggleGmGearRemove,
  toggleGmKeyword,
  toggleOption,
  writeInKeyword,
  type LedgerBuild,
} from "./ledger.ts";
import { SAMPLE_PARAMS as params, sampleCatalogue } from "./sample.ts";

// The engine's invented game throughout (lib/ledger/sample.ts): its names, prices and pages are its own.

const catalogue = sampleCatalogue();
const lookups = lookupsOf(catalogue.creation);
const run = (build: LedgerBuild, play?: { tier: number; xpEarned: number }) =>
  resolveDraft({ params, catalogue, build, play }).resolved!;
const lamplighter: LedgerBuild = { tier: 1, archetypeId: "lamplighter" };

test("a build resolves once it names an archetype or Advanced Creation, and a malformed one is an error, not a throw", () => {
  assert.deepEqual(resolveDraft({ params, catalogue, build: { tier: 1 } }), { resolved: null, error: null });
  assert.equal(resolveDraft({ params, catalogue, build: lamplighter }).resolved?.budget, 80);
  const bad = resolveDraft({ params, catalogue, build: { tier: 99, archetypeId: "lamplighter" } });
  assert.equal(bad.resolved, null);
  assert.ok(bad.error);
  assert.equal(isReady(null), false);
});

test("the steps: ascension only when the build ascends, advance only in play, a player in play buys with earned XP", () => {
  const base = { lookups, gm: false };
  assert.deepEqual(stepsFor({ ...base, build: lamplighter }), ["tier", "archetype", "customise", "faction", "detail"]);
  const ascended = { tier: 2, archetypeId: "lamplighter" };
  assert.ok(stepsFor({ ...base, build: ascended }).includes("ascension"));
  assert.ok(stepsFor({ ...base, build: { tier: 1, advanced: {} } }).includes("ascension"));
  assert.deepEqual(stepsFor({ ...base, build: lamplighter, play: { tier: 1, xpEarned: 40 } }), ["advance"]);
  assert.deepEqual(stepsFor({ ...base, build: lamplighter, play: { tier: 2, xpEarned: 40 } }), [
    "ascension",
    "advance",
  ]);
  assert.deepEqual(stepsFor({ ...base, gm: true, build: lamplighter, play: { tier: 2, xpEarned: 40 } }), LEDGER_STEPS);
});

test("the opening step: the Tier when new, else the first step with something left for this seat, else customise", () => {
  const steps = stepsFor({ build: lamplighter, lookups, gm: true });
  assert.equal(openingStep({ build: { tier: 1 }, resolved: null, steps, gm: false }), "tier");
  const r = run(lamplighter);
  const first = steps.find((s) => r.pending.some((p) => p.step === s) || r.problems.some((p) => p.step === s));
  assert.equal(openingStep({ build: lamplighter, resolved: r, steps, gm: true }), first);
  // only a GM's tick left, on Detail: the GM lands there, a player on the purchases
  const gmOnly = {
    ...r,
    pending: [],
    problems: [{ step: "detail" as const, what: "x", severity: "gm" as const, path: "p" }],
  };
  assert.equal(openingStep({ build: lamplighter, resolved: gmOnly, steps, gm: true }), "detail");
  assert.equal(openingStep({ build: lamplighter, resolved: gmOnly, steps, gm: false }), "customise");
  // a player's own choice comes before a later GM tick
  const both = { ...gmOnly, pending: [{ path: "q", step: "faction" as const, what: "y", choose: 1, options: [] }] };
  assert.equal(openingStep({ build: lamplighter, resolved: both, steps, gm: false }), "faction");
  assert.equal(
    openingStep({ build: lamplighter, resolved: { ...r, pending: [], problems: [] }, steps, gm: true }),
    "customise",
  );
});

test("pending choices and problems are counted by the step that settles them, and choices with a pick are cards", () => {
  const r = run({ tier: 2, archetypeId: "seeker" });
  const by = issuesByStep(r);
  assert.equal(by.faction.pending.length, 2); // background and [CIRCLE], answered by the step's own controls
  assert.ok(by.archetype.choices.some((c) => c.path === "archetype/seeker/0" && c.pick.kind === "attribute"));
  assert.ok(!by.archetype.pending.some((p) => p.pick)); // a picked choice is a card, not a line
  assert.equal(
    LEDGER_STEPS.reduce((n, s) => n + by[s].left, 0),
    r.pending.length + r.problems.length,
  );
  assert.equal(issuesByStep(null).tier.left, 0);
});

test("the ledger groups creation rows by step in the builder's order, and play rows by session, latest first", () => {
  const rows: LedgerRow[] = [
    { what: "b", xp: 2, step: "customise" },
    { what: "a", xp: 20, step: "archetype", cite: "Base p.20" },
    { what: "c", xp: 3, step: "customise" },
    { what: "x", xp: 4, step: "advance", pool: "advancement", session: 1 },
    { what: "y", xp: 5, step: "advance", pool: "advancement" },
    { what: "z", xp: 6, step: "advance", pool: "advancement", session: 3 },
  ];
  const { creation, sessions } = ledgerGroups(rows);
  assert.deepEqual(
    creation.map((g) => [g.step, g.rows.map((r) => r.what), g.xp]),
    [
      ["archetype", ["a"], 20],
      ["customise", ["b", "c"], 5],
    ],
  );
  assert.deepEqual(
    sessions.map((g) => [g.session, g.xp]),
    [
      [3, 6],
      [1, 4],
      [null, 5],
    ],
  );
});

test("lists: out of reach rows hide unless taken or asked for, and meets says what is still missing", () => {
  const build = lamplighter;
  const r = run(build);
  const ctx = ctxFor({ params, catalogue, lookups, build, resolved: r });
  const rows = catalogue.creation.talents.map((t) => ({
    id: t.id,
    name: t.name,
    search: recordCite(params, t),
    taken: false,
    reach: reachOf({ requires: t.requires, who: r.who, ctx }),
  }));
  const open = filterRows({ rows, query: "", reach: "open" });
  const all = filterRows({ rows, query: "", reach: "all" });
  assert.ok(open.length < all.length);
  assert.ok(all.filter((x) => x.reach.out).every((x) => !open.includes(x)));
  const hardy = rows.find((x) => x.id === "hardy")!;
  assert.deepEqual(hardy.reach.unmet, ["needs Might 3"]);
  assert.equal(hardy.reach.out, false); // a rating a purchase can still reach
  assert.equal(filterRows({ rows, query: "HARD", reach: "all" })[0]?.id, "hardy");
  assert.equal(
    filterRows({ rows, query: "base p.", reach: "all" }).length,
    rows.filter((x) => x.search.startsWith("Base")).length,
  );
  // without a resolved build nothing is ruled out
  assert.deepEqual(reachOf({ requires: lookups.talents.get("hardy")!.requires, who: null, ctx: null }), {
    out: false,
    unmet: [],
    gm: [],
  });
});

test("picking an archetype starts over, keeping the Tier, the GM's part and the languages", () => {
  const built: LedgerBuild = {
    ...lamplighter,
    attributes: { MGT: 3 },
    gm: { approved: ["x"] },
    languages: { picks: ["trade-tongue"] },
  };
  assert.equal(pickArchetype({ build: built, id: "lamplighter" }), built);
  assert.deepEqual(pickArchetype({ build: built, id: "wayfarer" }), {
    tier: 1,
    archetypeId: "wayfarer",
    gm: { approved: ["x"] },
    languages: { picks: ["trade-tongue"] },
  });
  const adv = startAdvanced({ build: built });
  assert.deepEqual(adv.advanced, { wargear: [] });
  assert.equal(adv.archetypeId, undefined);
  assert.ok(resolveDraft({ params, catalogue, build: adv }).resolved);
});

test("ratings: a tap raises one point past the sheet, returning works only where this layer bought it", () => {
  const raised = setRating({ build: lamplighter, layer: "creation", kind: "attributes", key: "MGT", to: 4 });
  assert.deepEqual(raised.attributes, { MGT: 4 });
  const r = run(raised);
  assert.equal(r.sheet.attributes.MGT, 4);
  assert.ok(r.ledger.some((l) => l.what.startsWith("Might 2 → 4")));
  const row = ratingRow({
    params,
    build: raised,
    layer: "creation",
    kind: "attributes",
    key: "MGT",
    value: 4,
    speciesMax: 4,
  });
  assert.deepEqual(row, { value: 4, cap: 4, canRaise: false, canReturn: true, next: 28 - 16 });
  const granted = ratingRow({
    params,
    build: lamplighter,
    layer: "creation",
    kind: "attributes",
    key: "AGI",
    value: 3,
  });
  assert.equal(granted.canReturn, false); // granted, not bought
  assert.equal(granted.cap, params.attributeXp.table.length - 1);
  const top = ratingRow({ params, build: lamplighter, layer: "creation", kind: "skills", key: "Lore", value: 5 });
  assert.equal(top.next, null);
  // back to the floor removes the purchase
  assert.deepEqual(
    setRating({ build: raised, layer: "creation", kind: "attributes", key: "MGT", to: 1 }).attributes,
    {},
  );
  assert.deepEqual(setRating({ build: lamplighter, layer: "creation", kind: "skills", key: "Lore", to: 0 }).skills, {});
  // in play the earned XP layer is written
  const later = setRating({ build: lamplighter, layer: "advancement", kind: "skills", key: "Lore", to: 3 });
  assert.deepEqual(later.advancement?.skills, { Lore: 3 });
  assert.equal(later.skills, undefined);
});

test("talents: a tap takes or gives back, a per-choice talent stacks, and a bracket pick is kept per copy", () => {
  const one = tapTalent({ build: lamplighter, layer: "creation", id: "hardy", repeatable: false });
  assert.deepEqual(one.talents, [{ id: "hardy" }]);
  assert.deepEqual(tapTalent({ build: one, layer: "creation", id: "hardy", repeatable: false }).talents, []);
  const two = tapTalent({ build: one, layer: "creation", id: "hardy", repeatable: "perChoice" });
  assert.equal(two.talents?.length, 2);
  const picked = setTalentChoice({ build: two, layer: "creation", index: 1, choice: " Lore " });
  assert.deepEqual(picked.talents, [{ id: "hardy" }, { id: "hardy", choice: "Lore" }]);
  assert.deepEqual(setTalentChoice({ build: picked, layer: "creation", index: 1, choice: "" }).talents?.[1], {
    id: "hardy",
  });
  assert.deepEqual(removeTalentAt({ build: picked, layer: "creation", index: 0 }).talents, [
    { id: "hardy", choice: "Lore" },
  ]);
  const later = tapTalent({ build: lamplighter, layer: "advancement", id: "hardy", repeatable: false });
  assert.deepEqual(later.advancement?.talents, [{ id: "hardy" }]);
});

test("ascension: one package at creation, a new pick replaces it; in play a pick past the slots replaces the latest", () => {
  const isAscension = (id: string) => lookups.packages.get(id)?.kind === "ascension";
  const asc = catalogue.creation.packages.filter((p) => p.kind === "ascension").map((p) => p.id);
  const other = catalogue.creation.packages.find((p) => p.kind === "advancement")!.id;
  assert.ok(asc.length >= 2);
  const base: LedgerBuild = { tier: 2, archetypeId: "lamplighter", packages: [other] };
  const a = pickAscension({ build: base, id: asc[0]!, isAscension });
  assert.deepEqual(a.packages, [other, asc[0]]);
  assert.deepEqual(pickAscension({ build: a, id: asc[1]!, isAscension }).packages, [other, asc[1]]);
  assert.deepEqual(pickAscension({ build: a, id: asc[0]!, isAscension }).packages, [other]);

  const play = { tier: 2, xpEarned: 0 };
  const p1 = pickPlayAscension({ build: lamplighter, id: asc[0]!, isAscension, play });
  assert.deepEqual(p1.advancement?.packages, [asc[0]]);
  assert.deepEqual(pickPlayAscension({ build: p1, id: asc[1]!, isAscension, play }).advancement?.packages, [asc[1]]);
  assert.deepEqual(pickPlayAscension({ build: p1, id: asc[0]!, isAscension, play }).advancement?.packages, []);
  const both = pickPlayAscension({ build: p1, id: asc[1]!, isAscension, play: { tier: 3, xpEarned: 0 } });
  assert.deepEqual(both.advancement?.packages, [asc[0], asc[1]]);
  const arch = toggleArchetypeAscension({ build: lamplighter, archetypeId: "beacon-keeper" });
  assert.deepEqual(arch.advancement?.archetypeAscension, { archetypeId: "beacon-keeper" });
  assert.equal(
    toggleArchetypeAscension({ build: arch, archetypeId: "beacon-keeper" }).advancement?.archetypeAscension,
    undefined,
  );
});

test("faction: fills, a background row by row with its bonus, options in the order taken", () => {
  const filled = setFill({ build: lamplighter, keyword: "[GUILD]", fill: { id: "ironhand" } });
  assert.ok(!run(filled).pending.some((p) => p.path === "fill/guild"));
  assert.deepEqual(setFill({ build: filled, keyword: "[GUILD]", fill: null }).fills, {});
  assert.equal(writeInKeyword("wander-ers!’s 2"), "WANDER-ERSS 2");

  const t = pickBackgroundTable({ build: filled, tableId: "warden-roots" });
  assert.deepEqual(t.background, { tableId: "warden-roots" });
  assert.equal(pickBackgroundTable({ build: t, tableId: "warden-roots" }), t);
  assert.equal(pickBackgroundRow({ build: lamplighter, row: "roots", name: "x" }), lamplighter);
  const row = pickBackgroundBonus({
    build: pickBackgroundRow({ build: t, row: "roots", name: "Hearth" }),
    row: "roots",
  });
  assert.deepEqual(row.background, { tableId: "warden-roots", roots: "Hearth", bonus: "roots" });

  const o = toggleOption({ build: lamplighter, groupId: "marks", name: "A" });
  const o2 = toggleOption({ build: o, groupId: "marks", name: "B" });
  assert.deepEqual(o2.options, [
    { groupId: "marks", name: "A" },
    { groupId: "marks", name: "B" },
  ]);
  assert.deepEqual(toggleOption({ build: o2, groupId: "marks", name: "A" }).options, [{ groupId: "marks", name: "B" }]);
});

test("the faction step offers each placeholder's sub-factions, and the tables and groups this character owns", () => {
  const r = run(lamplighter);
  const offers = factionOffers({ params, catalogue, lookups, build: lamplighter, resolved: r });
  const guild = offers.placeholders.find((p) => p.keyword === "[GUILD]")!;
  // the same sub-factions the engine names, homebrew left out
  assert.deepEqual(guild.subFactions.map((s) => s.name).join(", "), r.pending.find((p) => p.path === "fill/guild")?.of);
  assert.ok(offers.tables.some((t) => t.id === "warden-roots"));
  assert.ok(offers.tables.every((t) => !("factionId" in t.owner) || t.owner.factionId === "wardens"));
  assert.ok(offers.groups.some((g) => g.id === "marks")); // the heron-kin's
  const table = lookups.backgrounds.get("warden-roots")!;
  assert.ok(backgroundRows(table, params.vocabulary.backgroundRows[0]!).length > 0);
  assert.deepEqual(backgroundRows(table, "nothing"), []);
  // a filled placeholder stays listed, so it can be changed
  const filled = setFill({ build: lamplighter, keyword: "[GUILD]", fill: { id: "ironhand" } });
  const after = factionOffers({ params, catalogue, lookups, build: filled, resolved: run(filled) });
  assert.deepEqual(after.placeholders.find((p) => p.keyword === "[GUILD]")?.fill, { id: "ironhand" });
});

test("ascension: at creation below the Tier or Advanced, in play above it, with the faction's higher archetypes", () => {
  assert.deepEqual(ascensionOf({ build: lamplighter, lookups }), {
    atCreation: false,
    ascending: false,
    archetypes: [],
  });
  assert.equal(ascensionOf({ build: { tier: 2, archetypeId: "lamplighter" }, lookups }).atCreation, true);
  const up = ascensionOf({ build: lamplighter, lookups, play: { tier: 3, xpEarned: 0 } });
  assert.equal(up.ascending, true);
  assert.ok(up.archetypes.length > 0);
  assert.ok(up.archetypes.every((a) => a.factionId === "wardens" && a.tier > 1 && a.tier <= 3));
});

test("an Advanced faction change clears the background and what the old faction owned", () => {
  // the circle-folk own the "vows" option group, the drifters the DRIFTER keyword
  const build: LedgerBuild = {
    tier: 1,
    advanced: { factionId: "circle-folk" },
    background: { tableId: "warden-roots" },
    options: [
      { groupId: "vows", name: "Vow of Ash" },
      { groupId: "marks", name: "Wing Mark" },
    ],
  };
  assert.equal(setAdvancedFaction({ build, params, lookups, factionId: "circle-folk" }), build);
  const next = setAdvancedFaction({ build, params, lookups, factionId: undefined });
  assert.equal(next.advanced?.factionId, undefined);
  assert.equal(next.background, undefined);
  assert.deepEqual(next.options, [{ groupId: "marks", name: "Wing Mark" }]); // the species' group stays
  const drifter: LedgerBuild = {
    tier: 1,
    advanced: { factionId: "drifters" },
    fills: { DRIFTER: { writeIn: "GONE" }, "[ELSEWHERE]": { writeIn: "STAYS" } },
  };
  const moved = setAdvancedFaction({ build: drifter, params, lookups, factionId: "wardens" });
  assert.deepEqual(moved.fills, { "[ELSEWHERE]": { writeIn: "STAYS" } });
  // setting a faction drops what fills the any-keyword placeholders
  const any = { tier: 1, advanced: {}, fills: { [params.keywords.any]: { writeIn: "X" } } };
  assert.deepEqual(setAdvancedFaction({ build: any, params, lookups, factionId: "wardens" }).fills, {});
  assert.equal(setAdvancedFaction({ build: lamplighter, params, lookups, factionId: "x" }), lamplighter);
});

test("detail: a language is free or bought, never both; wealth stays in its range", () => {
  const free = setLanguage({ build: lamplighter, name: "trade-tongue", way: "picks" });
  assert.deepEqual(free.languages, { picks: ["trade-tongue"], bought: [] });
  assert.ok(!run(free).pending.some((p) => p.path === "languages"));
  const bought = setLanguage({ build: free, name: "trade-tongue", way: "bought" });
  assert.deepEqual(bought.languages, { picks: [], bought: ["trade-tongue"] });
  assert.deepEqual(setLanguage({ build: bought, name: "trade-tongue", way: null }).languages, {
    picks: [],
    bought: [],
  });
  assert.equal(setWealth({ build: lamplighter, params, to: -2 }).wealth, 0);
  assert.equal(setWealth({ build: lamplighter, params, to: 999 }).wealth, params.wealth.maxBought);
});

test("languages: Free settles the owed pick, a held language says how, Free is offered as the engine reads it", () => {
  const rowsOf = (build: LedgerBuild, resolved = run(build)) => languageRows({ params, catalogue, build, resolved });
  const byId = (rows: ReturnType<typeof rowsOf>["rows"]) => new Map(rows.map((r) => [r.language.id, r]));
  // one free pick owed, from the keywords: only Trade-tongue and Birdsong (WARDEN) can be it
  const start = rowsOf(lamplighter);
  assert.equal(start.owed, 1);
  assert.ok(byId(start.rows).get("trade-tongue")!.canFree);
  assert.ok(!byId(start.rows).get("old-cant")!.canFree);
  // a tap on Free takes it, settles the item, and the row reads as taken; nothing else can be free now
  const free = tapLanguage({ build: lamplighter, name: "trade-tongue", way: "picks" });
  const after = rowsOf(free);
  assert.equal(after.owed, 0);
  assert.equal(byId(after.rows).get("trade-tongue")!.way, "picks");
  assert.ok(byId(after.rows).get("trade-tongue")!.canFree); // a second tap gives it back
  assert.ok(!byId(after.rows).get("birdsong")!.canFree);
  assert.deepEqual(tapLanguage({ build: free, name: "trade-tongue", way: "picks" }).languages, {
    picks: [],
    bought: [],
  });
  // Buy moves a free one to bought
  const bought = tapLanguage({ build: free, name: "trade-tongue", way: "bought" });
  assert.deepEqual(bought.languages, { picks: [], bought: ["trade-tongue"] });
  assert.equal(languageWayOf({ build: bought, name: "trade-tongue" }), "bought");
  // a grant past the keywords' one: any language may be free (the engine's keyword rule holds only without grants)
  const r = run(lamplighter);
  const granted = { ...r, pending: r.pending.map((p) => (p.path === "languages" ? { ...p, choose: 2 } : p)) };
  assert.ok(byId(rowsOf(lamplighter, granted).rows).get("old-cant")!.canFree);
  // learned in play: held, and Free is closed
  const learned: LedgerBuild = { ...lamplighter, advancement: { languages: ["birdsong"] } };
  assert.equal(languageWayOf({ build: learned, name: "birdsong" }), "learned");
  assert.ok(!byId(rowsOf(learned).rows).get("birdsong")!.canFree);
  // a written-in language is listed apart
  assert.deepEqual(rowsOf(setLanguage({ build: lamplighter, name: "Gull-talk", way: "bought" })).writtenIn, [
    "Gull-talk",
  ]);
});

test("a choice: a tap answers or takes back, one-of replaces, many-of drops the oldest; declining is an empty answer", () => {
  const build: LedgerBuild = { tier: 2, archetypeId: "seeker" };
  const prompt = run(build).choices.find((c) => c.path === "archetype/seeker/2")!; // Raise 2 Skills
  const a = answerChoice({ build, prompt, value: "Lore" });
  const p2 = run(a).choices.find((c) => c.path === prompt.path)!;
  assert.deepEqual(p2.answer, ["Lore"]);
  const b = answerChoice({ build: a, prompt: p2, value: "Sneak" });
  const p3 = run(b).choices.find((c) => c.path === prompt.path)!;
  assert.deepEqual(p3.answer, ["Lore", "Sneak"]);
  assert.ok(!run(b).pending.some((p) => p.path === prompt.path));
  assert.deepEqual(answerChoice({ build: b, prompt: p3, value: "Craft" }).choices?.[prompt.path], ["Sneak", "Craft"]);
  assert.deepEqual(answerChoice({ build: b, prompt: p3, value: "Lore" }).choices?.[prompt.path], ["Sneak"]);
  const one = { path: "p", choose: 1, answer: [0] };
  assert.deepEqual(answerChoice({ build, prompt: one, value: 2 }).choices, { p: [2] });
  assert.deepEqual(declineChoice({ build, path: "p" }).choices, { p: [] });
});

test("the GM's part: a tick clears its problem, and rulings land in build.gm", () => {
  const r = run(lamplighter);
  const q = r.problems.find((p) => p.severity === "gm")!;
  const ticked = toggleApproval({ build: lamplighter, path: q.path! });
  assert.deepEqual(ticked.gm?.approved, [q.path]);
  assert.ok(!run(ticked).problems.some((p) => p.path === q.path));
  assert.deepEqual(toggleApproval({ build: ticked, path: q.path! }).gm?.approved, []);

  const kw = toggleGmKeyword({ build: lamplighter, keyword: "SEEKER" });
  assert.ok(run(kw).sheet.keywords.includes("SEEKER"));
  const mod = setGmMod({ build: lamplighter, key: "guard", value: 2 });
  assert.deepEqual(mod.gm?.mods, { guard: 2 });
  assert.deepEqual(setGmMod({ build: mod, key: "guard", value: null }).gm?.mods, {});
  const add = toggleGmGearAdd({ build: lamplighter, item: { name: "Rope", wargearId: "rope" } });
  assert.ok(run(add).sheet.gear.some((g) => g.startsWith("Rope")));
  assert.deepEqual(toggleGmGearAdd({ build: add, item: { name: "Rope", wargearId: "rope" } }).gm?.gear?.add, []);
  assert.equal(gearName("Rope (Base p.40)"), "Rope");
  const armed = (b: LedgerBuild) => run(b).sheet.weapons.some((w) => w.name === "Lantern Staff"); // the archetype's kit
  assert.ok(armed(lamplighter));
  const removed = toggleGmGearRemove({ build: lamplighter, name: "Lantern Staff" });
  assert.ok(!armed(removed));
  assert.deepEqual(toggleGmGearRemove({ build: removed, name: "Lantern Staff" }).gm?.gear?.remove, []);
});
