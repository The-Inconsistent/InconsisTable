# Session and fight

The GM starts a session, then runs a fight (or, in a board game, a game) in the Track tab: adds the party, steps
through the turn order round by round, undoes a step, and ends the fight. Players see whose turn it is on their phones.

## Sub-features

- `session-start` starts session N from the Party tab (`Start a session`), and ends it (`End session N`).
- `fight-start` starts a fight from the Track tab (`Start fight`), only once a session runs.
- `fight-add` adds the party (`Add the party (<count>)`) or one character (`Add <name> to the fight`).
- `fight-turns` steps the order (`Next turn`, `Prev`), with `Round N` shown.
- `fight-undo` undoes the last table action (`Undo`).
- `fight-end` ends the fight (`End fight`).

## How to get to it (user POV)

- GM app, tab `Party`, `Start a session`.
- GM app, tab `Track`, the `Fight controls` bar: `Start fight`, `Next turn`, `Prev`, `Undo`, `End fight`.

## Driving it with the browser pane

Preconditions:

- The baseline holds. Use `Crypt of Ash`, which has two player characters (Mira, Tobin) and an NPC. It has no
  running session.

- **Before a session.** Open `Crypt of Ash` from Rooms and choose tab `Track`. The page reads
  `Start a session in the Party tab, then start a fight here.`, and the bar shows `Start a session first`.
- **Start a session.** Choose tab `Party`, then `Start a session`. The button becomes `End session 1`.
- **Start a fight.** Choose tab `Track`, then `Start fight`. The page reads `Nobody is in the fight yet. Add the party
  below.`
- **Add the party.** Choose `Add the party (2)`. The order lists Mira and Tobin, and the bar shows `Round 1`.
- **Turns.** Choose `Next turn` twice. The round reaches `Round 2`, or the active row moves, as the order says.
- **Undo.** Choose `Undo`. The active row steps back.
- **Second view.** Run `stack.ts state "Crypt of Ash"`. `session` is not null and `encounter` lists both combatants
  with the current round and turn.
- **End.** Choose `End fight` and confirm. Then `End session 1` in `Party`.
- **Proof.** Save `session-fight.track.aria.txt`, `session-fight.track.jpg` and `session-fight.state.json`.

## Gotchas

- Not yet driven. The exact `Next turn` count to reach round 2 depends on the initiative order of `sample-d20`. Assert
  the round label and the active row, not a click count.
- This recipe changes `Crypt of Ash`. Run it last in a run, or run `down` and `up` before the next recipe.
- `End fight` asks for confirmation (`End fight and clear temporary creatures`).
