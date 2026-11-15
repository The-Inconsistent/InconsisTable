# InconsisTable

An in-person companion for any tabletop RPG or board game: the GM (or, without one, the whole table) runs the game
from a tablet, players use their phones, a TV shows the shared view, and real dice, cards and miniatures stay on the
physical table.

## Language

### Play

**Campaign**:
A game that runs over one or many sessions (a board game's one-off play, a league or a legacy game included), with an
owner, a pinned ruleset and the seats of the people who play it.
_Avoid_: Room, game, table (for this concept)

**Session**:
One sitting of a campaign, from start to end, during which play happens and is logged.
_Avoid_: Game night, meeting

**Table**:
The physical table the group sits around, with its dice, miniatures and terrain.
_Avoid_: Campaign, room

**Encounter**:
A stretch of play with a turn order inside a campaign: a fight in an RPG, the whole play of a board game; it may stay
open across sessions and continue at the next one.
_Avoid_: Combat, battle, scene

**Phase**:
One step of a round that the ruleset names, played in turn or by everyone at once; a round runs its phases in order.
_Avoid_: Step, stage

**Result**:
One character's score and place, or the table's win or loss, at the end of a game.
_Avoid_: Outcome (that is a Test's), score

**Standings**:
A campaign's tally of wins and places over its recent games.
_Avoid_: Leaderboard, ranking (that is one game's)

### Identity

**User**:
One person known to InconsisTable, anonymous or not; it owns campaigns, holds seats and characters, and keeps them when
it becomes an account.
_Avoid_: Member, identity, player (for this concept)

**Account**:
A user with at least one sign-in method, so it can come back on any device.
_Avoid_: Profile, login

**Device**:
One browser that holds a user's session; a user may sit on several devices, and losing one loses no campaign.
_Avoid_: Client, phone (for this concept)

**Sign-in method**:
A way an account proves it is that user, such as a passkey or a recovery code.
_Avoid_: Credential, login

**Admin**:
A platform role on an account that runs the console for the whole install; it is not tied to any campaign.
_Avoid_: Owner, GM, superuser

### People and seats

**Owner**:
The user a campaign belongs to; ownership can be handed to another user. It is not a role and not a seat.
_Avoid_: Admin, creator (that is a platform role)

**Seat**:
The way a person or device sits in a campaign: a member seat (GM, co-GM or player, held by a user) or a token seat (a
guest player from a QR code, or the screen). Everything a device is shown is filtered by its seat.
_Avoid_: Membership (that is only the account kind), user, role

**GM**:
The seat that runs the campaign at the table, sees everything and decides; a co-GM holds a GM seat limited to scopes. A
campaign played without a GM (most board games, or a solo game) has none: its table mode is `gmless` or `solo`, every
player seat runs the table together, and what only a GM would see is seen by nobody, the owner included.
_Avoid_: DM, owner

**Table mode**:
How a campaign sits: `gm` (with a GM), `gmless` (every player runs the table) or `solo` (one player alone). The
ruleset's `game` block says which modes the game is played in; the owner picks one at creation and may change it between
sessions. Without a GM the owner is a player seat that also keeps the room, and counts as the one running it for their
own `private` pack.
_Avoid_: Game mode, play style

**Seat view**:
Everything one seat receives from a campaign, after every rule about what that seat may see has been applied; a
co-GM sees hidden parts only where one of their scopes covers them.
_Avoid_: Snapshot (that is the unfiltered whole), filtered state, player view

**Screen**:
The read-only token seat of the TV that shows the shared view.
_Avoid_: TV seat, display

**World**:
The setting a campaign is played in: its theme, the words it uses in place of the ruleset's, and its shared lore.
_Avoid_: Setting (alone), universe, campaign

**Theme**:
The look of the app (colours, type, texture); there is one base theme, and a World may bring its own.
_Avoid_: Skin, style, World (that is the whole setting)

### Written decisions

**House decision**:
A written choice where a book is ambiguous, made once for the engine or for a ruleset.
_Avoid_: House rule, ruling

**House rule**:
A rule one campaign's GM sets for their own table, as text and optionally as a patch to the ruleset.
_Avoid_: House decision, homebrew

### Game content

**Ruleset**:
The mechanics of a game system or a board game as imported by a user: values, resources, conditions, tests, initiative
and character creation, each citing the printed page it comes from.
_Avoid_: System, rules engine (that is the code), game

**Homebrew**:
A ruleset or pack the user wrote themselves rather than took from a book; it needs no page cites.
_Avoid_: Custom, house rules (see House rule)

**Pack**:
A user-imported set of entries (creatures, gear, options, a board game's expansion) for one ruleset, with a license that
decides who may see it.
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

**Dice pool**:
A Test where a character rolls a number of dice set by their values and counts the faces that score, against a
difficulty number; a special die in the pool may flag a critical or a complication.
_Avoid_: Pool (alone), success roll

**Report**:
A player's entry of what their physical dice showed for a Test Call; the server works out the outcome.
_Avoid_: Result (that is the outcome), submission

### Who is on the table

**Actor**:
Anything in a campaign that carries values the ruleset declares: a character, a creature, an NPC, a group, a vehicle
or a hazard.
_Avoid_: Entity, token, unit

**Character**:
An actor of kind `pc` or `companion` that a seat can hold and play from a phone; in a board game, a player's faction,
colour or player board.
_Avoid_: PC (for companions), hero, player

**Creature**:
An actor the GM brings onto the table from a pack entry; no seat holds it.
_Avoid_: Monster, mob, enemy

**NPC**:
An actor the GM runs that does not come from a pack.
_Avoid_: Creature (for hand-made NPCs)

**Shared resource**:
A resource held by the party, the GM or the campaign instead of by one actor.
_Avoid_: Pool, resource pool

**Combatant**:
An actor's place in an encounter: its side, order and how much of it the table may see. Not an actor of its own.
_Avoid_: Fighter, participant
