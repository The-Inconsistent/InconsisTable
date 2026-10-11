# House decisions

Where a rulebook leaves a mechanic open and the engine has to pick a behaviour, the choice is written here, never made
silently in code. Each entry names the mechanic, the books or rulesets it affects, the options, the choice and why.
A ruleset's own decisions live in its manifest; a table's live in its `house_rule` rows.

| # | Mechanic | Decision | Why |
|---|---|---|---|
| 1 | Who rolls | The app never rolls a Test unless the ruleset opts in; players roll physical dice and report. It may roll on a random table when the GM asks. | Carried over from Auspex: the table keeps its dice. |
| 2 | Initiative ties (`initiative.ranked`) | After the score and the manifest's tiebreaks, a tie goes by actor id order. | Deterministic, so every seat shows the same order; a ruleset that wants a roll-off declares it as a tiebreak. |
| 3 | Removing the actor whose turn it is | The turn passes to the next in order; if they were last, a new round starts. | The table never stalls on a turn nobody holds. |
| 4 | `rerollEachRound` | At the end of a round the order clears and nobody is current; the GM starts the next round, which ranks again. | Rolling is the table's, with physical dice; the app waits for the scores. |
| 5 | Damage past a track's minimum (`health.tracks`) | It is lost. | No ruleset in scope carries overflow on the same track; one that does declares an overflow track. |
| 6 | Dropping to a track's minimum | Starts "dying" only when that track declares death saves. | Tracks without death saves (Shock-like) mean nothing at their floor by themselves. |
| 7 | Damage to an actor already dying | Changes nothing by itself; no failed save is added. | Books differ (5e adds a failure); a ruleset adds it explicitly instead of the engine guessing. |
| 8 | Healing above a lowered max | Healing never lowers a value above a max that has since dropped. | A heal must never hurt. |
| 9 | Healing the dead | Refused; undoing death is a GM edit to the field. | Death is a story beat, not a counter. |
| 10 | Condition stacks and effects | An effect applies once per active condition, whatever its stack count. `ponytail:` a ruleset with stacking effects needs a `perStack` flag. | No ruleset in P1 stacks an effect's value. |
| 11 | Co-GM view in the engine | A co-GM sees what a GM sees in actor values; their scopes limit actions and the codex. `ponytail:` per-scope actor views if a table needs a combat-only co-GM blind to secrets. | Running combat needs the stat blocks. |
