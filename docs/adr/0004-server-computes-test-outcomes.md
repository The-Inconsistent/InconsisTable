# The server computes Test outcomes from reported physical dice

Status: accepted

## Context

Dice stay physical (CLAUDE.md principle 5). A Test often has a hidden target (DC) that players must not learn, so the
phone cannot decide success or failure itself.

## Decision

The GM calls a Test; the server computes each character's modifier and target at call time and keeps them
(`test_call_target`). The player reports what the physical dice show (`faces`, natural, total); the server resolves
the outcome (`dice.sumVsTarget.resolve`) and stores it (`test_report`). The target and, optionally, the outcome reach
seats only when `hide_target`, `show_outcome` and `revealed` allow it, so a hidden target never leaves GM seats. The
app never rolls a Test for a player; that would be a per-ruleset option needing a house decision.

## Considered options

- Send the target to the phone and resolve client-side: leaks hidden targets and breaks "the server decides".
- GM resolves every report by hand: no leak, but slows the table and loses the per-character breakdown.
- App rolls the dice: contradicts principle 5.

## Consequences

- Modifier and target are frozen at call time, so later changes to a character do not alter an open Test.
- The report path must be validated server-side (reporter owns the character, faces are legal for the dice).
