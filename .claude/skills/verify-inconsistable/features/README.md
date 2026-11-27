# InconsisTable verification map

This directory is the maintained source for verifying what InconsisTable's users see and do. Read this index before
driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- A run is up: `bun .claude/skills/verify-inconsistable/scripts/stack.ts up`, then `stack.ts doctor` exits 0.
- The web is at `http://localhost:3013` and the api at `http://localhost:4013`. Both belong to this run, with a fresh
  database and the sample seed.
- The browser pane is the sample GM: navigate to `http://localhost:3013/dev/seed` and wait for
  `heading "Your campaigns 2"`.
- Never drive the dev stack (`:3000`, `:4000`) or an instance this run did not start.

## Driving conventions

- Start each recipe from the baseline unless its preconditions say otherwise. A recipe that changes seeded rooms
  (`Crypt of Ash`, `Sunday table`) makes later recipes on the same run start from that changed state. Prefer a room the
  recipe creates.
- Find elements by role and accessible name (`find`, `read_page`), and click by `ref`. The names come from
  `apps/web/messages/en.json` (English is the default locale).
- A second person (a player) uses `http://127.0.0.1:3013`, which gets its own device cookie.
- The second view is `stack.ts state "<room name>"`, the GM's socket snapshot.

## Proof and skip reporting

- Capture the action and the state after it: the `.aria.txt` tree, a `.jpg` screenshot, and the `.state.json` second
  view, all in `.verify/<run id>/evidence/`, named `<feature>-<step>`.
- Record the feature ID and the entry point used with every artifact.
- A mutation is proven only when the server's snapshot shows it.
- Report an unreachable path with the attempted step and the unmet precondition. Never report a skipped entry point
  as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph on the user-visible behavior, then exactly four H2s in this
order: `Sub-features`, `How to get to it (user POV)`, `Driving it with the browser pane`, `Gotchas`.

## Features

- [Rooms](./rooms.md) covers creating a campaign with a ruleset, opening it as GM, and naming yourself. Driven
  2026-11-27 (rooms-create).
- [Invite and join](./invite-join.md) covers the GM's campaign invite and a player taking a seat from a second device.
- [Session and fight](./session-fight.md) covers starting a session and running a fight's turn order in the Track tab.
- [Library import](./library-import.md) covers importing a ruleset or pack as JSON and picking it in a new campaign.
