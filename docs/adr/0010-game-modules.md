# A game is a module of imported parts, and the core decides nothing per game

Status: proposed (2026-11-19). Awaits the product owner. It replaces the "Game Module Platform" proposal of 2026-11-02
where the two differ (see "Considered options", one pinned hash).

## Context

InconsisTable is meant to be one core app that runs many games (Wrath & Glory, D&D, Cyberpunk RED, a board game), each
with its own rules, its own look and its own screens, and with features that are shared by every game or decided by one:
character creation, maps, running the table as a GM.

The rules side already works this way. A ruleset is an imported, immutable document (`ruleset_version`: a version and a
content hash) that picks and parameterises platform primitives; a pack is imported content for one ruleset; a room pins
one ruleset version and attaches pack versions (`campaign.ruleset_version_id`, `campaign_pack`). ADR 0007 added board
games without a "board game" kind: what a game needs is decided by the manifest blocks it declares.

The rest does not work this way yet:

- **Look.** There are two base Themes, `lantern` and `felt`, picked per device by a cookie. No room, ruleset or World
  can bring a Theme. `CONTEXT.md` defines World and Theme, and three `ponytail:` notes defer them.
- **Words.** A ruleset can carry `terms`, but nothing reads them. Labels are in one language.
- **Screens.** A ruleset's `layout` is a list of sections naming values, and it is read only by the sheet. The tab sets,
  the tracker's combatant panel and the TV are fixed components, so every game looks like the first one.
- **Compatibility.** A ruleset states a `core` range, which is checked for shape only. There is no core version to match
  it against.
- **Upgrades.** A room whose characters are built cannot move to another version of its ruleset
  (`charactersUseOtherVersion`); the upgrade with a dry-run diff of design §4.5 was never built.
- **Setting up.** A user who wants to play one game imports a ruleset, then each pack, then attaches each to the room.

Wrath & Glory is the first real game to be ported (P3) and needs every one of these. Deciding them inside that port
would let one game shape the platform, which is how Auspex ended up with its rules in the core.

## Decision

**1. Four layers. Only the top three differ between games, and none of them is code.**

| Layer | Holds | Who writes it |
|---|---|---|
| Core | Rooms, seats, the one action path, the event log and undo, the Seat view, codex, sessions, maps, book relay | The platform |
| Building blocks | Primitives, effect types, expression functions, screen widgets, Theme tokens. Closed lists | The platform, by release |
| Ruleset and packs | The mechanics and content of one game, and which values its screens show | Users, imported |
| World | The look and the words of one setting | Users, imported |

A game never adds code, on the server or in the browser, and never adds CSS. When a game needs something no part can
express, the platform gains one building block that every later game can use (rule 5).

