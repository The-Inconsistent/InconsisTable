package table

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/auth"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

// How a room sits (docs/adr/0009-table-modes.md), end to end in one rolled-back transaction: parsed, authorized and
// dispatched as the gateway does. The seats' Ctx are built without a mode, as a socket opened earlier would carry one:
// ApplyAction reads the mode from the campaign row.

// modeFixture is the play fixture whose game can be played with a GM, without one, or alone. The dc is a number the GM
// would keep: the Test's target visibility is the fixture's.
func modeFixture(t *testing.T, modes ...string) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(playFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	m["game"] = map[string]any{"title": "Fixture Table", "players": map[string]any{"min": 1, "max": 4}, "modes": modes,
		"cite": "Fixture p.9"}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func anyModes(t *testing.T, tx pgx.Tx) *play {
	t.Helper()
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, modeFixture(t, "gm", "gmless", "solo"))
	return &play{t, tx, room}
}

func (p *play) startSession() { p.send(p.room.GM(), map[string]any{"type": "session.start"}) }

func (p *play) setMode(c cs.Ctx, mode string) Result {
	p.t.Helper()
	return p.send(c, map[string]any{"type": "campaign.setTableMode", "mode": mode})
}

func (p *play) modeOf() string {
	return dbtest.Scalar[string](p.t, p.tx, `SELECT table_mode FROM campaign WHERE id = $1`, p.room.ID)
}

func (p *play) roleOf(userID string) string {
	return dbtest.Scalar[string](p.t, p.tx, `SELECT role FROM membership WHERE campaign_id = $1 AND user_id = $2`, p.room.ID, userID)
}

func TestSetTableModeIsTheOwnersBetweenSessionsAndForAModeTheGameAllows(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "P"))
		coGM := dbtest.User(t, tx, "Co")
		dbtest.Exec(t, tx, `INSERT INTO membership (campaign_id, user_id, role, scopes) VALUES ($1, $2, 'cogm', '{combat}')`, p.room.ID, coGM)
		p.send(gm, map[string]any{"type": "invite.create", "mode": "room", "role": "cogm", "allowGuests": false, "hours": 12.0})

		p.startSession()
		p.refused(gm, map[string]any{"type": "campaign.setTableMode", "mode": "gmless"}, "changeBetweenSessions")
		p.send(gm, map[string]any{"type": "session.end"})

		// Only the owner: a player, a co-GM and a stranger are refused.
		p.refused(player, map[string]any{"type": "campaign.setTableMode", "mode": "gmless"}, "noPermission")
		seated := gm
		seated.Seat = cs.Seat{Kind: cs.SeatMember, Role: "cogm", Scopes: []string{"combat", "codex", "session", "party"}}
		other := dbtest.User(t, tx, "Co")
		seated.UserID = &other
		p.refused(seated, map[string]any{"type": "campaign.setTableMode", "mode": "gmless"}, "noPermission")

		p.setMode(gm, "gmless")
		if p.modeOf() != "gmless" {
			t.Fatalf("mode %s", p.modeOf())
		}
		// Every GM and co-GM is a player now; the owner still owns the room.
		if p.roleOf(p.room.Owner) != "player" || p.roleOf(coGM) != "player" {
			t.Fatalf("seats after the switch: owner %s, co-GM %s", p.roleOf(p.room.Owner), p.roleOf(coGM))
		}
		if owner := dbtest.Scalar[string](t, tx, `SELECT owner_user_id FROM campaign WHERE id = $1`, p.room.ID); owner != p.room.Owner {
			t.Fatalf("the owner is %s", owner)
		}
		if open := dbtest.Scalar[int](t, tx, `SELECT count(*) FROM invite WHERE campaign_id = $1 AND revoked_at IS NULL AND role <> 'player'`, p.room.ID); open != 0 {
			t.Fatalf("%d invites to a GM seat left", open)
		}
		live := dbtest.Must[*Loaded](t)(LoadSnapshot(context.Background(), tx, p.room.ID))
		if live.Snapshot.State.Campaign.TableMode != "gmless" {
			t.Fatalf("the snapshot says %q", live.Snapshot.State.Campaign.TableMode)
		}
		if k := KicksOf(gm, cs.Action{"type": "campaign.setTableMode", "mode": "gm"}); len(k) != 1 || !k[0].All {
			t.Fatalf("every seat resolves again: %v", k)
		}

		// Solo seats one player: the room has three.
		p.refused(gm, map[string]any{"type": "campaign.setTableMode", "mode": "solo"}, "soloOneSeat")

		// Back with a GM, the owner takes the GM seat again.
		p.setMode(gm, "gm")
		if p.roleOf(p.room.Owner) != "gm" || p.roleOf(coGM) != "player" {
			t.Fatalf("after switching back: owner %s, co-GM %s", p.roleOf(p.room.Owner), p.roleOf(coGM))
		}
	})
}

