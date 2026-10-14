# InconsisTable

An in-person companion for any tabletop RPG: the GM runs the game from a tablet, players use their phones, a TV shows
the shared view, and real dice and miniatures stay on the physical table.

## Language

### Play

**Campaign**:
A game that runs over many sessions, with an owner, a pinned ruleset and the seats of the people who play it.
_Avoid_: Room, game, table (for this concept)

**Session**:
One sitting of a campaign, from start to end, during which play happens and is logged.
_Avoid_: Game night, meeting

**Table**:
The physical table the group sits around, with its dice, miniatures and terrain.
_Avoid_: Campaign, room

**Encounter**:
A fight with a turn order inside a campaign; it may stay open across sessions and continue at the next one.
_Avoid_: Combat, battle, scene

### People and seats

**Owner**:
The person a campaign belongs to; ownership can be handed to another member. It is not a role and not a seat.
_Avoid_: Admin, creator (that is a platform role)

**Seat**:
The way a person or device sits in a campaign: a member seat (GM, co-GM or player, with an account) or a token seat (a
guest player from a QR code, or the screen). Everything a device is shown is filtered by its seat.
_Avoid_: Membership (that is only the account kind), user, role

**GM**:
The seat that runs the campaign at the table, sees everything and decides; a co-GM holds a GM seat limited to scopes.
_Avoid_: DM, owner

**Screen**:
The read-only token seat of the TV that shows the shared view.
_Avoid_: TV seat, display

### Written decisions

**House decision**:
A written choice where a book is ambiguous, made once for the engine or for a ruleset.
_Avoid_: House rule, ruling

**House rule**:
A rule one campaign's GM sets for their own table, as text and optionally as a patch to the ruleset.
_Avoid_: House decision, homebrew

### Game content

**Ruleset**:
The mechanics of a game system as imported by a user: values, resources, conditions, tests, initiative and character
creation, each citing the printed page it comes from.
_Avoid_: System, rules engine (that is the code), game

**Homebrew**:
A ruleset or pack the user wrote themselves rather than took from a book; it needs no page cites.
_Avoid_: Custom, house rules (see House rule)

**Pack**:
A user-imported set of entries (creatures, gear, options) for one ruleset, with a license that decides who may see it.
_Avoid_: Module, sourcebook, expansion

**Entry**:
One item of a pack, such as a creature or a piece of gear, with its values and a short summary in the importer's own
words.
_Avoid_: Stat block, card, record

### Rolling

**Test**:
A roll of physical dice with a pass or fail outcome against a target; the ruleset gives each Test its display name
(check, save, attack).
_Avoid_: Roll, check (as the domain term)

**Test Call**:
The GM asking named characters to make a Test, with a target that may be hidden from them.
_Avoid_: Request, prompt

**Report**:
A player's entry of what their physical dice showed for a Test Call; the server works out the outcome.
_Avoid_: Result (that is the outcome), submission

### Who is on the table

**Actor**:
Anything in a campaign that carries values the ruleset declares: a character, a creature, an NPC, a group, a vehicle
or a hazard.
_Avoid_: Entity, token, unit

**Character**:
An actor of kind `pc` or `companion` that a seat can hold and play from a phone.
_Avoid_: PC (for companions), hero, player

**Creature**:
An actor the GM brings onto the table from a pack entry; no seat holds it.
_Avoid_: Monster, mob, enemy

**NPC**:
An actor the GM runs that does not come from a pack.
_Avoid_: Creature (for hand-made NPCs)

**Combatant**:
An actor's place in an encounter: its side, order and how much of it the table may see. Not an actor of its own.
_Avoid_: Fighter, participant
