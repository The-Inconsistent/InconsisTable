# Parity with Auspex: fights, dice and the rules engine

Read on 2026-11-21 from Auspex `main` plus the port commits (branch `feat/port-campaign-converter`) against InconsisTable `main` at 2f16f9b.

**Important:** the "Undo Hit / chronicle / HISTORY / recap draft" features are NOT in Auspex main. They exist only on branch `claude/spike-action-journal-i4pz7t` (4 commits, issue #187, rules-flow §11.183). Rows 22-24 cover both versions. `p3-plan.md:72` cites §11.183 as already decided.

**Legend.**
- Source: `S/` = `~/antigravity/wrath_glory`. `sh/` = `S/packages/shared/src`. `api/` = `S/apps/api/src`. `web/` = `S/apps/web/components`. `rf` = `S/docs/rules-flow.md`. `rs` = `S/packages/data/port/ruleset.ts`.
- Target: `T/` = `/Users/thienydo/antigravity/InconsisTable`. `re/` = `packages/rules-engine/src`. `cs/` = `packages/core-schema/src`. `go/` = `apps/api-go/internal`. `tw/` = `apps/web/components`. `hd#N` = row N of `docs/house-decisions.md`.
- Row layout: Source (file:line, who, what seats see) | Target today | Needs | Size.
- "Needs" vocabulary: **manifest** (generated ruleset only), **existing** (an existing primitive used differently), **new block** (a named general building block), **screen** (screen only).

## A. Fight lifecycle, Round 0, turns

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 1 | Start an empty fight; starting replaces a running one | `api/encounter/encounter.actions.ts:322,164-169` (old fight deactivated, fight spend-asks cleared :44). GM. Phones get FIGHT tab | PARTIAL: `encounter.start` (`cs/encounter.ts` ENCOUNTER_ACTIONS; `tw/gm/track/components/fight-bar/fight-bar.tsx`). Refused with no running session (`go/encounter/actions.go:164`) and while another runs (`:168`; hd#28) | Decision D6, else nothing | S |
| 2 | Start a scene's prepared fight: active Agents plus roster (Mob or N rows), scene begins | `encounter.actions.ts:627-674`; `web/gm/scene/scene.tsx:100`. GM | HAS: START THE FIGHT = `encounter.start` + `encounter.add` + `actor.spawn` lines (hd#75; `tw/gm/prep/components/scene-run/scene-run.tsx`). Profiles/scale/marker lines missing (rows 29-31) | none | S |
| 3 | End fight | `encounter.actions.ts:325-328` (clears seize/determination/aware asks). GM | HAS: `encounter.end`, two taps (`fight-bar.tsx`). Also deletes temporary creatures unless Keep (hd#26) | none | S |
| 4 | Round 0, Step 1: mark one row ambushed or acts (also in Round 1 for a latecomer) | `encounter.actions.ts:501-515`; `web/gm/tracker/tracker.tsx:386`; `fight-row.tsx` setup toggle; `rf` §11.167. GM. Phones see AMBUSHED | HAS: `initiative.sides` `setup` + `barred` + `bar` op (`re/primitives/initiative-sides.ts:293`; `rs:780,788-792`; `tw`: `lib/sides/sides.ts:56` actionsOf) | none | S |
| 5 | Round 0: mark a whole side ambushed | `encounter.actions.ts:359-379` (Round 0-1 only); `tracker.tsx:386-390`. GM | MISSING: only per-member `bar` | screen only (loop of `bar` ops) or `bar` input `side` | S |
| 6 | Round 0 step notes and "Set the scene" text | `tracker.tsx:536-545`. GM | PARTIAL: `setup.cite` only (`rs:780`) | new field `setup.note` (own words) + screen | S |
| 7 | BEGIN ROUND 1: clears done/held, keeps ambushes; refused outside Round 0 | `encounter.actions.ts:331-344`. GM | HAS: `begin` op (`initiative-sides.ts:172`; `tw/.../sides-controls/sides-controls.tsx:13`) | none | S |
| 8 | AWARE: pay 1 Glory (Agent) or 1 Ruin (Threat) to act in Round 1; cost refunded by undo | `encounter.actions.ts:585-603`; `tracker.tsx` AWARE. GM | HAS: `lift` + `barred.liftCost` (`initiative-sides.ts:312`; `rs:790`) | none | S |
| 9 | Start a Turn (suggested side picks; ends the current Turn first; refuses Dead/Slain/acted/ambushed) | `encounter.actions.ts:381-425`; `sh/state.ts:550-573`. GM | HAS: `pick` (`initiative-sides.ts:192`; `rs:766-794`). Held equal by `S/packages/data/port/turns.test.ts` | none | S |
| 10 | SEIZE: 1 Glory/Ruin, once until the other side acts, round-start only by Threats, refused when that side is up anyway | `sh/state.ts:578-582`; `encounter.actions.ts:403-413`; `rf` §11.1-2. GM | HAS: `seize` + `outOfTurn.cost` (`initiative-sides.ts:213,355`; `rs:782-785`; hd#57) | none | S |
| 11 | JUST GO: start a READY row off-order for free, noted in the chronicle | `encounter.actions.ts:416`; `rf` §11.168. GM | PARTIAL: `pick` with `force` (`sides.ts` justGo). No chronicle note | row 24 | S |
| 12 | END TURN: row done, lastSide set, Seize bar clears, timed Conditions removed | `encounter.actions.ts:275-313`. GM | HAS: `next` (`initiative-sides.ts:232`) | none | S |
| 13 | HOLD ACTION, then INTERRUPT (clears HELD, starts no Turn); held is lost at Round end | `encounter.actions.ts:427-443`; `rf` §11.171. GM | HAS: `hold`, `interrupt` (`initiative-sides.ts:244,262`); wrap clears held (`:131`) | none | S |
| 14 | Mark done / NOT YET (extra Turn in a Round) | `encounter.actions.ts:446-460`. GM | HAS: `mark` (`initiative-sides.ts:274`) | none | S |
| 15 | Dead/Slain/Lost skip Turns and never hold the Round; an Adversary over Max Wounds stays in | `sh/state.ts:550-562`; `rf` §11.10. All seats | HAS: `unableStates` dead/lost/slain (`rs:775,925`) | none | S |
| 16 | Round complete: waits for GM; BEGIN ROUND N; early NEW ROUND from MORE | `encounter.actions.ts:347-356`; `tracker.tsx:342-348,498-509`; `rf` §11.169. GM; phones see side up | HAS: `roundEnd: manual` (`rs:777`); `newRound` (`initiative-sides.ts:335`); `sides.ts:108` primaryOf | none | S |
| 17 | Round-end reminder list (Mob Resolve DN 3, held actions lost, ambushes end) under ROUND COMPLETE, or in the log on early NEW ROUND | `sh/state.ts:796-811`; `tracker.tsx:508`. GM | PARTIAL: only the Mob chip "Resolve DN 3 at Round end" (`rs:171-175`) | new block: reminders (text lines, `when` turnStart/turnEnd/roundEnd, tied to a state or condition) | M |
| 18 | Turn-start/end Condition reminders (On Fire, Poisoned, Frenzied at start; Bleeding at end); "timed Condition ends this Turn" line | `sh/state.ts:779-786`; `tracker.tsx:194-199,304-336`. GM log | MISSING | same block as 17, on `conditions[]` | M |
| 19 | Timed Conditions (Hindered/Staggered/Vulnerable) auto-end at the end of the holder's NEXT Turn, even if gained during its own Turn | `sh/state.ts:791`; `encounter.actions.ts:289-306,420-423`. GM | PARTIAL: `duration: ownTurnEnd` (`rs:718`), `conditions.expire turnEnd` (`re/primitives/conditions-expire.ts:77`). A Condition added during its holder's own Turn ends that same Turn unless the GM types "lasts 2" (hd#14) | new field on condition duration: armed from the next own Turn | S |
| 20 | TURN BACK: undo the last turn step AND the damage since; refund a Seize/AWARE; 30 steps; button names the step | `encounter.actions.ts:184-270`; `tracker.tsx:351,526-531`; `sh/state.ts:516,744`; `rf` §11.170. GM only (`back` null for phones) | PARTIAL: `event.undo` takes back the newest logged action (`go/campaign/undo.go:35`; hd#60 returns a Seize with its cost). One press = one action; button is just "Undo" (`fight-bar.tsx:80`); needs a running session | new action: undo back to the previous turn boundary, with a label of what it takes | M |
| 21 | Per-line UNDO of a Wounds/Shock tap (client-computed raw inverse, notes like "→ TRAUMATIC INJURY") | `tracker.tsx:72-138,183-185,489-494`. GM | PARTIAL: same `event.undo`; no per-line choice, no notes | row 23, 24 | S |
| 22 | (Spike branch only) server journal: UNDO HIT, REDO, HISTORY dialog, refuses with "Undo X first." on conflict; session.end not undoable; GM only | `S` branch `claude/spike-action-journal-i4pz7t`: `docs/spikes/action-journal.md`; `rf` §11.183; `apps/api/src/journal/journal.actions.ts:15-69`; tracker `undoHit` ~:464 | PARTIAL: LIFO `event.undo`; "There is no redo" (`go/campaign/undo.go:31-34`); recap draft HAS (hd#47) | new action: `event.undo {eventId}` with conflict refusal and redo + history list. Decision D7 | M |
| 23 | Chronicle / vox log: lines per action with warnings, by Turn | `tracker.tsx:766-788` (main, 40 lines, client only); spike: `web/lib/chronicle/chronicle.ts` | MISSING: log is server-side `session_event`, never shown | screen reading the log with labels | M |
| 24 | Command line ORDER › (`hollan dmg 3`, `+2`, `+pinned x`, `go`, `hold`, `back`, `begin`, `next`, `mob 6`, `reveal`, `glory +1`, `wrath -1`) | `S/apps/web/lib/command/command.ts:1-200`; `tracker.tsx:405-414`. GM | MISSING | screen only (parse into existing `rule.op`/`condition.*`/`field.set`) | M |

## B. Combatants, Threats, Mobs

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 25 | Add a Threat from the bestiary (label, hidden or bars at once) | `encounter.actions.ts:98-145,466-488`; `web/gm/tracker/components/add-combatants/add-combatants.tsx:72`. GM | HAS: `actor.spawn` from an attached pack, numbered, with name (`cs/actions.ts:121`; hd#24,#75; `tw/gm/creatures/creatures.tsx:104`). Default view hidden, not bars | none | S |
| 26 | Add as a Mob (2..500, label "×N", 1 Wound per member) | `encounter.actions.ts:105-145` | HAS: `mob` on spawn (hd#66; `rs:681-692,202`) | none | S |
| 27 | Marker colour (red/amber/green/blue/purple/white) on the row and the phones | `sh/state.ts:58`; `fight-row.tsx:128`; add-combatants | MISSING | new block: a combatant `marker` (enum) + swatch widget | S |
| 28 | Visibility hidden / bars / stats (GM chip; FULL behind a picker) | `sh/state.ts:63,742-757`; `tracker.tsx:448`; `fight-row.tsx:186`. GM sets; phones filtered server-side | HAS: hidden/bar/full (`cs/encounter.ts:15`; `encounter.setVisibility`; `combatant-panel.tsx:104`; hd#75). `full` = numbers the viewer view allows, no stat-block text | none | S |
| 29 | Threat Profiles (Heretical Strength, Xenos Cunning, The Enemy Within), additive; unlisted Skill lands on Default+bonus; BONUSES line | `sh/threat-scale.ts:35-119,153-162`; `rf` §11.103-108. GM, at add time | MISSING | existing Condition `effects` (hd#61) + `actor.spawn` field `conditions`; Skill fallback via `has()` | M |
| 30 | Scaling to the table: Elite +Tier W&S; Adversary/Monstrous +seated Agents+Tier; Troop/Mob 0; count fixed at add; Shock "–" stays | `sh/threat-scale.ts:126-151`; `encounter.actions.ts:149-154`; `rf` §11.106-107 | MISSING; `party.characters` counts every PC actor, not seated ones | new block: spawn adjustments (`when` class expr, `add` expr) + expression root `party.seated` | M |
| 31 | Threat class by Tier (T/E/A/M; before first printed Tier uses it; past last keeps last) | `sh/threat.ts:201`; `encounter.actions.ts:134` (snapshot at join) | HAS but live, not snapshot: `at(class, campaign.tier)` (`rs:158,524-534`). Accepted in `p3-plan.md` ("Class theo Tier") | none | S |
| 32 | Class tag on the row (AGENT / TROOP...) | `fight-row.tsx` designation cell | MISSING | screen only (enum label on the order row) | S |
| 33 | Class rule chips (Troop: no Crit, Determination costs Ruin; Monstrous immune...) | `sh/threat.ts:205-212`; `tracker.tsx:668-677`. GM | MISSING | manifest: `notes` on the `class.tN` enum (hd#71) if the creature sheet shows enum notes; else screen only | S |
| 34 | Hidden Threat's Turn shown as "Unseen threat acting", side still due | `sh/state.ts:691,747-751`; `fight.tsx:176` | HAS: `unseen` flag (hd#68; `cs/encounter.ts:80`; `lib/sides/sides.ts` lineOf) | none | S |
| 35 | Add Agents to the fight (+PARTY: active only) | `add-combatants.tsx:95-100`; `encounter.actions.ts:490-499` | HAS: `encounter.add` (`cs/encounter.ts:122`; `tw/gm/track/components/add-combatants/add-combatants.tsx:34`) | none | S |
| 36 | Rename, resize a Mob later, remove a combatant | `encounter.actions.ts:501-548,615-624` | HAS: `actor.rename`, `muster` (`re/primitives/health-harm.ts:257`), `encounter.remove` | none | S |
| 37 | Personal Ruin counter (seeded from the stat block, SPEND / +1) | `encounter.actions.ts:139,550-582`; `tracker.tsx:463,680-690` | PARTIAL: resource `personalRuin` (`rs:693`) via the sheet stepper. Not seeded from `stat.personalRuin`; no tracker shortcut | manifest `start` (hd#52) if it may read `stat.*`; else new block. Screen shortcut | S |
| 38 | Encounter budget check while adding (`BudgetLines`) | `add-combatants.tsx:42-69`; `rf` §11.82 | MISSING (prep-domain overlap) | new block (guideline table) | M |

## C. Damage and health states

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 39 | Hit pad: Wounds/Shock deal or heal, quick amounts, typed ±n | `web/gm/tracker/components/delta-pad/delta-pad.tsx:22`; `tracker.tsx:261-287`. GM | HAS: `health.harm hit` (`re/primitives/health-harm.ts:108`; `tw/.../harm-pad/harm-pad.tsx:32`; hd#66) | none | S |
| 40 | State chips on every seat: Wounded, Dying (+auto Prone), Dead, Exhausted, Slain | `sh/state.ts:597-606`; `character.actions.ts:451` | HAS: `rs:165-187,189-192,795-810`; felled condition `rs:210` | none | S |
| 41 | A Wound while Dying = 1 Traumatic Injury per hit; any healing ends Dying (capped at max) | `sh/state.ts:667-671`; `rf` §11.11 | HAS: `felled` (`rs:208-210`; `health-harm.ts:197-222`) | none | S |
| 42 | Annihilation: one hit over 2× Max Wounds (after Resilience); RESTORE | `sh/state.ts:658-659`; `tracker.tsx:481` | PARTIAL: `destroyed` (`rs:212`; `health-harm.ts:157-163`). RESTORE = GM `field.set annihilated=false`, no button | screen only | S |
| 43 | Traumatic limit Tier+1 → Dead; +TRAUMATIC button | `sh/state.ts:126,308,601`; `tracker.tsx:472` | HAS: `rs:112-117,191`; harm pad injuries +1 (`harm-pad.tsx`) | none | S |
| 44 | Exhausted: further Shock becomes Mortal Wounds; the hit that exhausts stays Shock; also by Condition | `sh/state.ts:628-650`; `rf` §11.12 | HAS: `spent` (`rs:204-206`; `health-harm.ts:132-149`) | none | S |
| 45 | Threat outcomes by class (Troop slain by Wounds or Shock; Elite/Monstrous slain by Wounds, Exhausted by Shock; Adversary "Dying or dead (GM)") | `sh/state.ts:682-688` | HAS: `THREAT_STATES` (`rs:165-187`) | none | S |
| 46 | Shock "–": refuse Shock, tie does nothing | `encounter.actions.ts:559`; `sh/attack.ts:9-23` | HAS: `shockless` (`rs:217`; `health-harm.ts:121-127`) | none | S |
| 47 | Mob: Wounds remove members; one Shock over max removes one; heal restores to start; half-slain chip; +ceil(n/2) attack dice | `encounter.actions.ts:560-576`; `sh/state.ts:679-688`; `sh/attack.ts:26` | HAS: `rs:200-203,171-175,591-596`. `mobBonusDice` derived exists but is shown nowhere | none (shown in row 52) | S |
| 48 | Determination: phone "YOU'RE HIT" sheet (Toughness dice, tap Icons) → ask → GM ACCEPT turns Icons Wounds into Shock (raw); refused while Exhausted | `web/player/hit-sheet/hit-sheet.tsx:48`; `api/spend/spend.actions.ts:165-178`; `rf` §11.172 | MISSING (`derived.determination` only, `rs:99-104`) | new block: a convert op on `health.harm` (Wounds→Shock, n) + request binding + phone widget that opens on own Wounds rising | L |
| 49 | Restore Shock: 1 Wrath + recover Rank+Tier Shock; only if conscious and Shock>0 | `spend.actions.ts:138-155`; `sh/spend.ts:56` | PARTIAL: a generic ask for 1 Wrath works (hd#43); the Shock recovery is manual on the pad | new block: spend option = cost + ops (row 82) | M |
| 50 | Healing and Regroup | HEAL on the pad (`delta-pad.tsx`); Regroup is only a rule line (`rf` §1), no action | HAS: heal on `hit` | none | S |
| 51 | Respite (one Agent or whole party): Wounds 0, Shock 0, Wrath 2; refused while Dying/Dead/Lost; Traumatic and Conditions stay | `character.actions.ts:763-772`; `web/gm/party/components/respite-sheet/respite-sheet.tsx` | PARTIAL: `actor.rest longRest` (`cs/actions.ts:156`; `tw/gm/party/party.tsx:412`; `sheet-view.tsx:96`; `rs:636,646,656-659`). No refusal while Dying/Dead/Lost | new field: reset guard (`resetOn[].unless` expr) | S |

## D. Attack guide and phone fight screens

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 52 | GM attack guide: pick weapon, pool (BS/WS or threat pool), DN = Defence +1 Wounded +2/sustained power, Damage+ED, Resilience−AP; typed total → Wounds/1 Shock/nothing → APPLY | `web/gm/tracker/components/attack-guide/attack-guide.tsx`; `sh/attack.ts:9-48`; `rf` §11.173. GM | MISSING. Numbers exist as derived (`rs:88-95`) but no steps | new block: `strike` widget/primitive (pool expr, DN expr, soak expr, apply via `health.harm hit`) | L |
| 53 | Guide rules for Mob attacker/target and Troop (no Crit line) | `attack-guide.tsx`; `sh/attack.ts:26` | MISSING | same block as 52 | S |
| 54 | Guide "THEN" notes (Crit +1 Glory, Determination per class, death text, Perils for psykers) | `attack-guide.tsx:224-250` | MISSING | class `notes` + widget | S |
| 55 | Phone 1·STRIKE / 2·PICK A TARGET / 3·dice steps; typed damage total reads as Wounds/Shock/Nothing | `web/player/player-app/components/fight/fight.tsx:252`; `strike-steps/strike-steps.tsx:23`; `rf` §11.173 | PARTIAL: the typed total reads as its outcome and a `byOwner` strike is sent from the phone on its turn at a target shown in full, else the phone says what to tell the GM (hd#113); the steps on the Fight tab are #215 part B | `phoneTurn` drawn on the Fight tab | M |
| 56 | Phone power steps: Power Level Bound/Unbound/Transcendent (Wrath dice, Shock), pool, DN, Perils note | `power-steps/power-steps.tsx:32`; `sh/attack.ts:50-55`; `rf` §11.176 | HAS: a strike's `choice` input (the level), a further number for the Shock, once a round by `limit` (hd#113); a Perils note is a strike note | – | – |
| 57 | Phone combat options (every action entry by group; unusable ones sink) | `web/ui/combat-options`; `fight.tsx` MyTurn | MISSING | rules-entry list + widget (book-text rule: summaries only) | M |
| 58 | Phone INCOMING while a Threat acts (Defence, Resilience, Determination dice or none, no Crit from Troop, held interrupt) | `components/incoming/incoming.tsx:15`; `fight.tsx:216`; `rf` §11.175 | MISSING | widget: derived values shown when another side acts | M |
| 59 | Phone DYING panel (three actions, Traumatic x/max, how it ends) and OPTIONS hidden | `components/dying/dying.tsx:7`; `rf` §11.176 | MISSING | state-bound text panel (state `notes`) | S |
| 60 | Phone AMBUSHED panel: ask GM for AWARE (needs ambushed, Glory ≥1, one pending) | `components/ambushed/ambushed.tsx:14`; `spend.actions.ts:28-38,181-185`; `rf` §11.177 | MISSING (players cannot `lift`) | request binding (row 79) | M |
| 61 | Phone NOW ACTING plate, UP NEXT, "n/m to act after you" | `fight.tsx:212-250` | DONE (#215 part B, house decision #114): the Fight tab's acting plate, `SideLine`, and "N of M to act after you" over the combatants the seat is sent (`tw/lib/fight-tab/fight-tab.ts`) | screen only | S |
| 62 | Both sides listed on phones and TV with W/S numbers, Conditions as rule links, StatBlock toggle | `fight.tsx:94-160`; `web/screen/table-screen/table-screen.tsx:37` | DONE (#215 part B, house decision #114): on the phone a tap on a row opens the combatant's card read-only (`SheetView` `part="card"`) from what the seat is sent, its conditions with their cites; the TV keeps `OrderView` | screen only | S |
| 63 | Bars-only Threat note: "ask GM for a Scholar (Int) Test" | `fight.tsx:166`; `rf` §11.174 | DONE (#215 part B, house decision #114): "No details. Ask the GM for a Test." on a bar-only foe's card and in the strike guide; platform words a ruleset cannot yet replace (part D) | screen only | S |
| 64 | Turn alert: flash + vibration + opt-in tone | `frontend.md:1056-1070` | DONE (#215 part A, house decision #112) | screen only | S |

## E. Critical Hits, Perils, psychic powers

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 65 | CRIT lookup: GM types d66, sees printed row, "damage over Resilience" toggle (else 1 Wound only), APPLY runs wounds/shock/mortal/conditions/corruption through normal actions; immunity notes | `sh/lookups.ts:25-66,128-136,175-244`; `crit-perils.tsx:142-165`; `rf` §11.125,156. GM | MISSING: `tables` entries are label-only and server-rolled (`re/manifest.ts:451-458`) | new block: `lookup` (typed result → entry with structured `apply`: health delta, condition, dice amount, immunity). Decision D4, D5 | L |
| 66 | Glorious Criticals: Glory stepper, spent last, each/first effects (single-effect rows only) | `sh/lookups.ts:36-40,226-241`; `crit-perils.tsx:262-295`; `rf` §11.156 | MISSING | part of 65 | M |
| 67 | PERILS lookup: d66 +10 per extra Wrath 1; above 106 reads top row; open-ended last row | `sh/lookups.ts:61-66,86,148-161`; `rf` §11.155 | MISSING (a table's ranges must tile its die exactly, `manifest.ts:828-847`) | part of 65: open range + bonus input | M |
| 68 | Perils → Corruption via `character.corrupt`; "roll on Minor Mutations" opens the Mutation roll | `crit-perils.tsx:162-163,350-359` | MISSING | rows 65 + 97 | M |
| 69 | MANIFEST: one power activation per Round (2nd refused, cleared at new Round, restored by TURN BACK); Wrath-1 count opens PERILS | `encounter.actions.ts:605-613`; `psychic-panel.tsx:42`; `rf` §11.181 | MISSING (no per-round flag; `ResetEvent` has no round event, `re/enums.ts:55`) | new block: once-per-round use flag with refusal | M |
| 70 | SUSTAIN: `Sustaining: X` chips, +2 DN per power on the psyker's Tests, END ALL, quick picks | `sh/psychic.ts:7-66`; `psychic-panel.tsx`; `rf` §11.180 | PARTIAL by manifest: a `list` field `sustaining` + derived `2*count(...)` + into each Test `target` (`rs:727`). Not checked: whether `count()` takes a list field | manifest (+ screen to edit the list) | S |
| 71 | Sustain reminders: +DN at turn start; when hit, "Willpower Test DN = Wounds+Shock+penalty" | `sh/psychic.ts:20-57`; `tracker.tsx:277-285,322` | MISSING | reminder block (row 17) + hit amount | M |

## F. Pools, Wrath, Glory, Ruin, spend requests

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 72 | Glory: party pool, max(6, players+2), overflow lost, visible to all | `sh/state.ts:340`; `campaign.actions.ts:83-98` | HAS: `rs:663-671`; hd#54-56,59 | none | S |
| 73 | Ruin: GM only, max(1, 2×players) | `sh/state.ts:340`; `toPlayerView` `ruin:0` `:715`; `rf` §11.58 | HAS: `rs:672-680`; hd#59 | none | S |
| 74 | GM ±1 on Glory/Ruin seals, scene's planned spends and awards | `web/gm/header/seal-button/seal-button.tsx:30` | HAS: `tw/gm/track/components/pools-panel/pools-panel.tsx:6`; scene pool lines (hd#73) | none | S |
| 75 | Wrath per Agent: GM ±, no cap, reset to 2 at session start and Respite | `character.actions.ts:425-455`; `campaign.actions.ts:145` | HAS: `rs:651-662` | none | S |
| 76 | Wrath Die flags as prompts (6 = +1 Glory, 1 = Complication); Wrath reroll note | `test-prompt.tsx:95-110`; attack-guide THEN | PARTIAL: flags recorded (`rs:237-238`; `re/primitives/dice-pool-successes.ts:52-80`); no prompt or consequence | row 90 | S |
| 77 | Player asks to spend Wrath (reroll, narrative) | `spend.actions.ts:64-87,134-136` | HAS: generic `request.send` of 1 Wrath (`go/request/request.go:74`; `tw/sheet/components/spend-ask/spend-ask.tsx:34`; hd#43); no kind label | none | S |
| 78 | Glory dice/damage ask (+n ≤10, ≤ pool) | `spend.actions.ts:157-160`; `web/ui/request-spend/request-spend.tsx:46` | MISSING: ask on a party pool is refused (`go/request/request.go:80`, `requestNoPool`) | allow null actor + pool resource | S |
| 79 | Seize asked from the phone | `spend.actions.ts:188-197,67` | MISSING | new block: request binds to a `rule.op` | M |
| 80 | Asks: ≤3 pending, one per kind, need pool cover, whole table sees all, only asker cancels; cleared at session start/end and fight end | `spend.actions.ts:64-95`; `sh/spend.ts:21-23`; `spend.clear.ts`; `rf` §11.122-124 | PARTIAL: ≤5 per user, GM side sees all and a player only own, cancelled at session end (hd#43) | Decision D3 | S |
| 81 | GM ACCEPT / DENY; ACCEPT is the spend in one transaction; refusal leaves it pending | `spend.actions.ts:99-104`; `web/gm/spend-requests/spend-requests.tsx:18` | HAS: `request.approve/deny` (`tw/gm/request-bar/request-bar.tsx:29`; hd#43) | none | S |
| 82 | Composite spend options in one tap (cost + effect) | `sh/spend.ts:39-53` | MISSING | new block: manifest `spends` (cost resources + ops) | M |

## G. Called Tests, Corruption, Mutations

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 83 | GM calls a Test: kind skill/attribute/opposed/influence/resolve/corruption, DN (1/3/5/7/9/12), chosen Agents or ALL; a new call replaces the open one | `api/test-call/test-call.actions.ts:22-36`; `web/gm/test-call/components/call-form/call-form.tsx:78`; `sh/dn.ts:3-13` | PARTIAL: `test.call` (`cs/test-call.ts:103`; `go/testcall/actions.go:91`); Tests skill/attribute/trait/corruption (`rs:721-761`); several open at once; DN is a free int | manifest: add Opposed as a `reported` Test (hd#41) | S |
| 84 | Fear mark on a Resolve Test (failure offers +1 Ruin) | `actions.ts:94-102`; `rf` §11.145-146 | MISSING | call marks + offers (row 90) | M |
| 85 | HIDE DN (phones get no DN; server also strips it) | `sh/state.ts:733`; `rf` §11.147 | HAS: `hideTarget`, `showOutcome` (`tw/gm/tests/components/call-form/call-form.tsx:66`; hd#21,30). Outcome hidden too unless the GM opts in | none | S |
| 86 | Wounded +1 DN on called Tests | not in source (`sh/test-call.ts:55-57` adds only the Corruption modifier) | HAS, product decision: `rs:224-228` with `ignoreWounded` | none | S |
| 87 | Phone Test prompt: pool, reminders, DN incl. Corruption level, PASSED/FAILED, HIDE to bar | `web/player/test-prompt/test-prompt.tsx:45`; `sh/test-call.ts:47-57`; `rf` §11.143-147 | PARTIAL: pool and dice counts per band + Wrath face, server resolves (`tw/player/test-prompt/test-prompt.tsx:51`; `dice-pool-successes.ts:52`). No reminders or bar. Decision D1 | screen only | M |
| 88 | Report: second tap overwrites; GM sets a result for a phone that is out | `test-call.actions.ts:38-60`; `tally.tsx:32` | PARTIAL: GM can change (`tw/gm/tests/components/call-card/call-card.tsx:77`); player once only (hd#20). Decision D2 | Decision D2 | S |
| 89 | Tally per Agent; CLOSE; call cleared at session start/end | `test-call.tsx`; `campaign.actions.ts:147,181` | HAS: `CallCard`, `test.close` with reveal (`cs/test-call.ts:133`) | none | S |
| 90 | Failure offers: +1 RUIN; GAIN n CORRUPTION · +1 RUIN; one tap each, once | `tally.tsx:47-60`; `rf` §11.145 | MISSING (`p3-plan.md:72` gap 11) | new block: per-outcome/flag offers (expression → pool or resource deltas) | L |
| 91 | Corruption Test DN = source (1/3/5/7/9) + level modifier (Contaminated from 11) | `sh/corruption.ts:5-43`; `sh/dn.ts:13` | HAS: `rs:122-132,502-507,752-761`. Source-DN set not enforced | manifest: `inputOptions` for ints (new field) | S |
| 92 | Failed Corruption: gain = max(0, DN−Icons) ×2 on Complication; Wrath Critical −2 DN (no floor); spent Wrath −1 (min 1, pays 1 Wrath); +1 Ruin atomically | `sh/corruption.ts:28-46`; `character.actions.ts:477-506`; `ui/corruption-test/corruption-test.tsx:67`; `rf` §11.134 | MISSING | new block: flag-dependent DN in `poolSuccesses` (post-roll change, D1) + offers (row 90) | L |
| 93 | Corruption notices: MUTATION TEST · DN 3+mod per level entered; CHAOS SPAWN; RUIN IS FULL, +1 lost | `sh/corruption.ts:48-62`; `character.actions.ts:499-504`; `rf` §11.135 | MISSING (`ActionResult` has no notices, `cs/actions.ts`) | result `notices[]` + threshold events on resources | M |
| 94 | Corruption level/modifier on own sheet; others see only "Lost"; GM sees points | `sh/state.ts:708-724`; `ui/book-sheet/components/injuries-box/injuries-box.tsx` | PARTIAL: owner resource (`rs:695-702`), `corruptionMod` owner (`rs:502-507`), public `lost` state (`rs:917-923`, ledger variant). Level names missing | new field: derived text/enum label (owner-only) | S |
| 95 | Lost at 26+: out of turn order and Ascension | `sh/state.ts:600,609` | HAS: `rs:917-925,953-955` | none | S |
| 96 | GM Corruption ±n without a Test | `character.corrupt` delta (`actions.ts:210-225`) | HAS: resource adjust | none | S |
| 97 | Mutation roll: severity d6 → d66 +10 per held → forward to next table → own d6 table → ADD; duplicate rerolls; CUT OFF | `sh/mutation.ts:78-115`; `web/gm/party/components/mutation-roll/mutation-roll.tsx:56`; `character.actions.ts:509-537`; `rf` §11.136 | MISSING (`tables` have no held-count modifier, chain, or grant-to-actor; `room.ts:280` notes "a Mutation: no field") | new block: chained table roll with modifier + granted entries with effects. Decision D4 | L |
| 98 | Mutation mods on the sheet; others see "Unseen" mods, same numbers | `sh/state.ts:249-263,694-703` | MISSING (shownAs deferred, `p3-plan.md` #16) | with row 97 | M |
| 99 | Scene's prepared Test rows, Ruin lines, Corruption offers | `web/gm/scene/components/test-rows/test-rows.tsx:28` | PARTIAL: prep `tests`/`pools` lines (hd#73); offers missing | row 90 | S |

## H. Conditions

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 100 | GM sets/clears the 14 Conditions on Agents and Threats; rated ones stack ("Hindered (2)"); players cannot | `sh/state.ts:761`; `sh/lookups.ts:128-136`; `table.dispatch.ts:96` | PARTIAL: `condition.add/remove` (`cs/actions.ts:147`; `combatant-panel.tsx:99`); 14 conditions (`rs:713-720`) with default `stacking: none` | manifest: `stacking: stack` + `maxStacks` on rated ones | S |
| 101 | Monstrous Creatures refuse Fear, Pinned, Staggered | `sh/threat.ts:213`; `encounter.actions.ts:516-527` | MISSING | new field on Condition: `immuneWhen` expr | S |
| 102 | Condition effects on numbers | rf §5: reminders only; Wounded/sustain +DN only in guide/prompt | Condition `effects` exist (`re/manifest.ts:230-241`) but unused (`rs:713-720`). Decision D8 | manifest | S |
| 103 | Players see every Condition chip | `sh/state.ts:742-757` | HAS: hd#67 | none | S |

## I. Session start and end

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 104 | `session.start`: Wrath 2, Glory 0, Ruin = players; closes previous; clears asks/test/whispers; unspent-XP notice | `campaign.actions.ts:141-169` | PARTIAL: rest `sessionStart` (`rs:657,668,678`; hd#53); no notice | result notices (row 93) | S |
| 105 | `session.end`: XP to all (8/10/12), recap, pools untouched; Rank-crossed and "group may Ascend" notices; `session.abandon` = no XP | `campaign.actions.ts:172-205,221`; `web/gm/party/components/session-band/session-band.tsx:50` | PARTIAL: `session.end award` (`tw/gm/party/party.tsx:183`; `rs:957`; hd#64). No notices; abandon = award 0 | notices (row 93) | S |

## J. Dice exception

| # | Feature | Source | Target today | Needs | Size |
|---|---|---|---|---|---|
| 106 | The app never rolls a Test; it rolls only on book tables (ROLL or I ROLLED); Crit/Perils are typed only | `rf:5,194,859`; `web/ui/table-roll/table-roll.tsx:20-41` | PARTIAL: Tests never rolled (hd#1). `table.roll` is server-rolled with no typed result (`cs/actions.ts:270`; `tw/.../tables-panel/tables-panel.tsx:77`). Decision D5 | field: optional `result` on `table.roll` | S |

## Notes

- Target extras not in source: shifts and margin computed (`dice-pool-successes.ts:68-72`); reported Tests (hd#41); degrees (hd#42); clocks; GM-less modes (hd#44).
- `S/docs/game-logic.md:116` says Ruin is visible to players. Stale: `rf` §11.58 and `toPlayerView` `ruin:0` (`sh/state.ts:715`) are the truth.
- Source stores Ruin start as "number of characters", not seated players (`campaign.actions.ts:142`). Target `party.characters` matches that, but scaling uses seated Agents (`rf` §11.106), so two counts are needed (row 30).

## 1. Decisions the product owner must make

- **D1. Test reporting and consequences.** `rf` §11.143-145: the phone taps PASSED/FAILED; a Wrath Critical takes 2 off a Corruption DN and a spent Wrath 1, after the roll (§11.134). Target: the phone counts dice per band and the server resolves against a fixed target (hd#20, `dice-pool-successes.ts:52`). Choose: a flag-dependent DN adjusted after the roll (rows 87, 92), or the GM applies it by hand.
- **D2. A second report overwrites (`rf` §11.144) vs one report stands (hd#20).** hd#20 reasons that a player could retake a failed roll once the outcome is shown.
- **D3. Spend requests.** `rf` §11.122-124: composite kinds (Restore Shock, Determination, Seize, AWARE), at most 3 pending and one per kind, all pending visible to the whole table. hd#43: a generic resource spend, 5 per user, GM side plus asker only. Decide which rule the table keeps, and whether Determination is a request or a called Test.
- **D4. Book text (principle 2).** `rf` §11.125 shows "the printed row" for Critical Hit and Perils (`text`, `glorious` verbatim, `sh/lookups.ts:50-66`); Mutation `text`/`effect` run to 3,000 characters (`sh/mutation.ts:35-36`). CLAUDE.md principle 2 forbids pasted book text. The target can carry numbers, conditions, page cites and relay the page (principle 3). Confirm the lookups then show structured effects plus a cite.
- **D5. Rolling on lookups.** `rf` §11.125 says the Crit/Perils lookups never roll; Mutation tables offer ROLL and I ROLLED (`rf` §11.91). The target's `table.roll` is server-only. Decide whether Crit/Perils may offer ROLL, and add I ROLLED.
- **D6. A fight needs a running session and cannot be restarted (hd#28; `go/encounter/actions.go:164,168`)**, while Auspex runs fights with no session and replaces a running fight (`encounter.actions.ts:164`).
- **D7. Undo granularity.** `rf` §11.170: TURN BACK = last turn step plus damage since. `rf` §11.183 (branch only): journal undo that refuses on conflict, plus redo, UNDO HIT, HISTORY. Target `event.undo` is LIFO, no redo. `p3-plan.md:72` says the platform follows these. Choose what to build, and whether the branch counts as current.
- **D8. Do Condition numbers apply automatically?** Source only reminds (Fear +2 DN, Hindered +n, Vulnerable −n Defence; `rf` §5). Target Condition `effects` could apply them, but hd#10 applies an effect once per Condition, not per stack.

## 2. Out-of-domain actions (source `packages/shared/src/actions.ts`)

`campaign.update`, `campaign.ascend`, `campaign.archive`, `campaign.unarchive`, `campaign.delete`, `session.edit`, `session.delete`, `whisper.send`, `whisper.reply`, `whisper.delete`, `character.create`, `character.build`, `character.draft`, `character.supply`, `character.gear`, `character.requisition`, `character.giveItem`, `character.takeItem`, `character.fitUpgrade`, `character.removeUpgrade`, `character.objectives`, `character.rollObjective`, `character.delete`, `token.issue`, `token.revoke`, `screen.issue`, `screen.revoke`, `invite.create`, `invite.revoke`, `member.remove`, `member.seat`, `seat.leave`, `threat.save`, `threat.delete`, `codex.delete`, `beat.reorder`, `codex.addPlaces`, `codex.addHulk`, `codex.addLoot`, `codex.addRelic`, `beat.begin`, `codex.save` (every kind).

In domain: `pool.adjust`, `spend.request`, `spend.cancel`, `spend.resolve`, `test.call`, `test.report`, `test.close`, `session.start`, `session.end`, `session.abandon`, `character.update` (conditions, annihilated), `character.adjust`, `character.corrupt`, `character.mutate`, `character.unmutate`, `character.respite`, `encounter.start`, `encounter.end`, `encounter.begin`, `encounter.newRound`, `encounter.ambush`, `turn.start`, `turn.seize`, `turn.end`, `turn.hold`, `turn.interrupt`, `turn.mark`, `turn.back`, `combatant.addThreat`, `combatant.addCharacter`, `combatant.update`, `combatant.adjust`, `combatant.aware`, `combatant.remove`, `combatant.manifest`, `beat.startEncounter`. Spike only: `journal.undo`.

## 3. Not checked

- Source tests were not read line by line (`state.test.ts`, `attack.test.ts`, `corruption.test.ts`, `spend.test.ts`, `lookups.test.ts`, `psychic.test.ts`, `threat-scale.test.ts`), nor the Go twins and vectors. Target tests were read only where cited.
- `ADR 0012` was only skimmed. The rules JSON and `lib/combat-options` content were not read.
- Target pieces not read: Go `view` (Seat view), `PoolPad`, whether the target's rules reader links Condition chips to rule text, i18n messages.
- `session.delete`, admin and prep pools beyond the lines cited were not examined.
- The other local source branches with commits ahead of main (`fight-player-steps`, `pr-167`, etc.) were assumed squash-merged and not diffed. Only `claude/spike-action-journal-i4pz7t` was inspected.
- Not verified: manifest `start` reading `stat.*` (row 37); `count()` over a list field (row 70).

**Risk:** the Auspex "current app" may be the spike branch rather than main, which changes rows 20-23 and D7. Several "Needs" sizes (L rows 48, 52, 55, 65, 90, 92, 97) are estimates, not designs.