func TestARulesetThatLacksTheModeRefusesIt(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		// A game with no `game` block is played with a GM.
		p := &play{t, tx, dbtest.NewRoom(t, tx)}
		p.room.Pin(t, tx, playFixture(t))
		p.refused(p.room.GM(), map[string]any{"type": "campaign.setTableMode", "mode": "gmless"}, "modeNotPlayed")
		p.refused(p.room.GM(), map[string]any{"type": "campaign.setTableMode", "mode": "solo"}, "modeNotPlayed")

		// A game played with a GM and alone, not without one.
		q := &play{t, tx, dbtest.NewRoom(t, tx)}
		q.room.Pin(t, tx, modeFixture(t, "gm", "solo"))
		q.refused(q.room.GM(), map[string]any{"type": "campaign.setTableMode", "mode": "gmless"}, "modeNotPlayed")
		q.setMode(q.room.GM(), "solo")

		// A room keeps how it sits: a ruleset that is not played that way is refused.
		version := func(manifest string) string {
			slug := dbtest.Scalar[string](t, tx, `SELECT uuidv7()::text`)
			rs := dbtest.Scalar[string](t, tx, `INSERT INTO ruleset (owner_user_id, slug, title) VALUES ($1, $2, 'R') RETURNING id::text`, q.room.Owner, slug)
			var doc any
			if err := json.Unmarshal([]byte(manifest), &doc); err != nil {
				t.Fatal(err)
			}
			compiled, problems := engine.CompileRuleset(doc)
			if len(problems) > 0 {
				t.Fatal(problems)
			}
			body, _ := json.Marshal(compiled.Ruleset.Normalized)
			return dbtest.Scalar[string](t, tx, `INSERT INTO ruleset_version (ruleset_id, version, hash, manifest) VALUES ($1, '0.1.0', $2, $3) RETURNING id::text`,
				rs, slug, body)
		}
		q.refused(q.room.GM(), map[string]any{"type": "campaign.setRuleset", "rulesetVersionId": version(playFixture(t))}, "modeNotPlayed")
		q.send(q.room.GM(), map[string]any{"type": "campaign.setRuleset", "rulesetVersionId": version(modeFixture(t, "solo"))})
	})
}

