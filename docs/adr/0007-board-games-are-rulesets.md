# Board games are rulesets on the same engine

Status: accepted

## Context

InconsisTable grew out of Auspex, a companion for one RPG, and was widened to any RPG. Groups that meet in person play
board games at the same table, often on the same night, and the bookkeeping is the same kind of work: whose turn it
is, each player's resources and score, what each player may see (a hidden hand count, a secret objective, a hidden
role), and who won. The P2 draft put board games out of scope. The product owner asked on 2026-10-29 that the app
serve customisable RPGs and board games in general.

Most of what a board game needs is already in the engine: seats and per-seat views, actors with typed values,
resources clamped on the server, conditions, a turn order with rounds, undo, and pausing across sessions. The P2
GM-less table mode (`campaign.table_mode`, design §3.3, P2 plan D) covers games without a game master.

## Decision

A board game is a ruleset like any other, imported by its users with page cites, played through the same action
pipeline. There is no separate "board game" kind: what a game needs is decided by the manifest blocks it declares.

- Each player sits on a seat and holds one character: their faction, colour or player board. The World's terms
  rename it.
- The whole play of a board game runs as one encounter, so the turn tracker, rounds, undo and the pause across
  sessions serve both families. A legacy game or a league is a campaign with many sessions.
- The manifest gains three optional blocks (design §4.8): a `seated` turn order (seat order, first player fixed,
  rotating or set by hand), `phases` within a round (in turn or simultaneous), and `scoring` (a score expression,
  tiebreaks, and end triggers with cites).
- Components stay physical, as the dice do (CLAUDE.md principle 5). The app does not simulate decks, bags, boards or
  hands. It keeps counts as resources and secrets as `owner` fields. It may deal from a random table to set up a game
  (a scenario, hidden roles), since principle 5 already lets it roll on random tables.
- The server never ends a game by itself. It tells every seat that an end trigger is met; a seat that may run the
  table ends it, and the server ranks the players.

## Considered options

- Keep board games out of scope: leaves the group's other half of the evening on paper, and the engine already has
  most of what they need.
- A separate board-game engine or app: duplicates seats, views, resources and the turn order, and splits the
  principles in two.
- Simulate components (decks, draws, hidden hands) in the app: pulls players onto their phones (principle 8) and
  makes the app play the game instead of keeping its books.

## Consequences

- `CONTEXT.md` widens Encounter, Character and GM; design §4.8 sketches the blocks; the P2 plan gains group F.
- Rules enforcement stays shallow: the app does not check that a move was legal, only keeps the numbers the table
  reports. A heavy game is served as far as its counters and scoring go.
- End-of-game ranks are queried across sessions for standings, so they are rows, not JSONB (CLAUDE.md data rules).
- Each mechanic choice the books leave open (end timing, shared places, first player after a seat leaves) is written
  as a house decision before it is built.
