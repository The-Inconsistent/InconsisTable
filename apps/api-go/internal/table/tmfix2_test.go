package table

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// modeFixtureWithOwnerField is the mode fixture plus a field only its owner sees, and a Test whose modifier reads it.
func modeFixtureWithOwnerField(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(modeFixture(t, "gm", "gmless", "solo")), &m); err != nil {
		t.Fatal(err)
	}
	fields := m["entities"].([]any)[0].(map[string]any)["fields"].(map[string]any)
	fields["secret"] = map[string]any{"type": "int", "label": "Secret", "min": 0, "max": 9, "visibility": "owner"}
	m["tests"].(map[string]any)["peek"] = map[string]any{"kind": "sumVsTarget", "dice": "1d20", "modifier": "secret",
		"target": "ctx.dc", "inputs": map[string]any{"dc": "int"}, "cite": "Fixture p.5"}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// Without a GM every seat gets the Test numbers, so a number read from a field only its owner sees is refused at the
// call; one called while a GM sat there is never told to a seat that does not hold the character.
func TestWithoutAGMATestUsesOnlyWhatTheWholeTableSees(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, modeFixtureWithOwnerField(t))
		p := &play{t, tx, room}
		gm := room.GM()
		ash, bo := p.character("Ash", 5), p.character("Bo", 2)
		dbtest.Exec(t, tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, int_value) VALUES ($1, 'secret', 0, 7)`, bo)
		alice := room.Seat(t, tx, dbtest.User(t, tx, "Alice"), ash)
		ben := room.Seat(t, tx, dbtest.User(t, tx, "Ben"), bo)
		peek := map[string]any{"type": "test.call", "testId": "peek", "actorIds": []any{bo}, "inputs": map[string]any{"dc": 12.0}}
		seen := func(c cs.Ctx, id string) *cs.TestTargetState {
			for _, call := range p.seatView(c).State.Tests {
				if call.ID == id && len(call.Targets) > 0 {
					return &call.Targets[0]
				}
			}
			return nil
		}

		// With a GM the character's own player sees the modifier; another player is not told the call at all.
		p.startSession()
		id := p.send(gm, peek).ID
		if m := seen(ben, id); m == nil || m.Modifier == nil {
			t.Fatalf("the holder does not see the modifier: %+v", m)
		}
		if seen(alice, id) != nil {
			t.Fatal("a player who does not hold the character sees the call")
		}

		// A call still open when the table sits without a GM: the view keeps the number from every seat.
		p.send(gm, map[string]any{"type": "session.end"})
		p.setMode(gm, "gmless")
		for name, c := range map[string]cs.Ctx{"a non-holder": alice, "the holder": ben} {
			if s := seen(c, id); s != nil && s.Modifier != nil {
				t.Errorf("%s is told the owner field modifier: %+v", name, s)
			}
		}

		// And a new call of it is refused, while one that reads what the table sees is not.
		owner := gm
		owner.Seat = cs.Seat{Kind: cs.SeatMember, Role: "player"}
		p.send(owner, map[string]any{"type": "session.start"})
		p.refused(alice, peek, "testTableOnly")
		p.send(alice, map[string]any{"type": "test.call", "testId": "check", "actorIds": []any{bo}, "inputs": map[string]any{"dc": 12.0}})
	})
}

func TestAFirstReportStandsForPlayersWithoutAGM(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		bo, cy := p.character("Bo", 2), p.character("Cy", 2)
		dbtest.Exec(t, tx, `INSERT INTO membership_character (membership_id, actor_id) SELECT id, $2 FROM membership WHERE campaign_id = $1 AND user_id = $3`,
			p.room.ID, cy, p.room.Owner)
		ben := p.room.Seat(t, tx, dbtest.User(t, tx, "Ben"), bo)
		p.setMode(gm, "gmless")
		owner := gm
		owner.Seat = cs.Seat{Kind: cs.SeatMember, Role: "player", CharacterIDs: []string{cy}}
		p.send(owner, map[string]any{"type": "session.start"})
		id := p.send(ben, map[string]any{"type": "test.call", "testId": "gambit", "actorIds": []any{bo, cy}}).ID
		report := func(actor, outcome string) map[string]any {
			return map[string]any{"type": "test.report", "callId": id, "actorId": actor, "outcome": outcome}
		}
		p.send(ben, report(bo, "missed"))
		p.refused(ben, report(bo, "clean"), "alreadyReported")
		// The owner corrects a mistake of their own, as the GM side would.
		p.send(owner, report(cy, "missed"))
		p.send(owner, report(cy, "clean"))
	})
}

func TestASoloRoomIssuesNoGuestToken(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		ash := p.character("Ash", 1)
		issue := map[string]any{"type": "token.issue", "actorId": ash}
		p.send(gm, issue) // with a GM
		p.setMode(gm, "gmless")
		p.send(gm, issue) // and without one
		dbtest.Exec(t, tx, `UPDATE access_token SET revoked_at = now() WHERE campaign_id = $1`, p.room.ID)
		p.setMode(gm, "solo")
		p.refused(gm, issue, "soloOneSeat")
	})
}