func TestWithoutAGMNobodyHoldsAGMSeat(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		other := dbtest.User(t, tx, "P")
		p.room.Seat(t, tx, other)
		p.setMode(gm, "gmless")
		p.refused(gm, map[string]any{"type": "member.appoint", "userId": other, "role": "gm"}, "noGmSeats")
		p.refused(gm, map[string]any{"type": "member.appoint", "userId": other, "role": "cogm", "scopes": []any{"combat"}}, "noGmSeats")
		p.refused(gm, map[string]any{"type": "invite.create", "mode": "room", "role": "gm", "hours": 1.0}, "noGmSeats")
		// A player invite is fine, and the owner (a player seat now) makes it.
		p.send(gm, map[string]any{"type": "invite.create", "mode": "room", "role": "player", "hours": 1.0})
		// An offer to take the room over seats the new owner as a player.
		p.send(gm, map[string]any{"type": "campaign.transfer", "toUserId": other})
		newOwner := p.room.GM()
		newOwner.UserID, newOwner.Seat = &other, cs.Seat{Kind: cs.SeatMember, Role: "player"}
		p.send(newOwner, map[string]any{"type": "campaign.transferAccept"})
		if p.roleOf(other) != "player" {
			t.Fatalf("the new owner sits as %s", p.roleOf(other))
		}
	})
}

func TestASoloRoomSeatsOnePlayer(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		ctx := context.Background()
		p := anyModes(t, tx)
		gm := p.room.GM()
		invite := p.send(gm, map[string]any{"type": "invite.create", "mode": "room", "role": "player", "allowGuests": true, "hours": 12.0})
		join := map[string]any{"newCharacterName": "Ana", "asGuest": true}

		// Without a GM the room seats the owner and whoever else comes.
		p.setMode(gm, "gmless")
		if _, _, err := auth.AcceptInvite(ctx, tx, invite.Token, nil, join); err != nil {
			t.Fatalf("a second seat in a room without a GM: %v", err)
		}
		// Alone, the owner's seat is the one: a stranger's accept is refused, a guest's too.
		dbtest.Exec(t, tx, `UPDATE access_token SET revoked_at = now() WHERE campaign_id = $1`, p.room.ID)
		p.setMode(gm, "solo")
		_, _, err := auth.AcceptInvite(ctx, tx, invite.Token, nil, join)
		if r, _ := err.(*cs.Error); r == nil || r.Code != "soloOneSeat" {
			t.Fatalf("a second accept: want soloOneSeat, got %v", err)
		}
		user := &auth.User{UserID: dbtest.User(t, tx, "Stranger"), Name: "S"}
		_, _, err = auth.AcceptInvite(ctx, tx, invite.Token, user, map[string]any{"newCharacterName": "Bo"})
		if r, _ := err.(*cs.Error); r == nil || r.Code != "soloOneSeat" {
			t.Fatalf("a member's accept: want soloOneSeat, got %v", err)
		}
	})
}

