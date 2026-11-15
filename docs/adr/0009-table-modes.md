# A room knows how it sits: with a GM, without one, or alone

Status: accepted (2026-11-12). Part of P2, group D (`docs/p2-plan.md`).

## Context

Until now a room has a GM. Board games, and a large share of tabletop games, have none, or are played by one person. The
permissions, the Seat view and the rule about private packs all assumed a GM seat: "what only a GM would see is seen by
nobody" was written down in `CONTEXT.md` but nothing enforced it.

## Decision

**A column, `campaign.table_mode`** (`gm`, `gmless`, `solo`; default `gm`), not a document: the lobby filters by it. The
ruleset says which modes its game is played in (an optional `game` block in the manifest, with `title`, `family`,
`genres`, `players` and `modes`; absent, the game is played with a GM). Playing without a GM or alone is a rule of the
game, so a `game` block that allows it carries a `cite`, except in a homebrew ruleset (principle 1). The mode is chosen at
creation among the ruleset's, and changed by the owner with `campaign.setTableMode`, only between sessions, and only to a
mode the pinned ruleset allows (a ruleset that lacks the room's mode cannot be pinned).

**Seats.** Without a GM there are only player seats, and the table's TV. Switching turns every GM and co-GM into a player
(the owner stays the owner) and revokes open invites to a GM seat; switching back makes the owner the GM. Appointing a GM
or co-GM, or inviting one, is refused. A solo room seats one player, the owner's seat counting as that one.

**Permissions.** `canInCampaign` takes the mode from the `Ctx`, which the server builds from the campaign row wherever it
makes one (`auth.ResolveCtx`, a guest's token, the socket's admin handshake, the admin REST action) and again, fresh, in
`table.ApplyAction`, so a socket opened before a switch never keeps the powers of the mode it opened in. Every player seat
then holds `session:run`, `encounter:run`, `clock:run`, `test:call`, `codex:write` and `codex:reveal`; no seat holds
`codex:read_secret`; the owner also keeps the room (settings, invites, removing a seat, screen tokens, a character of
their own). A GM or co-GM seat left over from before the switch acts as a player. The table
permissions do not satisfy an `:own` permission: calling a Test is not reporting for another seat's character.
(The full table is in house decision #44.)

**Hidden information.** The Seat view's sight is not read from the permissions in a room without a GM: that would give
every player the GM side. It is the player's sight, plus the whole Encounter and every Test call (their targets are
public by construction: a call with a hidden target is refused). No seat, the owner included, receives a `gm` codex entry,
the notes on one, session notes, a `gm` pack entry or a `gm` clock. Revealing an entry to `gm` is refused, a new entry is
the party's. The mode in the Seat view is the snapshot's, not the socket's.

**Principle 4 and private packs.** The owner of a room without a GM counts as the one running it: their `private` pack
works there (attach, serve), and it still cannot be granted to another user. `CLAUDE.md` says so.

**Requests.** In a room without a GM `request.send` applies the spend at once, through the same clamped, logged path an
approval takes (house decision #43), under the asker's name, so they can undo it.

**Undo.** A seat undoes a step it logged itself (`session_event.seat_user_id`); the owner undoes any.

## Not decided

Rotating who narrates, and a hidden Test target for a table that wants one, are left for later (`docs/p2-plan.md`,
"Đã chốt" 2 and 3). Every seat has equal powers for now.

## Review fixes

- **Prepared creatures become visible.** Creatures and NPCs prepared under a GM are visible to the table after the switch
  to `gmless` or `solo`: their names and public fields. Their `gm` values stay hidden. The web says so where the owner
  picks the mode.
- **Spawn.** `actor.spawn` of a `gm` pack entry is refused without a GM as `entryNotInPack`, so the reply does not reveal
  which `gm` keys exist.
- **Test numbers.** Every seat gets the numbers of a call, so without a GM a Test can only use what the whole table can
  see (`public` or `party` values): a call reading an `owner` or `gm` field is refused (`testTableOnly`), and a call
  left open from a GM table tells no seat such a number.
- **Seats and books.** A solo room issues no guest token. Only the owner announces a book source (`book:serving`) without
  a GM, checked against the campaign row.
- **First report stands.** Without a GM a player's first report of a character stands (`alreadyReported`); only the owner
  corrects, for their own characters.
