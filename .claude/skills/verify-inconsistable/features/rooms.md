# Rooms

The Rooms page (`/`) lists the campaigns a user runs and the ones they sit at. A user creates a campaign with a name
and, optionally, an imported ruleset, and lands in its GM app. They can also set the name other players see.

## Sub-features

- `rooms-list` shows `Your campaigns`, `Where you play` and `Archived` with their counts.
- `rooms-create` creates a campaign with a name and a ruleset, and opens it as GM on the Party tab.
- `rooms-create-no-ruleset` creates a campaign with `None yet`.
- `rooms-open` opens an existing campaign from the list.
- `rooms-name` saves the user's display name.

## How to get to it (user POV)

- Open `/`, the Rooms page of the workspace (the `Rooms` link in the workspace rail).
- Choose the `New campaign` button at the top of the page.
- From inside a campaign, choose `← Campaigns` to come back.

## Driving it with the browser pane

Preconditions:

- The baseline holds: the pane is the sample GM at `http://localhost:3013/` and shows `heading "Your campaigns 2"`.
- No campaign is named `Verify room A`.

- **List.** Read the page. Run `find "Your campaigns"` and `find "Where you play"`. The headings read
  `Your campaigns 2` and `Where you play 1` (Lantern Keep).
- **Open the form.** Choose `New campaign`. Run `find "New campaign"` and click the `button` ref. A form appears with
  textbox `Name` (id `new-room-name`), a combobox whose name is its selected option (`None yet`), and button `Create`.
- **Fill it.** Run `form_input` on the `Name` textbox with `Verify room A`, and on the combobox with
  `sample-d20 0.1.1`. The combobox offers `None yet`, `sample-pool 0.1.1` and `sample-d20 0.1.1`.
- **Create.** Choose `Create` (`find "Create"`, the `submit` button). Within about 3 s the URL becomes
  `/c/<uuid>?tab=party`, the banner reads `Verify room A`, tablist `GM tabs` has `Party` selected, and `Seats`
  lists `Sample GM` with `Owner`.
- **Second view.** Run `bun .claude/skills/verify-inconsistable/scripts/stack.ts state "Verify room A"`. The output has
  `campaign.name` `Verify room A`, one `access.members` entry (Sample GM, role `gm`), and `testDefs` with the
  sample-d20 `check` test. Run `curl -s -H "cookie: it_device=$(cat .seed-device)"
  http://localhost:4013/api/campaigns/<uuid>/rules`. Its `ruleset.slug` is `sample-d20` and its version is `0.1.1`.
- **Back.** Choose `← Campaigns`. `Your campaigns 3` lists `Verify room A`.
- **Proof.** Save `rooms-create.aria.txt`, `rooms-create.jpg`, `rooms-create.state.json` and `rooms-create.rules.json`.

## Gotchas

- The page reads `Opening…` until the lobby loads. Wait for the `Your campaigns` heading before using `find`.
- `read_page` with `filter: interactive` does not list the `New campaign` button. Use `find "New campaign"`.
- The ruleset combobox has no stable accessible name: it is named after its selected option. Find it as `combobox`.
- Campaign names are not unique. The `state` helper takes the first match, so use a name this run made.
- Driven end to end on 2026-11-27 (run `20261127-054627`): `rooms-create` passed. The other sub-features are mapped
  but not yet driven.
