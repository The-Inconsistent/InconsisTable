# Parity with Auspex: the character and the player's phone

Read on 2026-11-21 from Auspex (`~/antigravity/wrath_glory`) against InconsisTable `main` at 2f16f9b. Source claims are read from code; "HAS" claims cite the target.

**Path keys.** S = `~/antigravity/wrath_glory`. sh = `S/packages/shared/src`. api = `S/apps/api/src`. wc = `S/apps/web/components`. T = `/Users/thienydo/antigravity/InconsisTable`. tw = `T/apps/web/components`. ca = `T/packages/core-schema/src/actions.ts`. port = `S/packages/data/port`. HD = a row of `T/docs/house-decisions.md`. §n = `S/docs/rules-flow.md` §11.n. Line numbers for components outside player-app, sheet-view and lib/sheet are anchors (the component's own line), not exact lines of each behaviour.

**Need codes.** R = a declaration in the generated ruleset or pack only. M = an existing mechanism used differently. B = a new general building block (named). S = a screen only.

**Size.** S, M or L.

**Caveats.** The builder screens were read through the schema (`sh/build.ts`), the step labels, the save and draft wiring in `builder.tsx`, the handler `api/character/character.actions.ts`, and a separate subagent's list of builder behaviours; most builder components were not read control by control. A few target items are marked "not checked".

## Table

### A. Creating a character

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 1 | Builder opens: GM for any or a new character, player only their own | wc/builder/builder.tsx; S/apps/web/app/c/[campaignId]/build/[characterId]/page.tsx:32-34; api/table/table.dispatch.ts:68-98 | HAS: tw/builder/ledger-build/ledger-build.tsx:71-197; HD #63 (build.save for `character:edit:own` or the GM side); ca:109 | none | – |
| 2 | Step TIER (Framework and Tier, SOURCES, homebrew switch) | wc/builder/components/tier-step/tier-step.tsx; sh/build.ts:68 | PARTIAL: tier-step exists (tw/builder/ledger/components/tier-step); the Tier is the room's campaign field (HD #63 `buildTierMismatch`). No Framework text and no SOURCES list | R (a `framework` codex field or quest) | S |
| 3 | Homebrew gate: a campaign switch lets the builder use Apocrypha and Necrontyr; official-only filters records and rules | sh/actions.ts:75 (`campaign.update homebrew`); sh/build.ts:285 `officialOnly`; tier-step.tsx:64 | MISSING as a gate: `catalogueOf` hard-codes `homebrew: true` (T/apps/web/lib/ledger/table.ts), "every source is allowed" (HD #63). Packs tag entries `homebrew` (port/creation-packs.ts entry tags) | M (attach or detach the homebrew pack, or a room option; `options[]` is declared but read by nothing) | M |
| 4 | Step ARCHETYPE: pick by Tier, search, species pick when the archetype allows several, starting-wargear choices | archetype-step.tsx; sh/build.ts:148 | HAS: tw/builder/ledger/components/archetype-step | none | – |
| 5 | Advanced Character Creation (no archetype): own species, optional Faction, buy one Archetype Ability, wargear kit by Tier (§127-128, §131, §140 as numbered in §11) | sh/build.ts:134-139 | HAS (engine ported whole, ADR 0011); archetype-step covers "or Advanced Creation" | none | – |
| 6 | Custom XP budget ("75 or 50 XP"): in the schema and resolver only; no builder control sets it | sh/build.ts:144, 400 | PARTIAL: engine only, no UI in either app | S (a budget control, if wanted) | S |
| 7 | Step CUSTOMISE: Attributes and Skills by rating to reach, Talents with bracket picks (§29), Psychic Powers, Advancement Packages, Languages | customise-step.tsx; sh/build.ts:164-178 | HAS: tw/builder/ledger/components/customise-step | none | – |
| 8 | Step FACTION: Faction, [PLACEHOLDER] fills (sub-faction or write-in, §25), Background table with one bonus row (§22), option groups paid by order | faction-step.tsx; sh/build.ts:151-162 | HAS: faction-step. The Background rows' text and objectives are dropped from the pack (port/build-catalogue.ts TEXT_KEYS) | none | – |
| 9 | Step ASCENSION in the builder: Creation Ascension Package, Ascension Package per Tier, Archetype Ascension (§67) | ascension-step.tsx; sh/build.ts:80-97 | HAS: tw/builder/ledger/components/ascension-step; engine `archetypeAscension` | none | – |
| 10 | Step DETAIL: name, WHO YOU ARE text, portrait picker, Languages (free picks, bought, write-ins, §48-50), buy Wealth (§51) | detail-step.tsx; sh/state.ts:317 | PARTIAL: tw/builder/ledger/components/detail-step has languages, Wealth, GM rulings. Name and `detail.*` are fields (port/ruleset.ts:461). Portrait absent (see Decision 2) | none beyond Decision 2 | – |
| 11 | Grant choices ("choose N of", wargear, skill, attribute, discipline, power, keyword picks) with path-keyed answers | sh/build.ts:73, 228 | HAS: choice-card, record-list | none | – |
| 12 | GM part: species override, extra keywords, gear add and remove, mods by ruling (§121) | sh/build.ts:182-194; review-step.tsx:243-360 | HAS: tw/builder/ledger/components/gm-rulings/gm-rulings.tsx | none | – |
| 13 | Problems of severity `gm` need a GM tick (`approved` paths); errors block the save | sh/build.ts:189, 239 | HAS (HD #63; the player's `gm` part is the stored one, silently) | none | – |
| 14 | "Effects": what the build gives that the sheet has no field for | sh/build.ts:241 | PARTIAL: the engine returns them; whether any screen draws them was not checked | S | S |
| 15 | XP ledger panel and XP bar, STILL TO DO list | xp-ledger.tsx, xp-bar.tsx | HAS: ledger-panel, xp-bar, step-issues | none | – |
| 16 | Live sheet preview in REVIEW with IN PLAY band | review-step.tsx:91-166 | PARTIAL: ledger-panel only; no sheet preview | S | M |
| 17 | GM overrides of Traits (replace the derived value; blank keeps it) in REVIEW | review-step.tsx:65-70, 272; sh/state.ts:239 | MISSING (port/room.ts:276 "no field"). `mod.*` fields are additive only | B (a GM-set override of a derived value) | M |
| 18 | Save a build: server re-resolves and refuses what the builder refuses (Tier match, ready, homebrew) | api/character/character.actions.ts:325-416 | HAS: build.save (HD #63) | none | – |
| 19 | Player builds are locked once made; only advancement and `advance/` choices change (`creationKey`) | character.actions.ts:344-352; sh/build.ts:2486 | HAS: `creationLocked` (HD #64) | none | – |
| 20 | Device draft in localStorage, newest-wins against the server draft (`builtAt`, `pickDraft`) | builder.tsx:56-60, 330; constants.ts:42-48 | PARTIAL: server drafts only: `draft.save` (ca:131) and `build.save draft:true`. No device draft | S | S |
| 21 | SEND TO GM: the draft waits on the character (`character.draft`), the player's keeps the GM's part | actions.ts:299; character.actions.ts:417 | HAS: `build.save draft:true` (HD #63) | none | – |
| 22 | GM opens a player's draft (OPEN DRAFT, DRAFT chip), ticks, saves | advance-tab.tsx:41; agent-card.tsx:62 | HAS: `gmEntryOf` "review" (T/apps/web/lib/ledger/table.ts) | none | – |
| 23 | SAVE DETAILS ONLY (name, detail, overrides on a made character) | builder.tsx:66, 194-206 | PARTIAL: name via `actor.rename`, detail via `field.set`; overrides missing (row 17) | – | – |
| 24 | Builder reached by a player from the sheet: LEVEL UP / SPEND XP / CHARACTER BUILDER link | xp-box.tsx:11-41; book-sheet.tsx:55 | HAS: tw/builder/ledger/play/xp-box; player-app.tsx:130-143 | none | – |

### B. Library, pregens, by-hand creation, EDIT

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 25 | Character library outside any room (cap 20, autosave to server, done flag, homebrew flag) | sh/library.ts; api/library/library.controller.ts:81-113 | MISSING: no library, no REST route (T docs: workspace ponytail, characters-view.tsx) | B (an owner-scoped character library REST scope: needs a CLAUDE.md principle 6 amendment, see Decision 7) | L |
| 26 | IMPORT FROM LIBRARY into a room's builder (refuses homebrew into an official room) | import-library.tsx:12-48 | MISSING | depends on row 25 | M |
| 27 | Lobby "your characters": new, delete | lobby-view.tsx:48-137 | MISSING | depends on row 25 | M |
| 28 | Pregens: 11 fixture builds (test data only, not a feature); real pregens were hand-made sheets imported with a campaign | S/packages/data/fixtures/pregens; S/docs/data.md:492 | PARTIAL: plan goal is "11 pregens rebuilt" via port tests (T/docs/p3-plan.md:5-7); room import carries sheets (HD #74) | none | – |
| 29 | Create an Agent by hand (ADD AGENT, a name and a blank sheet) | add-agent.tsx:15-48; actions.ts:166 | HAS: `actor.create` (ca:99) | none | – |
| 30 | By-hand sheet fields (species, attributes, skills, armour, bonuses, XP) | seat-tab.tsx:46-55 (LOAD STATS JSON) | PARTIAL: the default 0.1.x ruleset has `creation` steps (port/ruleset.ts:888 region). The ledger ruleset 0.2.x sets `creation: []` (:927), so no by-hand path there | R (keep a by-hand step set beside `build`; the platform refuses both on one actor type, ruleset.ts comment) | M |
| 31 | LOAD STATS (JSON) paste | seat-tab.tsx:44-60 | MISSING | S | S |
| 32 | EDIT over a hand-made sheet: `keepSheet` keeps armour, gear, Wealth, extra weapons | actions.ts:294; character.actions.ts:380-395; sh/build.ts:2362 | MISSING: a field-filled actor with no build is `alreadyBuilt` (HD #63) | B (a build over a field-filled actor, keeping named parts) | M |
| 33 | Rebuild keeps play changes (`keepPlay`: ammo, requisitions, fitted gear, corruption, mutations) | sh/build.ts:2388 | PARTIAL: HD #64 says "replaced whole until keepPlay is ported"; T/apps/api-go/internal/actor/ledger.go mentions keepPlay. Whether it is complete was not checked | – | S |
| 34 | GM-only delete of a character (handout audiences cleaned) | character.actions.ts:774 | HAS: `actor.delete` (ca:134); handout audience cleanup not checked | – | – |

### C. Advancement

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 35 | XP earned, XP spent (`xpSpent`), XP left, Rank (+1 per 40, max 3) | sh/state.ts:353-357; xp-box.tsx | HAS: `xp` field (owner-only, port/ruleset.ts:441-), `rank` derived (owner), ledger `xpSpent` (HD #64); tw/sheet/sheet-view/sheet-view.tsx:211-219 | none | – |
| 36 | Advancement purchases (attributes, skills, talents, powers, packages, languages) priced from creation ratings | sh/build.ts:80 | HAS (ADVANCE step is the customise screen, ledger-builder.tsx:49-57) | none | – |
| 37 | Purchase history stamped with the session number by the server (§69) | character.actions.ts:90-110 | HAS (HD #64 stamping) | none | – |
| 38 | Session end awards XP (8/10/12 chips, custom up to 100) and recap; the GM is told who reached a new Rank and when the group may Ascend | actions.ts:137; api/campaign/campaign.actions.ts:172-205; session-band.tsx:28-160 | PARTIAL: `session.end award` (HD #64), `award { max, suggested }` (port/ruleset.ts:928-). The Rank-reached and "group may Ascend" notices were not found in the target | S (notices) | S |
| 39 | Session end deletes the rolled Objective, whispers, spend requests, test call | campaign.actions.ts:180-188 | PARTIAL: only what the target resets (`resetOn`). No objective roll exists | – | – |
| 40 | Group Ascension: experience (every living Agent 100 XP in the Tier) or milestone (grants 100 XP), waive package, two-tap confirm, living-group rule (§66) | actions.ts:160; campaign.actions.ts:267-297; ascend-panel.tsx:21-129 | HAS: `build.ascend` (ca:113), `ascension`, `gone` (port/ruleset.ts:928-), tw/builder/ledger/play/ascension-panel | none | – |
| 41 | `xpAtAscension` and `ascensionPackageWaived` per character | sh/state.ts:357-358 | HAS (HD #64) | none | – |

### D. The sheet, box by box (phone DOSSIER, GM SHEET dialog, printed PDF)

The source draws the whole sheet from one component (wc/ui/book-sheet/book-sheet.tsx:33) on the player's phone, in GM PARTY (wc/ui/sheet-dialog/sheet-dialog.tsx:18) and on the JOIN page. Target: tw/sheet/sheet-view/sheet-view.tsx:51-254 draws layout sections of field, derived and resource rows, then LedgerLines, XpBox and the conditions list.

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 42 | Personal details strip: name bar, Tier, Species, XP, Rank, Archetype, Keywords | sheet-head.tsx:11-62 | PARTIAL: name is the page title; species, archetype and keywords exist as fields (port/ruleset.ts:441-) but the layout lists none; Tier is a campaign field. Keyword text tap is book text (Decision 1) | R (add them to a layout section) | S |
| 43 | ATTRIBUTES grid: RATING, BONUS, TOTAL for 7 attributes | attributes-box.tsx:13-66 | PARTIAL: `attr.*` fields and `strengthTotal` derived exist; only S has a total | R (derived `total` per attribute) plus B (a grid widget, ADR 0010 #3, not built) | M |
| 44 | SKILLS: 2 columns of 9, Skill, Attribute, Rating, TOTAL badge, hollow when untrained | skills-box.tsx:13-60 | PARTIAL: 18 derived totals (port/ruleset.ts:521-) and `skill.*` ratings exist; layout shows the derived list | B (the same grid widget) | M |
| 45 | WRATH: points, uses text (own words), SPEND WRATH, Restore Shock amount (Rank+Tier) | wrath-box.tsx:14-38 | PARTIAL: `wrath` resource, party-visible, resets to 2 (port/ruleset.ts:652); SpendAsk (tw/sheet/components/spend-ask). The uses text is own words, and the app already holds own-words text in S/apps/web/lib/sheet-terms | R (`decisions[]` or World `terms`, unread today) | S |
| 46 | OBJECTIVE box: roll d6 (I ROLLED 1-6), server writes that row, shows struck when done | objective-box.tsx:14-53; character.actions.ts:742-762 | MISSING | B (a table-roll to private-quest action) plus Decision 4 | M |
| 47 | CONVICTION, RESOLVE, SPEED with formula captions and "(base), +n" notes | traits-box.tsx:20-92 | HAS: derived rows (TRAITS, port/ruleset.ts:75-) with Breakdown on tap (sheet-view.tsx:136-180) | none | – |
| 48 | SURVIVAL: Defence; Resilience as Base + Armour = Total; Max Wounds, Max Shock, Determination | traits-box.tsx:48-92 | PARTIAL: the derived totals exist; there is no "base" and "armour" split. `armour.ar` is a field | R (derived `resilienceBase`) | S |
| 49 | Wounds and Shock counters | vitals-strip.tsx:26-131 | HAS: resources, `capped:false`, start min (port/ruleset.ts:625-651); ResourceRow | none | – |
| 50 | WARGEAR weapons datacard: icon, name, range/salvo/traits, dice pool badge (WS or BS), damage (S+X for melee), ED, AP | wargear.tsx:24-193 | PARTIAL: LedgerLines weapons: name, count, damage, ED, AP, range, salvo, traits (tw/sheet/components/ledger-lines/ledger-lines.tsx:46-65). No pool, no melee flag, no S+X (the `Weapon` reader in T/apps/web/lib/ledger/table.ts drops them) | R plus S (read `melee` and `addStrength`; per-weapon pool = a derived over a skill) | M |
| 51 | Weapon line shows fitted upgrades, talents worked in (§68), notes | wargear.tsx:96-108 | MISSING: ledger lines carry none | B (item instances with fitted upgrades) | L |
| 52 | Armour line: name, AR, `*` invulnerable, Powered (X), traits, upgrade notes | wargear.tsx:117-136 | PARTIAL: armour name, AR, traits only; `armour.ar` and `armour.powered` are fields | S | S |
| 53 | Gear lines (CARRIED) | wargear.tsx:151-156 | PARTIAL: ledger gear strings, read-only | none (see Decision 9) | – |
| 54 | SUPPLY: ammo per type with minus, Wealth with minus; players spend only | wargear.tsx:158-190; character.actions.ts:457 | PARTIAL: 7 `ammo*` resources, owner-visible, `ownerSpendOnly` (port/ruleset.ts:703-). `wealth` has no `editableBy` (port/ruleset.ts:694), so GM-only. Write-in ammo types (Kraken Bolt) have no resource (port/room.ts:322) | R (`wealth` ownerSpendOnly); B for free-form ammo types (list resource) | M |
| 55 | INFLUENCE value in the foot | wargear.tsx:177 | HAS: derived `influence` (port/ruleset.ts TRAITS), not in layout | R | S |
| 56 | TALENTS & ABILITIES folded rows: name, page, text, TALENT stamp | talents-box.tsx:13-44 | PARTIAL: names, cites and an empty `summary` (ledger-lines.tsx:30-35). Text is deliberately absent (Decision 1) | none | – |
| 57 | INJURIES: Traumatic count / max (Tier+1) | injuries-box.tsx:19-40 | PARTIAL: `traumatic` field and `maxTraumatic` derived exist. `traumatic` is in no layout section (layout, port/ruleset.ts:888-905) | R | S |
| 58 | MUTATIONS list with effect text and weapons | injuries-box.tsx:42-60; sh/state.ts:158 | MISSING (T/docs/p3-plan.md item 16; port/room.ts:280 "no field") | B (a held-record list with mods that feed derived values) | L |
| 59 | CORRUPTION points with level name, DN modifier, rows of pips, Chaos Spawn | injuries-box.tsx:61-80 | PARTIAL: `corruption` resource (owner), `corruptionMod` derived (owner), `lost` health state (port/ruleset.ts:926-). No pips or level name | B (a pip-row widget) | M |
| 60 | NOTES: WHO YOU ARE with EDIT and SAVE, (?) help | notes-box.tsx:15-56; character-detail.tsx | HAS: `detail.*` text fields, `editableBy owner`, section "who" (port/ruleset.ts:461, 903). No (?) help | – | – |
| 61 | Foot: Passive Awareness, XP EARNED, CURRENT XP, and the way to spend | xp-box.tsx:11-41 | HAS: derived `passiveAwareness`; XpBox | none | – |
| 62 | HOW TO READ THIS SHEET guide, tap-for-meaning on 63 terms (own words, page cite), FULL RULE | sheet-guide.tsx; term.tsx; S/apps/web/lib/sheet-terms | MISSING: `terms` is declared in the manifest and read by nothing (plan item 15, issue #159) | B (a World or ruleset `terms` reader plus tap popover) | M |
| 63 | Sheet jump strip and AT A GLANCE (traits row, weapons with pools, top 5 skills) | player-sheet.tsx:18-46; glance.tsx:17-88 | MISSING | B (phone-turn layout target, ADR 0010 #3) | M |
| 64 | GM's SHEET dialog, same sheet with working buttons | sheet-dialog.tsx:18 | HAS: SheetView with `gm` (sheet-view.tsx:51) | none | – |
| 65 | Printed sheet PDF: official art, print or full-art, A4 or Letter, built in the browser | sheet-export.tsx:28; print/character-sheet/**; sheet-input.ts | MISSING (no print code, T) | B (a print target) plus Decision 2 | L |
| 66 | Printed boxes outside the phone sheet: Faith, Memorable Injuries, Stealth, Size left blank for pencil | page-two.tsx:34-56, 106 | MISSING | with row 65 | – |

### E. Editing values in play (who may change what)

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 67 | Player sends only: update (name, detail), build, draft, supply (spend only), fitUpgrade/removeUpgrade, seat.leave, spend.request/cancel, test.report, whisper.reply, rollObjective | sh/actions.ts:462-481; table.dispatch.ts:68-98 | HAS by another route: `field.set` (the field's `editableBy`), resource steps by `editableBy`, `build.save`, `request.send`, `test.report`, `seat.leave` (SEAT_GRANTS and OWN_GRANTS, T/packages/core-schema/src/permissions.ts:74-82) | R (declare `editableBy`) | – |
| 68 | GM-only: Wounds, Shock, Wrath, Traumatic, Corruption, Wealth and Ammo awards, Conditions, annihilated, overrides | character.actions.ts:425-456; table.dispatch.ts:83-97 | HAS (resources, `condition.add/remove`) | none | – |
| 69 | Damage through the harm rules (Exhausted shock to wounds, Dying, Annihilation) | sh/state.ts:654-676 | HAS: `health.harm` (HD #66, port/ruleset.ts:230-260) | none | – |
| 70 | Conditions on a character, in or out of a fight, chip picker | status-tab.tsx:21-104 | HAS: `condition.add/remove` (ca:147-153) | none | – |
| 71 | Sustained powers as `Sustaining: <power>` conditions (+2 DN per, §180) | sh/psychic.ts:1-66; vitals-strip.tsx:117 | MISSING (conditions are a fixed list; plan item 15) | B (a free-text condition, or a counter condition) | M |
| 72 | RESPITE: one character or a ticked party; Wounds 0, Shock 0, Wrath 2; refused while Dying or Dead | character.actions.ts:763-773; respite-sheet.tsx:21-66 | PARTIAL: `actor.rest` with `resetOn longRest` (port/ruleset.ts:625-; ca:156). The Dying refusal was not checked | – | S |
| 73 | Tap-value pad: tap a value, then -1, +1 or a typed signed number | tap-value.tsx:21-90 | HAS: ResourceRow steps and the harm pad (tw/gm/track) | none | – |
| 74 | Corruption Test applied by the GM: DN from points, gain = DN minus Icons (double on a Complication), +1 Ruin, notices (Mutation Test DN, Chaos Spawn) | character.actions.ts:477-508; corruption-test.tsx:27-122 | MISSING as a rule (the test exists, the consequence does not: plan item 11) | B (a failed-test consequence block) | M |
| 75 | Mutation roll: severity d6, d66 with +10 per held, forward rows, sub-table, CUT OFF | mutation-roll.tsx:27-135; character.actions.ts:509-538 | MISSING (plan items 14, 16) | B (table lookup that applies a record to an actor) | L |

### F. Wargear in play

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 76 | REQUISITION Influence Test (Keyword overlap, Rarity DN, one per kind per session, Wealth tops up a failed roll, loaded ammo, fit on success) | requisition-form.tsx:42-305; character.actions.ts:539-592 | MISSING | B (item-instance list plus a requisition primitive) | L |
| 77 | GIVE a codex item to an Agent with no Test; weapon joins, upgrade fits, else a gear line; refuses duplicates, ammo, full list | item-give.tsx:26-73; character.actions.ts:593-620 | MISSING (`item` is a codex field pair `location` and `holder`, port/ruleset.ts:324-, but no give action) | B (give and take an entry to an actor) | L |
| 78 | TAKE BACK undoes a GIVE (fitted upgrades return to gear) | character.actions.ts:621-661 | MISSING | with row 77 | M |
| 79 | Fit and remove an upgrade on a weapon or the suit (instant, max 3, one per slot, GM-only Matched Pair) | upgrade-row.tsx:23-102; character.actions.ts:662-709 | MISSING | B (item instances) | L |
| 80 | EDIT CARRIED: GM rewrites or removes a gear line (stale-line guard) | gear-tab.tsx:21-139; character.actions.ts:467 | MISSING | B (list field a GM edits) | M |
| 81 | Gear gained by requisition appears on the phone's INVENTORY (given items live under MISSION, §166) | mission.tsx:35-60; sh/codex.ts:386-390 | PARTIAL: a given item could be a codex entry with a listed audience; no give action | – | – |
| 82 | Ammo: `adjustAmmo` (a type at 0 disappears), 1 per Reload shown | sh/state.ts:243 | PARTIAL: 7 fixed resources | see row 54 | – |

### G. Objectives

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 83 | GM writes private objectives per Agent, ticks done, links to an adventure or scene (§163); only that player sees them | objectives-editor.tsx:15-99; character.actions.ts:710-741; sh/state.ts:726-731 | PARTIAL: objectives become `quest` codex entries with a listed audience (port/room.ts:332-355), status open or done (`codex.save`, `codex.reveal`) | M (ok today; the link is a codex link) | – |
| 84 | Player reads YOUR ORDERS folded, shown DONE or SECRET so a glance doesn't leak | mission.tsx:22-34 | PARTIAL: tw/player/notebook/notebook.tsx:31-129 lists open quests first, not folded | S | S |
| 85 | Per-session rolled Objective from the Faction table, cleared at END SESSION | character.actions.ts:742-762 | MISSING | see row 46 | – |
| 86 | Objective reward (GM awards a Wrath point; printed on the box) | objective-box.tsx:50 | MISSING (text note only in the source; the Wrath award is the GM's resource step) | none | – |
| 87 | Agent card shows objective count line | agent-card.tsx:65 | not checked | S | S |

### H. The phone: shell and tabs

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 88 | Tabs SHEET, FIGHT, INTEL, RULES with the tab in `?tab=`; NEW count badge on INTEL; live dot on FIGHT | player-app.tsx:51-54, 223-247; constants.ts | DONE (#215 part A, house decision #112) | S | M |
| 89 | Header: campaign name, status line (NO COMBAT / YOUR TURN / ROUND n), offline badge, lobby link, account, menu (theme, sound, LEAVE) | player-app.tsx:109-170 | DONE (#215 part A, house decision #112) | none | – |
| 90 | Vitals strip on every tab: Wounds and Shock bars, Wrath, party Glory/max, Conditions and status chips, sustain line; folds to one line on scroll | vitals-strip.tsx:26-131 | PARTIAL: PoolsView (shared pools) and SheetView on the sheet tab only; no strip | B (phone strip widget, ADR 0010 #3) | M |
| 91 | Multi-character strip | n/a (source: one Agent per seat) | HAS (extra): player-app.tsx:109-123 | – | – |
| 92 | Archived banner (read-only game) | player-app.tsx:182 | DONE (#215 part A, house decision #112) | S | S |
| 93 | FIGHT: now-acting plate, side up next, agents and threats rows with turn words (OUT, ACTING, AMBUSHED, HELD, DONE, READY), YOU mark, threat stat block by visibility, "no information" line | fight.tsx:57-252 | PARTIAL: OrderView above every tab (tw/ui/order-view); stat-block visibility (HD #75) exists; the FIGHT tab itself is a stub | S | M |
| 94 | Your turn: THIS TURN options list (combat actions), 1 STRIKE weapon or power pick, 2 PICK A TARGET, 3 dice steps | fight.tsx:252-394; strike-steps.tsx:23-112; power-steps.tsx:32-109 | MISSING (plan item 15; no phone-turn target) | B (phone-turn widgets: pool and DN steps, target pick) | L |
| 95 | Damage total typed, shows resulting Wounds or Shock against a shown target | strike-steps.tsx:44-60 | MISSING | B | M |
| 96 | Power level pick (Bound, Unbound, Transcendent: Wrath dice, Shock), Psychic Mastery pool, one power per Round (`combatant.manifest`) | power-steps.tsx; actions.ts:391 | MISSING | B | M |
| 97 | INCOMING panel on every Threat turn: Defence, Resilience, Determination dice, no-crit note, held action | incoming.tsx:15-74 | MISSING | B (phone-turn widget) | M |
| 98 | YOU'RE HIT sheet when your Wounds rise in a fight: Determination dice, I ROLLED n Icons sends `spend.request determination` | hit-sheet.tsx:21-110 | MISSING | B (a reaction sheet) plus request kind (row 115) | M |
| 99 | AMBUSHED panel: ask the GM for AWARE (1 Glory) | ambushed.tsx:14-55 | MISSING | request kind bound to a rule op (row 115) | S |
| 100 | DYING panel (crawl, Traumatic count against max) | dying.tsx:7-42 | MISSING | S | S |
| 101 | SPEND WRATH OR GLORY dialog (reroll, restore shock, glory dice and damage, seize) | spend-sheet.tsx; request-spend.tsx:31-124 | PARTIAL: SpendAsk per resource (spend-ask.tsx:21-115) | see row 115 | – |
| 102 | INTEL INBOX: new handouts, persons, places, given items as transmissions, MARK ALL READ, NEW marks kept in localStorage | intel.tsx:30-108; inbox.tsx:24-60; S/apps/web/lib/seen | MISSING (Notebook is a flat revealed list, notebook.tsx:31-129) | S | M |
| 103 | INTEL ARCHIVE by kind with counts, nested places, codex search | archive.tsx:17-78 | PARTIAL: Notebook groups by kind with a tree (`treeRows`); no counts, no search | S | S |
| 104 | Entry sheet over INTEL: handout doc, NPC role, Attitude chip, place parent, picture, mentions | entry-sheet.tsx:24-101 | HAS: details cards with EntryFields, EntryPicture, HandoutDoc, MentionText (notebook.tsx), HD #70-72 | none | – |
| 105 | SHOW THE TABLE: handout or picture fullscreen, screen stays awake | show-table.tsx:17-58 | MISSING | S | S |
| 106 | MISSION view: framework, bonus, patron, KIND OF GAME and LEAVE OUT, adventures ACTIVE, OFFERED, DONE, FAILED, NEXT SESSION with .ics | mission.tsx:61-159 | PARTIAL: safety lines and veils (SafetySection) and quest status; no framework text (the Tier is the only campaign value shown), no .ics link found | R (framework as a quest or entry body) | S |
| 107 | Recaps: all, newest first, latest open | mission.tsx:134-159 | HAS: notebook recaps; RecapCard "last time" | none | – |
| 108 | RULES tab: searchable reference, filters COND, WEAPON, ARMOUR, ACTIONS, STATS, TESTS | rules-ref.tsx:17-55 | PARTIAL: RulesReader (tw/rules/rules-reader): conditions, decisions, pack entries, search and type filter. No rule text exists to read | see Decision 1 | – |
| 109 | Tap a Condition, weapon trait or term to read its rule (RuleLink, 63 terms) | rule-link; term.tsx | PARTIAL: Cite opens the GM tablet's book page over `book:request` (tw/ui/cite/cite.tsx:20-59), but no GM UI calls `serveBooks` (T/apps/web/hooks/use-table/use-table.ts:228) | S (GM render side) | M |
| 110 | Book page cites open the page while the GM serves that book | page-cite.tsx:11-27 | PARTIAL: same as row 109 | S | M |
| 111 | MAP tab | none in the source (printed maps are physical, S/CLAUDE.md) | stub (`tabPending`); no code | none | – |
| 112 | Notebook the player writes in | none in the source (only WHO YOU ARE) | the target notebook is read-only (notebook.tsx) | none | – |

### I. Messages, requests, called Tests

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 113 | GM whispers to chosen Agents; pops over any tab with buzz; one-line reply (200 chars), replace on resend; GM may delete; cleared at session start and end | actions.ts:122-132; whisper-sheet.tsx:16-54; whisper-reply.tsx:11-48 | MISSING (no action; principle 8 says no chat; Decision 6) | B (private note and one reply) | M |
| 114 | Whispers re-readable in INBOX | inbox.tsx:60 | MISSING | with row 113 | – |
| 115 | Spend request kinds: reroll, restoreShock (Shock down by Rank+Tier, conscious only), gloryDice, gloryDamage, seize, determination (free, Wounds to Shock), aware | sh/spend.ts:13-74; api/spend/spend.actions.ts:90-190 | PARTIAL: `request.send resourceId amount` approves as a resource delta (ca:255; HD #43). No kinds with effects | B (a request that names a rule op to run on approve) | M |
| 116 | Limits: one pending per kind, 3 at once, pool must cover now and at ACCEPT, GM ACCEPT is the spend and rolls back whole on refusal | spend.actions.ts:63-76, 98 | PARTIAL: approve spends through the clamped delta path (HD #43) | – | – |
| 117 | Everyone sees pending requests (Glory is the party's), only the asker cancels | request-spend.tsx:124-160; §123 | PARTIAL: RequestNotices shows answers (8 s toasts); pending visibility to others not checked | S | S |
| 118 | GM answers: SPEND ASKED badge, ACCEPT or DENY | gm/header/spend-badge | HAS: request-bar (tw/gm/request-bar/request-bar.tsx:19-96, deny with reason) | none | – |
| 119 | Called Test prompt over every tab: your pool, PASSED or FAILED, second tap changes it, HIDE bar, hidden DN, Fear, Corruption roll form (Icons, Complication, Wrath Critical, spent Wrath) | test-prompt.tsx:27-135; actions.ts:95-118 | PARTIAL: TestPrompt with Roll, PoolPad, OutcomePad (tw/player/test-prompt/test-prompt.tsx:21-151); pool counted by the engine. The Corruption consequence is missing (row 74) | – | S |

### J. What a player sees of others

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 120 | Other Agents: harm numbers, conditions and status in FIGHT; their full sheet data is sent but not drawn; objectives blank, Corruption shown only as Lost, mutations shown as Unseen | sh/state.ts:713-758 | HAS by visibility: T/packages/rules-engine/src/view.ts:32-111, Go T/apps/api-go/internal/view/seat.go:140-218; `corruption` is owner-only and `lost` is a health state | R (choose visibilities, Decision 3) | – |
| 121 | Party Glory visible, Ruin hidden (§58) | state.ts:715 | HAS: ruleset `ruin` is GM-scope; decision `ruinHidden` | none | – |
| 122 | NPCs: revealed only, with Attitude, role, description, picture; no secrets, notes or faction | sh/codex.ts:371-377 | HAS: codex NPC fields (`attitude` party, `faction` gm, port/ruleset.ts:324-) | none | – |
| 123 | Threat visibility hidden, bars, stats; hidden turn is "unseen" | sh/state.ts:742-757; §56 | HAS: HD #68, #75 | none | – |
| 124 | Handouts: styles, per-Agent audience ("FOR YOUR EYES ONLY"), a deleted Agent's audience cleaned | sh/codex.ts:386-389 | HAS: listed audience, five layouts (HD #72) | none | – |

### K. Joining

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 125 | Room QR (168 h), per-character single-use invite, guests allowed or accounts only | api/auth/access.actions.ts:34-57; room-invite.tsx:15-49 | HAS: `invite.create` (ca:168), tw/invite/invite-accept/invite-accept.tsx:18-126 | none | – |
| 126 | Claim an open Agent, or start a new one by name (room invites) | api/auth/invite.service.ts:104-146 | HAS: invite-accept | none | – |
| 127 | Guest QR per character (no account; httpOnly cookie), REVOKE GUEST QR | seat-tab.tsx:16-112; S/apps/web/app/join/[token]/route.ts | HAS: `token.issue/revoke` (ca:187), T/apps/web/app/join/[token]/route.ts | none | – |
| 128 | Seated player reopens an expired link into OPEN TABLE | invite.service.ts:80 | not checked | – | – |
| 129 | Invite preview "READ" of a character's sheet before claiming (a guest gets names only) | invite.service.ts:59-72; wc/invite/invite-accept/components/agent-card | MISSING (Decision 10) | – | – |
| 130 | Leave a seat (Agent returns to reserve; guest tokens revoked) and return (cookie or membership) | access.actions.ts:96-115; player-app.tsx:61-69 | HAS: `seat.leave` (ca:186), T/apps/web/app/leave/route.ts | none | – |
| 131 | Table TV screen token | more-panel.tsx:24-80 | HAS: `screen.issue/revoke`, tw/screen | none | – |
| 132 | GM sees seat state (ACTIVE / IN RESERVE, member name), TABLE ACCESS list, REMOVE | party.tsx:44-160; table-access.tsx | HAS: Party (tw/gm/party/party.tsx), `member.remove` | none | – |
| 133 | Guests and members see only the table's seat view | api/table/table.state.ts; sh/state.ts:713 | HAS (seat view) | – | – |

### L. Alerts, safety, printing, locales, help

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 134 | Turn alert: crimson header, YOUR TURN flash (1.2 s), buzz, optional tone (per-device opt-in) | use-turn-alert.ts:11-58; turn-tone.ts | PARTIAL: TurnBanner with vibrate (tw/player/turn-banner/turn-banner.tsx:31), alerts switch (localStorage). No flash or tone found | S | S |
| 135 | Screen wake lock | S/apps/web/hooks/use-table/use-table.ts | HAS: T/apps/web/hooks/use-table/use-table.ts:145-163 | none | – |
| 136 | Tap feedback on sent actions (pulse, ring) | use-table.ts `send` | not checked | S | S |
| 137 | X-card and safety tools | the source has no X-card; only KIND OF GAME and LEAVE OUT lines (§79) | HAS and beyond: `safety.xcard`, `safety.suggest`, `campaign.setSafety` (ca:265-267) | none | – |
| 138 | Print: GM tents (fold-over name cards per Agent), threat cards, item cards, handouts | more-panel.tsx:50-70; wc/print/card-sheet/** | MISSING (no print code) | B (print target) | L |
| 139 | Locales | English only (`lang="en"`, Intl dates) | HAS and beyond: en and vi (T/apps/web/i18n/request.ts, messages) | none | – |
| 140 | Help text: SheetGuide, Term popovers, Help (?) in setup, DetailHelp | sheet-guide.tsx; term.tsx:62-74 | MISSING (plan item 16 help text) | see row 62 | – |
| 141 | Theme toggle per device | theme-toggle | HAS: scheme-switch, theme-switch | none | – |

### M. Additions from the builder survey

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 142 | (A1) The builder's tabs depend on role and state: a player on a made character sees only ASCENSION (when relevant), ADVANCE and REVIEW; ASCENSION shows only for Advanced builds, an archetype below the campaign Tier, or after the group Ascended; ADVANCE only once made; each tab carries "· n LEFT" | wc/builder/builder.tsx:357-363; wc/builder/utils.ts:23-42; step-nav.tsx:15-21 | PARTIAL: the step set exists (T/apps/web/lib/ledger/ledger.ts:34-41); the per-role gating and the "n LEFT" badges were not checked | S | S |
| 143 | (A6) Each choice list has a RULES toggle, a search box when there are more than 8 items, "blocked" greying with its reason, and a 40-row cap | wc/ui/record-list/record-list.tsx:12-80; wc/builder/utils.ts:147-162 | PARTIAL: record-list exists (tw/builder/ledger/components/record-list); whether it has the RULES toggle was not checked (the rules text is book text, Decision 1) | S | S |
| 144 | (A8) `session.start` tells the GM "Unspent XP: A 12, B 8 ... ADVANCE spends it" (first 3 names, then "n more"; only built characters with XP left) | api/campaign/campaign.actions.ts:164-168 | MISSING: nothing like it found | S (notice) | S |
| 145 | (A10) Raising the Tier by hand through `campaign.update` is read as an Ascension (resets `xpAtAscension`, clears the waive flag; a rise of more than one counts once per Tier) | api/campaign/campaign.actions.ts:~122-133; §55 | MISSING: the Tier is a campaign field set by `campaign.setField` (HD #58); nothing treats a hand raise as an Ascension. A choice for the product owner: Ascension only through `build.ascend`, or also on a Tier edit | M (decision, then a hook on `campaign.setField`) | S |
| 146 | (A11) `keepSheet` has no web control; only the seed script and the smoke tests send it. A player's own first build of a hand-made sheet therefore drops its printed armour and gear lines, because only the GM may send `keepSheet` | S/apps/api/scripts/seed.ts:105; S/apps/api/test/smoke.test.ts:2228-2242; api/character/character.actions.ts:355-358; api/table/table.dispatch.ts:92 | MISSING (as row 32) | see row 32 | M |
| 147 | (A12) No JSON export of a library character exists in the source, only the PDF sheet from the builder's REVIEW. A campaign export carries stats, build, builtAt, xp, detail and objectives, but not xpSpent, xpAtAscension, ascensionPackageWaived or the draft | sh/export.ts:34-52; review-step.tsx:185-196 | MISSING: no library, no character export (rows 25-27); room export is not built (ADR 0012) | B (with row 25) | M |
| 148 | (A14) Catalogue sizes: keywords 115; factions 27; sub-factions 136; species 22; backgrounds 31; option-groups 5; archetypes 213; talents 414; packages 37; disciplines 41; powers 291; patrons 16; frameworks 27; languages 5; flavour 27 | S/packages/data/creation/*; api/character/creation.service.ts:23 | PARTIAL: the creation pack carries about 1,400 entries and the wargear pack 1,271 (T/docs/p3-plan.md:176); patrons, frameworks and flavour tables are not carried (port/creation-packs.ts header) | none (a ruleset choice if wanted) | – |

## 1. The sheet, box by box

Data the source's box reads, and whether the generated ruleset (`port/ruleset.ts`) already holds it so a layout widget could draw it.

| Box | Data read | In generated ruleset or pack? |
|---|---|---|
| Personal details | name, Tier, species, XP, rank, archetype, keywords | Fields `name`, `species`, `archetype`, `keywords`, `xp` (owner), derived `rank` (owner), campaign field `tier`: held (port/ruleset.ts:441-, :75-). Faction and Background strings are not on the source's phone sheet either |
| Attributes | rating, bonus, total | Ratings held (`attr.*`). Only `strengthTotal` is derived. Bonus from mutations missing (no mutation data); Powered is in `armour.powered` |
| Skills | rating, attribute link, total, trained flag | Held: `skill.*` and 18 derived totals (links in the expressions) |
| Wrath | wrath, Rank+Tier (restore shock) | `wrath` held. Restore amount not held (no request kind with an effect) |
| Objective | rolled objective text and done flag | Not held (the Faction table's text is `objectives`, dropped from the pack, TEXT_KEYS) |
| Conviction, Resolve, Speed, Survival | 11 Traits, base against bonus | Held as derived (TRAITS). Base against bonus: Breakdown shows it. The Resilience base and armour split is missing |
| Wargear: weapons | name, pool skill, damage, addStrength, ED, AP, range, salvo, traits, fitted, effects, notes | Weapon numbers live only in the saved ledger sheet document (read by `sheetLinesOf`), without `melee`, `addStrength`, fitted or effects. A `weapon` entity (item base) exists for threats |
| Wargear: armour | name, AR, invulnerable, powered, traits | `armour.ar`, `armour.powered` held; name, invulnerable, traits only in the ledger sheet |
| Wargear: gear, supply | gear strings, ammo by type, Wealth, Influence | gear in the ledger sheet (strings); 7 `ammo*` resources, `wealth`, derived `influence` held |
| Talents and abilities | name, page, text | names and cites in the ledger sheet; text absent by design |
| Injuries and Corruption | traumatic, max, mutations, corruption points and level | `traumatic`, `maxTraumatic`, `corruption`, `corruptionMod`, `lost` held; mutations absent |
| Psychic powers (printed page only) | name, page, DN, activation, duration, range | in the ledger sheet (`powers`); potency text absent |
| Notes (WHO YOU ARE) | appearance, past, personality | held, `editableBy owner` |
| Foot | passive awareness, XP earned, XP left | held |
| Portrait (GM cards, tents, tracker) | `detail.portrait` slug of a bundled image | not held (port/room.ts:276) |

The existing layout (port/ruleset.ts:888-905) lists only attributes, traits, pools (wounds, shock, wrath, wealth, corruption), skills and who. Species, archetype, keywords, `traumatic` and `influence` are held but not laid out. Widgets are not built (ADR 0010 #3).

## 2. Decisions the product owner must make

1. **Printed text on the sheet and phone (principle 2; T/docs/p3-plan.md "Đã chốt" 3 and 7).** The source shows printed text in these places:
   - Talent and Ability text (sh/state.ts:111, 214-215; talents-box.tsx:13-44).
   - Mutation effect (sh/state.ts:161; injuries-box.tsx).
   - Power Potency (sh/state.ts:141; power-steps.tsx).
   - Weapon and armour trait rules, Condition rules, the RULES tab, combat OPTIONS, stat-block terms (rule-link, rules-ref, fight.tsx:278).
   - The Brutal ED table, read out of rule text (strike-steps.tsx:36-41).
   - Faction Keyword text (keyword-pop.tsx; the source's own exception, S/CLAUDE.md).
   - The rolled Objective row (character.actions.ts:742) and Background objectives.
   - Fight stat-block abilities.

   The target's packs carry names, cites and structure only, plus an optional importer `summary` left empty. Book pages are meant to come through the book relay, but no GM UI calls `serveBooks`. Options: wire the GM render side and rely on cites; fill `summary` by hand; drop the box. Also decide whether the Keyword exception carries over.
2. **Official sheet art and portraits (principle 2, "ships no game content").** The source's PDF uses a publisher's sheet art in S/apps/web/public/sheet (S/CLAUDE.md records the user's confirmation). Portraits are miniature photos bundled in the web app (S/apps/web/lib/portraits/portraits.ts, a `ponytail` note). Target options: a print layout without art; a user-imported private asset; user-uploaded actor pictures (ADR 0012 defers actor pictures).
3. **How much of an Agent others see.** The source sends every other Agent's full sheet to every phone (sh/state.ts:713-758: only objectives, Corruption and mutation names are cut) and draws bars. The target cuts by declared `visibility`, fail-closed, so the ruleset must choose per field (today wealth party, ammo owner, xp owner). The source also sends a character's `build` and `draft` to every seat with no per-seat cut that I found (api/table/table.state.ts:102,188); the target holds `ledger` back from non-holders (HD #63), so it is stricter.
4. **The session Objective (§161, principle 5).** The player rolls physically and taps the row; the row's text is Faction-table book text, which the pack cannot hold. Choose: the GM or player types the objective; the book relay shows the row; or leave the feature out.
5. **Wounded +1 DN and §57 who edits Wealth and Ammo.** Already settled in the plan and ruleset, but `wealth` still lacks `editableBy ownerSpendOnly`: a declaration to make, not a choice.
6. **Whispers (§164 against principle 8 "no chat").** The source's whisper is a GM note plus one 200-character reply, a table aid with no book rule. The target has none. Decide whether a one-way private note with a single reply is "chat".
7. **Character library and export (principle 6).** The source's library (20 per user, REST, outside any room) is not among the target's listed owner-scoped writes. Decide to add it as a new scope, or to rely on room import and export only (room export is not built either, ADR 0012).
8. **Homebrew gate.** The source gates Apocrypha and Necrontyr per campaign (`campaign.homebrew`). The target's server allows every source (HD #63). Choose a pack-based gate (attach or detach) or accept no gate.
9. **Gear and inventory (§63-65, §112-118, §166).** Requisition, GIVE and TAKE BACK, fitting upgrades, EDIT CARRIED, weapon effects on the line and INVENTORY all need items held by an actor. The target has only a read-only gear document (HD #64 says the sheet is replaced whole on each save). Choose: a new actor-held item list (a new core noun; `item` is only an entity base today) or keep gear read-only and the GM edits by hand.
10. **Invite preview of a character (principle 4, "content reaches seats only").** The source shows Agent cards and a READ sheet to anyone with a link (Talent text for signed-in visitors only; api/auth/invite.service.ts:59-72). The target should show names only, or nothing.
11. **GM overrides of derived Traits.** The source lets the GM replace a Trait (sh/state.ts:239); the target has additive `mod.*` only. A new general block (a derived override) or accept additive only.
12. **Ascension on a hand-edited Tier (row 145).** Ascension only through `build.ascend`, or also when the Tier is edited by hand as the source does.

## 3. Out-of-domain actions (sh/actions.ts)

- campaign.update: campaign name, Tier, setup text, next session (the homebrew part is counted in row 3, the Tier-raise part in row 145)
- pool.adjust: Glory and Ruin by hand (GM)
- test.call and test.close: the GM calls and closes a Test (test.report is in domain)
- session.start, session.abandon, session.delete, session.edit: session lifecycle and journal (session.end counted in row 38; the session.start notice in row 144)
- campaign.archive, campaign.unarchive, campaign.delete: room lifecycle
- screen.issue and screen.revoke: the TV seat (counted in row 131)
- member.seat: admin seats a GM
- threat.save, threat.delete: custom stat blocks
- encounter.start, .end, .begin, .newRound, .ambush: fight lifecycle
- turn.start, .seize, .end, .hold, .interrupt, .mark, .back: turns
- combatant.addThreat, .addCharacter, .update, .adjust, .aware, .remove, .manifest: tracker rows (aware and manifest are reached from the phone only through rows 96 and 99)
- codex.save (all kinds), codex.delete, beat.reorder, codex.addPlaces, codex.addHulk, codex.addLoot, codex.addRelic, beat.startEncounter, beat.begin: GM prep and codex (the player's reading of them is rows 102-107, 124)

## Source defects not to port

- **(A4)** Picking an archetype resets the whole builder draft but keeps `gm` and `languages`, so stale language picks can survive an archetype change (wc/builder/components/archetype-step/archetype-step.tsx:28-33).
- **(A5)** The library builder's "NEW CHARACTER" link points to /library/new, and no such route exists in the source (only `[characterId]/page.tsx`), so it lands on CHARACTER NOT FOUND (wc/builder/components/import-library/import-library.tsx:81).
- **(A15)** The source sends a character's `build`, `draft` and the build's `gm` part to every seat with no per-seat cut that I found (api/table/table.state.ts:102,188). Do not port it; the target's `ledger` is already held back from non-holders (HD #63). Keep it in mind when choosing visibilities (Decision 3).

## 4. Not checked

- Per-control reading of most builder components, the `effects` list drawing, and the SHOW and TURN BACK paths.
- Details of the source's Intel NEW-mark store (`S/apps/web/lib/seen`), the GM party session-history, and the lobby beyond the library lines.
- Target: whether the `.ics` calendar link, pending-spend visibility to others, the archived banner, the Dying refusal on `actor.rest`, the per-role builder tab gating, a record-list RULES toggle and the Rank and Ascend notices exist; the Go engine and view code beyond what the survey read; HD rows #43 and #49 only as referenced.
- Record counts of the generated packs (taken from `T/docs/p3-plan.md`, not counted).
- Target tabs "fight" and "map" are stubs; target web components outside player-app, sheet-view and lib/sheet have file-level anchors only.
- Rulings numbered in this file come from code comments and the §11 list of `S/docs/rules-flow.md`; their bodies were not all read.