**2. A World is a third imported document, beside the ruleset and the pack.** It has immutable versions with a hash, as
they do, and a room pins one (`campaign.world_version_id`, optional; without one the room has the base Theme and the
ruleset's own words). A World holds:

- a **Theme**: values for the platform's Theme tokens, for the dark and the light set, and picks from the platform's
  lists of typefaces and textures. Tokens it leaves out keep the base value. The importer refuses a Theme whose text
  and surface tokens fall under the contrast the base Themes meet (principle 8);
- **terms**: words that replace the app's and the ruleset's (`party`, `gm`, `hp`), per locale. This is what finally
  reads `terms`; a ruleset's own `terms` stay as its defaults;
- **handout styles**, picked from the platform's list.

A World is independent of a ruleset (design D4): one World can dress two rulesets, and a ruleset can be played in two
Worlds. The device's lantern or felt pick remains for a room without a World.

**3. A ruleset's `layout` covers more than the sheet, and its rows may name a widget.** The keys become targets: the
sheet (as now, by entity type), the phone on the seat's turn, a combatant's row on the GM tracker, the TV. A row is
either a value path, as now, or a widget from the platform's list bound to values, with a variant. The platform draws
every widget with the room's Theme. A target the ruleset does not lay out keeps today's fixed screen, so every imported
ruleset stays valid.

**4. A game module is the list that makes these one game.** It names one ruleset version, the pack versions that go
with it and, optionally, a World version, each by id, version and hash, and it may carry the documents themselves so
that one file imports a whole game. Importing a module imports its parts through the existing importers, in one
transaction. "Choose game" lists modules; creating a room from one pins the ruleset, attaches the packs and pins the
World in one step.

The room still pins the parts, not the module. Every gate stays where it is: a `private` pack inside a module is still
served only in the rooms its owner runs (principle 4), and a module holding one cannot be shared.

**5. One rule decides where a feature lives.**

1. If the manifest can say it, it is written in the ruleset (or the World, when it is look or words).
2. If not, it becomes one building block: a primitive for a rule, an effect type for a modifier, a widget for a display.
   It must be usable by another game, and is checked on paper against a second ruleset before it merges (5e SRD while
   Wrath & Glory is the game being ported).
3. A screen or a tab appears because the ruleset declares the block it shows (`initiative`, `phases`, `scoring`,
   `creation`, `tables`), never because of the game's name or a per-game switch.

Applied to the three features named above:

| Feature | The core, for every game | The ruleset decides | The World decides |
|---|---|---|---|
| Character creation | The builder, drafts, the character library | The steps, costs and options. A system the steps cannot express gets a primitive (an XP ledger for Wrath & Glory) | Words |
| Maps | All of it: images, nesting, pins linked to codex entries, fog, where the party is, the TV (design §3.8). A memory aid, never a virtual tabletop | Nothing: a map holds no rules | Pin and handout styles |
| Running the table | Codex, prep, recap, clocks, safety, calling Tests, the tracker, undo, table modes | What a Test, a turn and a health track are; which modes the game is played in | Look and words |

**6. The core has a version, and a ruleset's `core` range is checked against it at import.** The version rises with
every new building block. A platform release recompiles every imported ruleset in a check, so a release that would
break one is known before it ships.

**7. A room can move to a newer version of its ruleset between sessions,** through the migrations a new version
declares and a dry-run diff the owner confirms (design §4.5). Changing a World needs none of this: a World holds no
values.

## Considered options

- **Game code as plugins** (a Foundry system, a Minecraft mod): the most freedom for a game's author. Refused: plugin
  code breaks on platform releases, cannot be trusted with other users' rooms on the server or in their browsers, and
  would open a second mutation path (principle 6).
- **One app or fork per game,** which is what Auspex was: each fix is made once per game, and a table that plays two
  games needs two apps.
- **A room pins one module hash** (the proposal of 2026-11-02): one number to pin and to upgrade. Refused for three
  reasons. It ties a World to one ruleset, against design D4. It makes a change of colour a new version of the rules,
  with the upgrade that goes with it. And it repoints the room, every actor and every builder draft from
  `ruleset_version` to a new table for no change in behaviour.
- **Capabilities a room grants to a module** (also from that proposal): dropped until something needs it. The one case
  known today, the app rolling a Test, is already a per-ruleset option that needs a house decision (principle 5).
- **Free CSS, uploaded fonts or remote images in a World:** the widest range of looks. Refused: it cannot be held to
  "readable at arm's length", it lets an imported file run styling tricks against other users, and remote files tell a
  third party who is at the table.
- **A switch per game or per kind of game** for which features show: refused in ADR 0007, for the same reason.

## Consequences

- `CONTEXT.md` gains **Game module**, **Widget** and **Target**, and its Pack entry stops listing "Module" as a word to
  avoid, since the bare word would now be ambiguous: write "game module".
- New tables for Worlds and for modules, as columns and foreign keys (a room's World is referenced, a module's parts
  are joined). The documents themselves are JSONB, read and written whole.
- The layout schema and the World schema exist twice, in TypeScript and in Go, with vectors (CLAUDE.md, "Two engines").
- The Wrath & Glory look and its words are a World in the private content, not a Theme in this repo. The base Themes
  stay the only look the platform ships (ADR 0001).
- The ruleset upgrade (7) becomes a prerequisite of P3: the Wrath & Glory ruleset will be revised many times while
  characters built with it are in play.
- The first widgets, targets and Theme tokens are chosen in the P3 plan from what the Wrath & Glory sheet and tracker
  need, each checked against 5e SRD on paper. This ADR fixes the shape, not the list.
- A heavy game is served as far as the building blocks reach. The answer to "this game needs X" is a platform release,
  which is slower than a plugin and is the price of the modules staying data.

## Not decided

- Whether a ruleset's labels can be given in more than one language, or a second language is a second import.
- Whether a room remembers which module it was made from, so that "a newer module exists" can be offered.
- A World's shared lore (places, factions and NPCs that several campaigns inherit, design §4.7): later, with the
  campaign library.
- Emblems and other images in a World: they wait for image storage (P4).
- Printed battle maps with a grid, asked for in Auspex: still open, and outside this ADR. Maps here are the memory aid
  of design §3.8.
