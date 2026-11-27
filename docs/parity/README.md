# Parity with Auspex: the stack

The product owner's bar (2026-11-21): one stack of pull requests that holds every part Auspex has and InconsisTable
does not, working as Auspex does today, each part built as a mechanism any game declares (ADR 0010, ADR 0012). Work
stops only for a decision that is the owner's.

The three inventories beside this file list every behaviour of Auspex against the platform, read from Auspex's code,
starting from its whole action list:

- `fights-and-dice.md` (rows F1 to F106)
- `character-and-phone.md` (rows C1 to C141 and the addendum rows)
- `campaign-prep-codex-screens.md` (rows P1 to P137)

A row is done when its behaviour is on the platform and the generated Wrath & Glory ruleset, packs and World declare
what it needs. This file is the order of work and the rules taken along the way.

## Rules taken without asking

Where Auspex has an answer, the stack follows it (its code and `docs/rules-flow.md` §11). These follow from that and
are not open:

1. **Reminders, not automation,** for Condition numbers (Auspex reminds; it does not change the numbers).
2. **TURN BACK** is the undo of Auspex's `main`: the last turn step and the damage since, with what a Seize or an
   Aware cost given back. The journal with redo and a history, merged into Auspex `main` on 2026-11-21 (commit 7391d928), is not built here.
3. **The app never rolls a Test.** Book tables offer ROLL and I ROLLED; the Critical Hit and Perils lookups take a
   typed result only.
4. **Beginning a scene sends its reveals,** as one tap of the GM's, each reveal its own action in the log, and the
   begin can be taken back. This changes ADR 0012, decision 3 ("nothing runs by itself") for this one case.
5. **Deleting an adventure takes its scenes with it,** behind a typed confirmation.
6. **A Tier raised by hand counts as an Ascension,** once per Tier.
7. **Spend requests** have kinds with effects (reroll, Restore Shock, Determination, Seize, Aware, Glory dice and
   damage), at most three pending and one per kind, and are seen by whoever sees the pool they spend.
8. **Gear is held by the character** as items, so that requisition, GIVE and TAKE BACK, fitted upgrades and EDIT
   CARRIED work as they do in Auspex.
9. **The premise** (Framework, its bonus, Patron, kind of game) is a party-visible entry with declared fields; limits
   are the room's safety lines. **Homebrew sources** are their own pack, attached or not per room.
10. **A custom Threat** is edited in the app and saved as a new version of the GM's own pack through the existing
    owner-scoped import: no new write outside the action path.
11. **One adventure imported into a running room** is sliced in the GM's browser and sent as ordinary actions.

Three Auspex defects are not ported: stale language picks surviving an archetype change, a dead "new character" link,
and other players' builds and drafts being sent to every phone.

## Decided by the owner (2026-11-21)

1. **Whispers are ported** as Auspex has them: a GM's private line to chosen characters, one reply of up to 200
   characters, cleared each session. A single reply to a GM's note is not chat (principle 8); the layer that builds it
   records that.
2. **The character library is built:** a user's own characters outside any room, an owner-scoped write. The layer that
   builds it adds the clause to principle 6 in `CLAUDE.md`.
3. **Packs keep carrying no printed text:** names, numbers, cites, the importer's own summary, and the page through the
   book relay. Boxes that show printed text in Auspex show the name, the numbers and a page link.
4. **No official art:** the printable sheet is drawn by the platform without it, and portraits are pictures users
   upload.
5. **Three play rules stay the platform's:** a phone reports its dice and the server works out the result; one report
   stands; a fight needs a running session and does not replace a running fight.
6. **Undo is TURN BACK only,** as on Auspex's `main`. The journal with redo and a history is not built.
7. **Not ported:** other tables' running games in the lobby, and a character's sheet shown to someone holding only an
   invite link.

## The layers, bottom to top

Each layer is one pull request whose base is the layer below, so its diff is its own piece. Three coding agents work
at a time on layers that touch different areas; a layer joins the stack only after its gates pass on a cheaper model
and its tree is checked. Every mechanism is tried on an invented second game first (ADR 0012, decision 6).

**Rules and the server**