func TestPlayersRunTheTableAndCallTestsForCharacters(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		ash, bo := p.character("Ash", 5), p.character("Bo", 2)
		npc := p.room.Actor(t, tx, "npc", "Warden", "character")
		dbtest.Exec(t, tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'level', 0, 2)`, npc)
		owner := p.room.GM()
		p.setMode(gm, "gmless")
		owner.Seat = cs.Seat{Kind: cs.SeatMember, Role: "player"} // the owner, a player seat now
		alice := p.room.Seat(t, tx, dbtest.User(t, tx, "Alice"), ash)
		ben := p.room.Seat(t, tx, dbtest.User(t, tx, "Ben"), bo)

		// Any seat starts the session and the fight.
		p.send(alice, map[string]any{"type": "session.start"})
		p.send(ben, map[string]any{"type": "encounter.start"})
		p.send(alice, map[string]any{"type": "encounter.add", "actorIds": []any{ash, bo}, "side": "party"})

		// Alice calls a Test for Ben's character: the target is shown to all.
		call := map[string]any{"type": "test.call", "testId": "check", "actorIds": []any{bo}, "inputs": map[string]any{"dc": 12.0}}
		p.refused(alice, map[string]any{"type": "test.call", "testId": "check", "actorIds": []any{bo},
			"inputs": map[string]any{"dc": 12.0}, "hideTarget": true}, "testTargetShown")
		p.refused(alice, map[string]any{"type": "test.call", "testId": "check", "actorIds": []any{npc},
			"inputs": map[string]any{"dc": 12.0}}, "testCharactersOnly")
		id := p.send(alice, call).ID
		if id == "" {
			t.Fatal("no call id")
		}
		for name, seat := range map[string]cs.Ctx{"the caller": alice, "the called": ben, "the owner": owner} {
			var seen bool
			for _, c := range p.seatView(seat).State.Tests {
				if c.ID == id {
					seen = true
					if !c.ShowTarget || c.Targets[0].Target == nil {
						t.Errorf("%s does not see the target: %+v", name, c)
					}
				}
			}
			if !seen {
				t.Errorf("%s does not see the call", name)
			}
		}
		// Only the called character's player reports; the permission to call is not the permission to report for another.
		p.refused(alice, map[string]any{"type": "test.report", "callId": id, "actorId": bo, "roll": map[string]any{"kind": "faces", "faces": []any{12.0}}}, "notYourCharacter")
		p.send(ben, map[string]any{"type": "test.report", "callId": id, "actorId": bo, "roll": map[string]any{"kind": "faces", "faces": []any{12.0}}})
		p.send(alice, map[string]any{"type": "test.close", "callId": id})
	})
}

func TestEveryStepIsOwnedAndOnlyTheOwnerUndoesAnyOfThem(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		ctx := context.Background()
		p := anyModes(t, tx)
		gm := p.room.GM()
		ash, bo := p.character("Ash", 5), p.character("Bo", 5)
		p.setMode(gm, "gmless")
		owner := gm
		owner.Seat = cs.Seat{Kind: cs.SeatMember, Role: "player"}
		alice := p.room.Seat(t, tx, dbtest.User(t, tx, "Alice"), ash)
		ben := p.room.Seat(t, tx, dbtest.User(t, tx, "Ben"), bo)
		p.send(alice, map[string]any{"type": "session.start"})

		// A step is logged under the seat that took it. Vigour is the GM's to change, so the step is taken as the table
		// would (a request's spend is: see below), under the seat's name.
		hit := func(as cs.Ctx, actor string, by float64) {
			t.Helper()
			c := as
			c.Seat = cs.Seat{Kind: cs.SeatAdmin}
			rc := dbtest.Must[*ruleset.Context](t)(ruleset.Open(ctx, tx, c))
			delta := engine.Delta{Target: engine.DeltaTarget{ActorID: actor, Resource: "hp"}, Kind: "add", Value: by}
			dbtest.Must[string](t)(rc.Apply(ctx, []engine.Delta{delta}))
		}
		hp := func(actor string) int32 {
			return dbtest.Scalar[int32](t, tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = 'hp'`, actor)
		}
		hit(alice, ash, -2)
		hit(ben, bo, -3)
		// The newest step is Ben's: Alice may not undo it, Ben may, and the owner may undo anyone's.
		p.refused(alice, map[string]any{"type": "event.undo"}, "undoOthers")
		if hp(bo) != 11 {
			t.Fatalf("Ben's step was undone: %d", hp(bo))
		}
		hit(alice, ash, -1)
		p.send(alice, map[string]any{"type": "event.undo"}) // Alice's own, the newest
		hit(ben, bo, -1)
		p.send(owner, map[string]any{"type": "event.undo"}) // the owner takes back Ben's step
		if hp(bo) != 11 {
			t.Fatalf("the owner's undo of Ben's step left %d", hp(bo))
		}
		p.refused(alice, map[string]any{"type": "event.undo"}, "undoOthers") // Ben's earlier step is the newest now
		// A guest has no user to match, so undoes nothing of the table's.
		guest := cs.Ctx{CampaignID: p.room.ID, Seat: cs.Seat{Kind: cs.SeatToken, Role: "player", CharacterIDs: []string{ash}}}
		p.refused(guest, map[string]any{"type": "event.undo"}, "undoOthers")
		// The spend of a request goes under the asker's name.
		p.send(ben, map[string]any{"type": "event.undo"})
		if hp(bo) != 14 {
			t.Fatalf("Ben undid his own step: %d", hp(bo))
		}
	})
}

