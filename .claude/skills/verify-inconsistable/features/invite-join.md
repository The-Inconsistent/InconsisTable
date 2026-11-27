# Invite and join

The GM invites people to a campaign with a link shown as a QR code and as text. A player opens it on their phone,
picks or creates a character, and takes the seat. The GM sees the new seat at once.

## Sub-features

- `invite-campaign` shows a campaign invite for a chosen role (`GM`, `Co-GM`, `Player`) as a QR and a link.
- `invite-preview` shows `Join <campaign>` and `You're invited to a <role> seat.` to the person opening it.
- `invite-pick` lets a player pick an unclaimed character (`Play <name>`).
- `invite-new` lets a player start a new character (`New character name`, `New`) when every character is taken.
- `invite-seated` sends a person who already holds a seat to the table (`You're seated · open the table`).

## How to get to it (user POV)

- GM: open the campaign, then the `Party` tab, then `Invite`. Pick the role in the `As` combobox and choose
  `Campaign QR`.
- Player: scan the QR code, or open the link, `/invite/<token>`.

## Driving it with the browser pane

Preconditions:

- The baseline holds.
- `Verify room A` exists (run [Rooms](./rooms.md) `rooms-create` first), and it has one character: in its `Party` tab,
  `New character name` holds `Pip`, then `Add`.

- **GM shows the invite.** In `Verify room A`, tab `Party`, leave the role combobox on `Player` and choose
  `Campaign QR`. A panel titled `Campaign invite · Player` shows a QR (`img "QR code for Campaign invite · Player"`)
  and the link as text. Copy the `/invite/<token>` path from `get_page_text`.
- **Player opens it.** Run `tabs_create`, then `navigate` to `http://127.0.0.1:3013/invite/<token>` in the new tab.
  The page reads `Join Verify room A` and `You're invited to a player seat.`
- **Player takes the seat.** Choose `Play Pip`, or `Take the seat` if it shows. The tab moves to the player app at
  `/c/<uuid>`, with tablist `Player tabs`.
- **GM sees it.** Back in the GM tab, `Seats` lists the new player. Run `stack.ts state "Verify room A"`.
  `access.members` has two entries, and the player's `characterIds` holds Pip's actor id.
- **Proof.** Save `invite-join.gm-qr.aria.txt`, `invite-join.player.aria.txt`, `invite-join.player.jpg` and
  `invite-join.state.json`.

## Gotchas

- Not yet driven. Whether `next dev` hydrates pages opened at `127.0.0.1` is unverified. Next only accepts dev
  requests from listed origins (`DEV_ORIGINS`), so a page that renders but never reacts is this gotcha, not an app bug.
  Record it, and do not switch the player to `localhost`: there it would share the GM's cookie.
- A player tab opened at `localhost:3013` is the sample GM. It shows `You're seated · open the table` and proves
  nothing about joining.
- Invites expire and can have a use limit. Make a fresh one each run.
