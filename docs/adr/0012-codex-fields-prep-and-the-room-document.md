# What a game adds to the codex and to prep is declared by its ruleset, and a room can be read from one document

Status: accepted (2026-11-20). The product owner chose the import as a platform feature, every gap below built before
the first real session, each behaving as Auspex does today, and each built so that a game with very different needs
slots in without platform code. It applies ADR 0010 to the codex, prep and a room's data, and changes one of its "not
decided" lines (images).

## Context

P3 ends with one real session of a running Wrath & Glory campaign played here (`docs/p3-plan.md`, Bậc 4). That campaign
lives in an Auspex export. Measured against what a room holds today, most of it fits: eleven characters with builds,
two adventures with twelve scenes, thirty-three handouts (sixteen for one character each), the entries themselves.

What does not fit is the part a GM prepared most carefully:

| In the export | Here today |
|---|---|
| Scene rosters (41 lines, 8 as mobs), planned Tests with a target and who rolls (61), exits (16), pool award and spend lines (77), entries shown on entering a scene (19) | A scene holds text and up to ten Test ids |
| NPC attitude (shown on phones), the stat block an NPC uses, faction stance | An entry is a title and two texts |
| Locations in a tree | Only a scene may have a parent |
| Handout styles | None (issue #159) |
| Pictures on entries | No image is stored anywhere |
| A character's background text | The ruleset declares no field for it |
| Custom creatures | Would be a private pack; no converter |

And there is no way in: a room is built one action at a time.

Each gap could be closed the way Auspex has it: an `attitude` column with five values, a `stance` column with four, a
roster of "threats". That would put one game's nouns into the core, which ADR 0010 exists to prevent. The next games
differ more than this one does: a game whose NPCs have a disposition track and a loyalty number, a game with no NPCs at
all, a board game whose "scenes" are scenarios with a setup list.

## Decision

**1. The split, feature by feature** (ADR 0010, rule 5).

| Feature | The core, for every game | The ruleset declares | The World decides |
|---|---|---|---|
| Nesting | An entry may sit under an entry of its own kind, to a fixed depth, never in a cycle. A scene under an adventure stays as it is | Nothing | Nothing |
| Pictures | One picture on an entry and one on an actor, each with its own "shown to the table" switch, stored by the platform and served only to a seat that may see it | Nothing | Nothing |
| Entry fields | Storing, validating, filtering per seat and drawing the fields an entry kind has | Which fields each entry kind has: their type, options, label and who sees them | Words |
| Scene prep | A scene holds prepared lines; each line is one table action waiting to be sent, and the GM sends it with one tap | Nothing new: the Tests, pools and creature types a line names are already the ruleset's | Words |
| Handout styles | A closed list of handout layouts the platform draws with the room's Theme; a handout names one, and may carry a header line | Nothing | Which of them the setting uses, and their names (ADR 0010, decision 2) |
| Character background | Nothing new: text fields are fields | Text fields on its character type, and where the sheet shows them | Words |
| Custom creatures | Nothing new | Nothing new: they are a private pack of the GM's | Nothing |

**2. Entry fields are a `codex` block in the manifest.** For each entry kind it may list fields, typed as an actor
type's fields are: text, int, bool, an enum whose options carry a label and an optional short note, and a reference to
a pack entry of named types (the stat block an NPC uses). Each field states who sees it, `gm` or `party`, and is `gm`
when it does not say (fail-closed, as every other definition). The seat view filters them where it filters the entry.
The codex screens draw them from the declaration: an enum as a chip, a reference as something that opens. A ruleset
without the block, and a room without a ruleset, have entries exactly as today.

For Wrath & Glory this is an NPC's attitude (an enum the party sees, each option noting its modifier), an NPC's role
and stat block, and a faction's stance (an enum for the GM). The platform knows none of those words.

**3. Prep is parked actions.** A scene's prepared lines are of five kinds, each of which is an action the table
already has:

| Line | Holds | Sending it is |
|---|---|---|
| Roster | A pack entry, how many, as a mob of how many, how the table sees it, a label | `actor.spawn` and adding them to the fight |
| Test | A Test of the ruleset, its inputs (a target), who takes it, whether the target is hidden, a note | `test.call` |
| Pool | A pool of the ruleset, an amount, a note | the pool's own adjust |
| Exit | A label and a scene | opening that scene |
| Reveal | Another entry of the room | `codex.reveal` of it to the party |

Nothing runs by itself and nothing runs outside the one mutation path: a line is sent by a seat that holds the action's
own permission, is refused as that action would be, and lands in the log and in Undo as that action does. A line that
names something the room's ruleset or packs no longer have is kept, shown as broken, and not sendable. The kinds of
line a scene offers follow what the ruleset declares: no pools, no pool lines.

*Amended 2026-11-21 (house decision #86).* Beginning a scene is one action, `scene.begin`: the scene being played goes
to done, the named one becomes active, and each of its reveal lines is then sent as its own `codex.reveal`, with that
action's permission and refusals; a line refused is skipped and named in the answer, and does not stop the begin. This
is the one case where lines run without a tap each, as Auspex's BEGIN does. The begin is recorded so that
`scene.undoBegin` can take it back while it is the room's latest and its scene is still active. An exit line is now
`scene.begin` of the scene it names, no longer only opening it.

**4. A room is a document.** `inconsistable-room`, version 1, lists what a room holds in the platform's own terms: its
name and settings, the ruleset, pack and World versions it expects (by slug, version and hash; never their content),
campaign fields and pools, actors with their fields and builds, the codex with everything above, sessions with their
recaps, clocks, safety lines, and pictures. Ids inside it are its own; the import gives every row a new one.

- **Import** is an owner-scoped write over REST, for a creator, beside the ruleset, pack and World imports. The server
  applies the whole document in one transaction through the same handlers the table's actions use, as the importing
  owner, and refuses it whole on the first problem, by path. The versions it names must already be imported by that
  user (principle 4 is unchanged: a document cannot carry or grant content). No seat comes with it: players join by
  invite, as in any room.
- **Export** writes the same document from a room its owner runs. It is the backup of design §4, and it follows the
  import.
- This is a new entry in principle 6's list of writes outside the action path; the house decision that lands it amends
  `CLAUDE.md`.

The platform never reads another app's format. Turning an Auspex export into a room document is a converter in the
Auspex repository, beside the ruleset and pack generators.

**5. Pictures are stored now, behind one interface.** ADR 0010 left images to P4 with S3. A picture on an entry or an
actor is small, belongs to the room, and is needed for the session, so it is stored in Postgres as bytes behind a
storage interface that an object store can replace later without a change above it. A World still carries no image.
Limits follow Auspex's: two formats, a size cap per picture, a count and total per room. A picture is served only
through the api, to a seat that may read the entry and only once it is shown to the table; it is never in the state a
seat receives.

**6. Every mechanism is tried on a second game before it merges.** The invented fixtures stand in for it: a ruleset
whose NPCs have a disposition number and a patron reference, and one with no `codex` block at all. A mechanism that
needs a change to serve the second is not finished.

## Considered options

- **The Auspex columns in the core** (attitude, stance, a threat roster): the shortest path to the session. Refused: it
  is how Auspex ended up with one game's rules in its core, and the product owner asked for the opposite.
- **A free JSON document per entry, shaped by whoever writes it:** the most open. Refused: the server could not
  validate it or decide who sees which part of it (principle 6), and no screen could draw it.
- **Prep lines as scripts or macros:** more power than one action per line. Refused for the reason ADR 0010 refuses
  plugins, and because a table wants to see what a tap will do.
- **A script that drives the socket** to build a room: no platform change. Refused: on a deployment with sign-in it
  needs the owner's session handed to a script, and it leaves no backup path.
- **The room document carrying its ruleset and packs:** one file for everything. Refused: it would move private packs
  between users around principle 4. A game module (ADR 0010, decision 4) is the file that carries a game.

## Consequences

- The `codex` block exists twice, in TypeScript and in Go, with vectors; the seat view gains a branch on each side with
  a test that a seat does not receive a `gm` field.
- An entry's field values and a scene's prepared lines are small documents read and written whole, validated against
  the manifest, so they are JSONB (data rules). A picture's bytes are a column of their own table. Nesting relaxes the
  check that only a scene has a parent.
- A ruleset revision can remove a field or an option. The compatible upgrade (house decision #51) treats entry fields
  as it treats actor fields.
- The codex screens stop being fixed forms: they draw declared fields. This is the first place a ruleset shapes a GM
  screen other than the sheet.
- Issue #159 keeps the World's terms; its handout-style half is done here.
- The order of work is in `docs/p3-plan.md`, Bậc 4.

## Not decided

- Entry kinds a ruleset adds of its own (a ship, a clue). The nine kinds stay; a field list per kind is the door.
- ~~A location's hazards and a scene's pick of them.~~ Decided by house decision #89: codex field types `tags` and
  `rows`, a sixth kind of prep line (`picks`) that is read and ticked, not sent, and reminders a kind's values raise.
- An item given to a character and taken back. No item is given out in the campaign being moved; it follows.
- Maps (design §3.8), which will use the same picture store.