func TestARequestAppliesAtOnceWithoutAGM(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		ash := p.character("Ash", 3)
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Alice"), ash)
		p.startSession()
		spend := map[string]any{"type": "request.send", "actorId": ash, "resourceId": "hp", "amount": 4.0}

		// With a GM it waits to be answered.
		id := p.send(player, spend).ID
		if status := dbtest.Scalar[string](t, tx, `SELECT status FROM spend_request WHERE id = $1`, id); status != "pending" {
			t.Fatalf("status %s", status)
		}
		if hp := dbtest.Scalar[int32](t, tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = 'hp'`, ash); hp != 10 {
			t.Fatalf("hp %d before the answer", hp)
		}
		p.send(gm, map[string]any{"type": "request.deny", "id": id})
		p.send(gm, map[string]any{"type": "session.end"})

		// Without one the spend applies at once, clamped and logged under the asker.
		p.setMode(gm, "gmless")
		p.send(player, map[string]any{"type": "session.start"})
		before := dbtest.Scalar[int](t, tx, `SELECT count(*) FROM spend_request WHERE campaign_id = $1`, p.room.ID)
		p.send(player, spend)
		if hp := dbtest.Scalar[int32](t, tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = 'hp'`, ash); hp != 6 {
			t.Fatalf("hp %d, want 6", hp)
		}
		p.send(player, map[string]any{"type": "request.send", "actorId": ash, "resourceId": "hp", "amount": 99.0})
		if hp := dbtest.Scalar[int32](t, tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = 'hp'`, ash); hp != 0 {
			t.Fatalf("hp %d, want it clamped at 0", hp)
		}
		if after := dbtest.Scalar[int](t, tx, `SELECT count(*) FROM spend_request WHERE campaign_id = $1`, p.room.ID); after != before {
			t.Fatalf("a request was queued: %d rows, was %d", after, before)
		}
		// Still checked as a request: another player's character is not theirs to spend from.
		bo := p.character("Bo", 3)
		p.refused(player, map[string]any{"type": "request.send", "actorId": bo, "resourceId": "hp", "amount": 1.0}, "notYourCharacter")
		by := dbtest.Scalar[string](t, tx, `SELECT seat_user_id FROM session_event WHERE campaign_id = $1 AND type = 'delta' ORDER BY created_at DESC LIMIT 1`, p.room.ID)
		if by != *player.UserID {
			t.Fatalf("the spend is logged under %s, not the asker", by)
		}
		p.send(player, map[string]any{"type": "event.undo"})
		if hp := dbtest.Scalar[int32](t, tx, `SELECT value FROM actor_resource WHERE actor_id = $1 AND resource_id = 'hp'`, ash); hp != 6 {
			t.Fatalf("hp %d after undo, want 6", hp)
		}
	})
}

func TestNothingIsGMOnlyWithoutAGM(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		p.setMode(gm, "gmless")
		alice := p.room.Seat(t, tx, dbtest.User(t, tx, "Alice"))
		entry := p.send(alice, map[string]any{"type": "codex.save", "kind": "npc", "title": "The Warden"}).ID
		if v := dbtest.Scalar[string](t, tx, `SELECT visibility FROM codex_entry WHERE id = $1`, entry); v != "party" {
			t.Fatalf("a new entry is %s, want party", v)
		}
		p.refused(alice, map[string]any{"type": "codex.reveal", "id": entry, "visibility": "gm", "audienceMode": "all"}, "noGmHere")
		p.send(alice, map[string]any{"type": "codex.reveal", "id": entry, "visibility": "public", "audienceMode": "all"})
		// The notes for the GM are nobody's to write.
		p.refused(alice, map[string]any{"type": "codex.save", "id": entry, "kind": "npc", "gmNotes": "x"}, "needSecretsScope")
		// A clock cannot be kept from the table either: the default `gm` is the party's.
		clock := p.send(alice, map[string]any{"type": "clock.create", "name": "Dread"}).ID
		if v := dbtest.Scalar[string](t, tx, `SELECT visibility FROM clock WHERE id = $1`, clock); v != "party" {
			t.Fatalf("a new clock is %s, want party", v)
		}
		p.send(alice, map[string]any{"type": "clock.update", "id": clock, "visibility": "gm"})
		if v := dbtest.Scalar[string](t, tx, `SELECT visibility FROM clock WHERE id = $1`, clock); v != "party" {
			t.Fatalf("a clock updated to gm is %s, want party", v)
		}
		// With a GM the entry is GM-only by default again.
		p.setMode(gm, "gm")
		hidden := p.send(gm, map[string]any{"type": "codex.save", "kind": "npc", "title": "Secret"}).ID
		if v := dbtest.Scalar[string](t, tx, `SELECT visibility FROM codex_entry WHERE id = $1`, hidden); v != "gm" {
			t.Fatalf("a new entry is %s, want gm", v)
		}
	})
}

func TestTheOwnerAttachesAPrivatePackToARoomTheyRunWithoutAGM(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		rulesetVersion := dbtest.Scalar[string](t, tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, p.room.ID)
		ruleset := dbtest.Scalar[string](t, tx, `SELECT ruleset_id::text FROM ruleset_version WHERE id = $1`, rulesetVersion)
		version := func(owner string) string {
			pack := dbtest.Scalar[string](t, tx, `INSERT INTO pack (owner_user_id, slug, ruleset_id, license) VALUES ($1, 'p', $2, 'private')
				RETURNING id::text`, owner, ruleset)
			return dbtest.Scalar[string](t, tx, `INSERT INTO pack_version (pack_id, version, hash, ruleset_version_id, ruleset_range, sources, entry_count, bytes)
				VALUES ($1, '1.0.0', 'h', $2, '^1', '[]', 0, 0) RETURNING id::text`, pack, rulesetVersion)
		}
		p.setMode(gm, "gmless")
		owner := gm
		owner.Seat = cs.Seat{Kind: cs.SeatMember, Role: "player"}
		p.send(owner, map[string]any{"type": "campaign.attachPack", "packVersionId": version(p.room.Owner)})
		// Another user's pack is not the owner's to attach, whatever they run.
		p.refused(owner, map[string]any{"type": "campaign.attachPack", "packVersionId": version(dbtest.User(t, tx, "Other"))}, "packNotFound")
		// A player who does not own the room attaches nothing.
		alice := p.room.Seat(t, tx, dbtest.User(t, tx, "Alice"))
		p.refused(alice, map[string]any{"type": "campaign.attachPack", "packVersionId": version(*alice.UserID)}, "noPermission")
	})
}

func TestAnOwnerWhoCreatesACharacterPlaysItWithoutAGM(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		p.setMode(gm, "solo")
		owner := gm
		owner.Seat = cs.Seat{Kind: cs.SeatMember, Role: "player"}
		id := p.send(owner, map[string]any{"type": "actor.create", "kind": "pc", "name": "Me", "entityType": "character"}).ID
		held := dbtest.Scalar[int](t, tx, `SELECT count(*) FROM membership_character mc JOIN membership m ON m.id = mc.membership_id
			WHERE m.campaign_id = $1 AND m.user_id = $2 AND mc.actor_id = $3`, p.room.ID, p.room.Owner, id)
		if held != 1 {
			t.Fatalf("the owner holds the character %d times", held)
		}
		// A player who is not the owner makes no character: the owner's seat does.
		alice := p.room.Seat(t, tx, dbtest.User(t, tx, "Alice"))
		p.refused(alice, map[string]any{"type": "actor.create", "kind": "pc", "name": "Her", "entityType": "character"}, "noPermission")
	})
}