| # | Layer | Rows |
|---|---|---|
| 0 | Words for Tests; a lone named creature is not numbered (#185) | done |
| 1 | This inventory | n/a |
| 2 | Notices on an action's answer: Rank reached, the group may Ascend, unspent XP, a pool that is full, thresholds crossed | F93, F104, F105, C38, P31, P32 |
| 3 | What a Test's outcome offers: per outcome or die flag, one tap applies a pool or resource change; the Fear mark; the Corruption Test's gain | F76, F84, F90, F92, F99, C74, C119 |
| 4 | Spends: the manifest names a cost and the operations it buys; a request may carry one; asks on a party pool; limits and who sees them | F48, F49, F60, F78 to F82, C98, C99, C101, C115 to C117 |
| 5 | Reminders at turn start, turn end and round end; a timed Condition armed from the holder's next turn; a Condition a type is immune to; rated Conditions stack; a rest refused in a state | F5, F6, F17 to F19, F51, F71, F100, F101, C72 |
| 6 | TURN BACK, with the step it takes named on the button | F20, F21 |
| 7 | Lookups: a typed result picks a row whose effects are applied through ordinary operations; open-ended rows and a bonus; I ROLLED on any table | F65 to F68, F106 |
| 8 | Records a character gains in play, with effects on its numbers and a name others do not see: Mutations and the chained tables that grant them | F97, F98, C58, C75 |
| 9 | Once per round, and what a character sustains | F69, F70, C71, C96 |
| 10 | Spawn options a ruleset declares (profiles, scaling to the seated party), a marker, a counter seeded from the entry, the encounter budget | F27, F29, F30, F32, F33, F37, F38, P73, P74 |
| 11 | Items a character holds: GIVE and TAKE BACK, requisition, fitted upgrades, EDIT CARRIED, ammunition of any type; a rebuild keeps them | C51, C54, C76 to C82, P99, P100 |
| 12 | A GM's override of a derived value; a Tier raised by hand; a build over a hand-made sheet | C17, C23, C30, C32, A10 |
| 13 | Sessions: end without XP, delete the last, the GM's journal list, titles and notes, the next session form and its calendar file | P31 to P40 |
| 14 | Scenes: begin and its reveals, undo of a begin, exits that begin the next scene, delete an adventure with its scenes, the time an entry was revealed | P46, P56 to P58, P63, P98 |
| 15 | Entries made from a pack entry, and generators (ordered tables feeding them): places, NPCs, factions, scene events, the hulk, loot, relics, name and look rolls | P9, P52, P53, P87, P91 to P94 |
| 16 | A list of typed rows as an entry field: hazards on a place, a scene's picks with "spotted", Keywords as tags, a reminder a field's value raises | P76 to P78, P88, P89 |
| 17 | The setup checklist a ruleset declares | P8 |
| 18 | A room exported as its document; a fresh start; one adventure brought into a running room | P47, P124 to P128 |
| 19 | The character library | C25 to C27 |
| 20 | Whispers | C113, C114, P122 |
| 21 | Admin: users, per-room controls | P27, P132, P133 |

**Screens** (ADR 0010, decision 3: layouts name widgets, for the sheet, the phone on its turn, a tracker row, the TV)

| # | Layer | Rows |
|---|---|---|
| 22 | Layout targets and the first widgets; the sheet as the printed book has it, box by box | C42 to C61, C63, C64 |
| 23 | The phone: the strip on every tab, the Fight tab (now acting, your turn's steps, incoming, you're hit, dying, ambushed), tabs in the address, new marks | C88 to C100, F55 to F64 |
| 24 | The GM's attack guide, the log of the fight, the command line, class tags and chips | F23, F24, F52 to F54 |
| 25 | The play home: the scene as a page, in this scene, where next, the strip, no scene | P48 to P50, P59 to P62, P65 to P67, P72 |
| 26 | The GM's header and shell: seals, call a Test, Tier and round, an address per tab and entry, the read-only banner | P14, P16, P118 to P121, P123 |
| 27 | The codex and the phone's intel: one-tap reveal, search, the inbox, show the table, the mission view, peek, auto-links | P81, P82, P97, P104 to P106, P111 to P115, C102 to C106 |
| 28 | Creating a campaign: the wizard, the first-run steps, the premise pickers | P5 to P7, P10, P11, P13 |
| 29 | The party tab: the session band and journal, invites, the next session | P21, P24, P35 to P37, P39 |
| 30 | Books: the GM serves their own PDFs to phones | P109, C109, C110 |
| 31 | Meanings on tap and the World's words (issue #159) | C62, C140 |
| 32 | Printing in the browser: the sheet, handouts, cards, tents | C65, C66, C138, P129, P130 |

**The game's own declarations** (in the Auspex repository, after the layer they need)

The ruleset's new blocks, the packs (patrons, Frameworks, presets, tables, hazards, loot, Mutations, the lookups as
structured rows), the World's words, and the converter. One pull request there per group of layers.

## Not in the stack

Printed battle maps (undecided, outside P3). The Next.js upgrade (#144). The two things of decision 7.
