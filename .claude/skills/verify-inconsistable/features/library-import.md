# Library import

The Rulesets & packs page (`/library`) lists a user's imported rulesets and packs. A user pastes or chooses a JSON file
to import a ruleset or a pack, sees what changed, and can then pick the ruleset when creating a campaign.

## Sub-features

- `library-list` shows `Rulesets` and `Packs` with the usage line.
- `library-import-ruleset` imports a ruleset and says `Saved <slug> <version>. Pick it when you create a campaign.`
- `library-import-unchanged` re-imports the same ruleset and says `<slug> <version> was already imported. Nothing
  changed.`
- `library-import-invalid` refuses a document that is neither shape (`Not a ruleset (it needs entities) or a pack
  (it needs entries).`) or not JSON (`That isn't a JSON document.`).
- `library-pick` offers the imported ruleset in Rooms, `New campaign`, `Ruleset`.

## How to get to it (user POV)

- The workspace rail link `Rulesets & packs` (`/library`).
- From Rooms, the `import one` link in `To start with a ruleset, import one first.`
- On `/library`, `Import a ruleset or pack` opens the `Import` panel: textbox `Ruleset or pack (JSON)`, and buttons
  `Choose file`, `Import` and `Clear`.

## Driving it with the browser pane

Preconditions:

- The baseline holds. The seed already imported `sample-d20 0.1.1`, `sample-pool 0.1.1` and one pack.

- **List.** Open `/library`. `Rulesets` lists sample-d20 and sample-pool.
- **Unchanged import.** Open the import panel and paste the sample-d20 fixture. Produce it with
  `bun -e 'import {SAMPLE_D20} from "./packages/rules-engine/src/fixtures/sample-d20.ts"; console.log(JSON.stringify(SAMPLE_D20))'`
  from the repo root, and enter it with `form_input` on `Ruleset or pack (JSON)`. Choose `Import`. The panel says
  `sample-d20 0.1.1 was already imported. Nothing changed.`
- **New version.** Paste the same JSON with `"version"` set to `0.1.2` and choose `Import`. The panel says
  `Saved sample-d20 0.1.2. Pick it when you create a campaign.`
- **Invalid.** Paste `{"hello":1}` and choose `Import`. The panel shows the not-a-ruleset message.
- **Pick it.** In Rooms, `New campaign`, the ruleset combobox offers `sample-d20 0.1.2`.
- **Second view.** Run `curl -s -H "cookie: it_device=$(cat .seed-device)" http://localhost:4013/api/rulesets`. The
  list has sample-d20 `0.1.2`.
- **Proof.** Save `library-import.panel.aria.txt`, `library-import.panel.jpg` and `library-import.rulesets.json`.

## Gotchas

- Not yet driven. Pasting a large JSON through `form_input` may not fire React's change event. If `Import` stays
  disabled, record that, then try `Choose file`. Never set the state with `javascript_tool`.
- The fixtures are the engine's own made-up test data. Never paste book content here (CLAUDE.md principle 2).
- `GET /api/rulesets` lists only the caller's own rulesets (owner-scoped, `apps/api-go/cmd/api/main.go`). Use the
  seed cookie, or the list comes back empty.
