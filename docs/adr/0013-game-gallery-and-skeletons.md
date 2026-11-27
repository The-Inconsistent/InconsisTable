# The game gallery is open-license only; a published game gets a Skeleton

Status: proposed (2026-11-27). It replaces `0009-game-modules.md` (#282), which was written against an old `main` and
contradicted ADR 0010: it had a room pin one module version and folded the World into the module. ADR 0010 stands
as accepted: a room pins the parts, a game module is the list that installs them, and a World stays its own document.
This ADR adds only what ADR 0010 left open, about picking a game.

## Context

The product owner wants a GM to pick a game from a screen and get the whole set prepared, without importing JSON.
ADR 0010 decision 4 gives the mechanism: a game module names one ruleset version, its pack versions and optionally a
World version, may carry the documents, imports them in one transaction, and "Choose game" creates a room from it in
one step. Two questions remain open:

- Which game modules can a user see who did not import them? The P3 plan leaves the public catalogue to P4.
- A game whose rules are not openly licensed (a Warhammer, Magic, or D&D beyond the SRD) cannot be offered with its
  rules filled in (ADR 0001, principles 1 and 2). What can the gallery offer for it?

## Decision

**1. "Choose game" is a gallery of game modules.** NEW ROOM opens on cards, each drawn with its World's Theme when it
has one, and shows its name, its kind (an RPG, or a board game when the ruleset declares `scoring`), and its license.
Choosing a card and then Create pins the module's parts (ADR 0010 decision 4). The user's own game modules are always
there. Picking a bare ruleset stays possible for a user who has no module.

**2. The public part of the gallery is open-license only** (P4, with the catalogue). A game module appears to other
users only when every part it names is licensed `srd`, `orc`, `cc-by` or `homebrew` and an admin approved it. A
module naming any `private` part is never public and cannot be granted (principle 4). Picking a public module copies
nothing into the picker's library: the room pins the same versions.

**3. A published game gets a Skeleton, not a module with its rules.** A Skeleton is a public game module whose
ruleset is a template in the sense of house decision #46, and whose World carries the look and words of a genre:

- The ruleset holds only engine structure: the entities, the resources, the Test kind, the initiative, with
  placeholder names, every `cite` `""` and the source `license` `""`. The validator's problem list is the checklist
  of what the GM fills in from their own book.
- It never names the game, its publisher, factions or trademarks. Its World never copies a publisher's trade dress.
  It is named by genre ("gothic far-future war", "grim low fantasy", "card duel").
- Choosing a Skeleton forks it into the GM's library: the template becomes their own ruleset (`private` once they
  fill in a book's numbers), the World is pinned as it is. The guided filling is the library's form, which shows each
  problem as a field to complete with its page cite. A room can use the fork once it validates, as any ruleset.

## Considered options

- **A room pins one module version** (#282): refused by ADR 0010 for three reasons that still hold.
- **Rule slots inside the manifest** (#282): a second manifest state the validator would accept half-empty, in both
  engines. House decision #46 already gets the same checklist from the ordinary validator.
- **Public mechanics-only modules for published games** (numbers and page cites, no text): the closest to one click,
  but whether it is lawful is a legal question. Not done without legal advice.
- **A code package or a micro frontend per game:** refused by ADR 0010 ("game code as plugins") and ADR 0001.

## Consequences

- ADR 0010 decision 4 is built first (the game module document, its import and the room made from it); the gallery's
  public part and approval wait for P4.
- `CONTEXT.md` keeps World and Theme as ADR 0010 defines them, and gains **Game module**, **Gallery** and **Skeleton**.
- A Skeleton's theme is reviewed before it is approved, for trade dress as well as contrast.
