package table

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset"
)

// Campaign fields (house decision #58): the table's own values, stored per room and read by every expression. The
// manifests are our own invention.

// fieldFixture is the play fixture with three campaign fields, a character value and a Vigour ceiling that read one, and
// a shared pool whose ceiling reads it too.
func fieldFixture(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(playFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	m["campaignFields"] = map[string]any{
		"danger": map[string]any{"type": "int", "label": "Danger", "min": 1, "max": 5, "default": 2, "cite": "Fixture p.4"},
		"edge":   map[string]any{"type": "enum", "label": "Edge", "values": []any{"open", "closed"}, "default": "open", "cite": "Fixture p.4"},
		"dark":   map[string]any{"type": "bool", "label": "Dark", "default": false, "cite": "Fixture p.4"},
	}
	ent := m["entities"].([]any)[0].(map[string]any)
	ent["derived"] = append(ent["derived"].([]any), map[string]any{"id": "peril", "label": "Peril", "expr": "level + campaign.danger",
		"visibility": "party", "cite": "Fixture p.4"})
	for _, r := range m["resources"].([]any) {
		if r := r.(map[string]any); r["id"] == "hp" {
			r["max"] = "derived.maxHp + campaign.danger"
		}
	}
	m["resources"] = append(m["resources"].([]any), map[string]any{"id": "stash", "label": "Stash", "cite": "Fixture p.4", "scope": "party",
		"min": "0", "max": "campaign.danger * 2", "editableBy": "gm", "visibility": "party"})
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func setField(id string, value any) map[string]any {
	if n, ok := value.(int); ok {
		value = float64(n) // a socket payload's numbers are float64
	}
	return map[string]any{"type": "campaign.setField", "fieldId": id, "value": value}
}

func fieldsPlay(t *testing.T, tx pgx.Tx) *play {
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, fieldFixture(t))
	return &play{t, tx, room}
}

// peril, the hp ceiling and the stash ceiling as the api builds them now.
func (p *play) inPlay(actorID string) (peril float64, hpMax, stashMax float64) {
	p.t.Helper()
	rc := dbtest.Must[*ruleset.Context](p.t)(ruleset.Open(context.Background(), p.tx, p.room.GM()))
	b := rc.Built[actorID]
	return b.Derived["peril"], *b.Bounds["hp"].Max, *rc.Pools["stash"].Bounds.Max
}

func TestACampaignValueIsTheDefaultUntilSetAndEveryScopeFollowsIt(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := fieldsPlay(t, tx)
		id := p.character("Ash", 3)
		if peril, hp, stash := p.inPlay(id); peril != 5 || hp != 12 || stash != 4 {
			t.Fatalf("defaults: got peril %v, hp max %v, stash max %v", peril, hp, stash)
		}
		p.send(p.room.GM(), setField("danger", 4))
		if peril, hp, stash := p.inPlay(id); peril != 7 || hp != 14 || stash != 8 {
			t.Fatalf("danger 4: got peril %v, hp max %v, stash max %v", peril, hp, stash)
		}
	})
}

func TestSetFieldIsRefusedForWhatTheGameDoesNotHold(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		bare := &play{t, tx, dbtest.NewRoom(t, tx)}
		bare.refused(bare.room.GM(), setField("danger", 3), "pickRulesetFirst")

		p := fieldsPlay(t, tx)
		gm := p.room.GM()
		p.refused(gm, setField("nope", 3), "unknownCampaignField")
		p.refused(gm, setField("danger", 6), "campaignFieldValue")
		p.refused(gm, setField("danger", 0), "campaignFieldValue")
		p.refused(gm, setField("danger", "high"), "campaignFieldValue")
		p.refused(gm, setField("edge", "shut"), "campaignFieldValue")
		p.refused(gm, setField("edge", 1), "campaignFieldValue")
		p.refused(gm, setField("dark", 1), "campaignFieldValue")
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM campaign_field WHERE campaign_id = $1`, p.room.ID); n != 0 {
			t.Fatalf("a refused value was stored (%d rows)", n)
		}

		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Player"))
		p.refused(player, setField("danger", 3), "noPermission")
	})
}

func TestTheSameValueTwiceIsANoOpAndEachTypeIsStored(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := fieldsPlay(t, tx)
		gm := p.room.GM()
		p.startSession()
		p.send(gm, setField("danger", 2)) // the default
		p.send(gm, setField("danger", 3))
		p.send(gm, setField("danger", 3))
		p.send(gm, setField("edge", "closed"))
		p.send(gm, setField("dark", true))
		p.send(gm, setField("dark", false))
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM campaign_field WHERE campaign_id = $1`, p.room.ID); n != 3 {
			t.Fatalf("want 3 rows (danger, edge, dark), got %d", n)
		}
		if v := dbtest.Scalar[int](t, tx, `SELECT int_value FROM campaign_field WHERE campaign_id = $1 AND field_id = 'danger'`, p.room.ID); v != 3 {
			t.Fatalf("danger: %d", v)
		}
		if v := dbtest.Scalar[string](t, tx, `SELECT text_value FROM campaign_field WHERE campaign_id = $1 AND field_id = 'edge'`, p.room.ID); v != "closed" {
			t.Fatalf("edge: %s", v)
		}
		if v := dbtest.Scalar[int](t, tx, `SELECT int_value FROM campaign_field WHERE campaign_id = $1 AND field_id = 'dark'`, p.room.ID); v != 0 {
			t.Fatalf("dark: %d", v)
		}
		// danger 3, edge, dark true, dark false: four changes; the default and the repeat wrote nothing.
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM session_event WHERE campaign_id = $1 AND type = 'campaign.field'`, p.room.ID); n != 4 {
			t.Fatalf("want 4 logged changes, got %d", n)
		}
	})
}

func TestSetFieldWorksWithASessionAndAFightOpenAndLogsOneEvent(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := fieldsPlay(t, tx)
		gm := p.room.GM()
		id := p.character("Ash", 3)

		// No session: stored, not logged.
		p.send(gm, setField("danger", 3))
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM session_event WHERE campaign_id = $1`, p.room.ID); n != 0 {
			t.Fatalf("logged outside a session: %d", n)
		}

		p.startSession()
		p.send(gm, map[string]any{"type": "encounter.start"})
		p.send(gm, map[string]any{"type": "encounter.add", "actorIds": []any{id}, "side": "party", "visibility": "full"})
		p.send(gm, setField("danger", 5))
		if peril, _, _ := p.inPlay(id); peril != 8 {
			t.Fatalf("peril %v", peril)
		}
		var payload []byte
		row := tx.QueryRow(context.Background(), `SELECT payload FROM session_event WHERE campaign_id = $1 AND type = 'campaign.field'`, p.room.ID)
		if err := row.Scan(&payload); err != nil {
			t.Fatal(err)
		}
		var got map[string]any
		if err := json.Unmarshal(payload, &got); err != nil {
			t.Fatal(err)
		}
		if got["fieldId"] != "danger" || got["from"] != 3.0 || got["to"] != 5.0 {
			t.Fatalf("payload %v", got)
		}
		// Not undoable: the undo has nothing of it to take back.
		p.refused(gm, map[string]any{"type": "event.undo"}, "nothingToUndo")
		if peril, _, _ := p.inPlay(id); peril != 8 {
			t.Fatalf("undo moved the value: %v", peril)
		}
	})
}

func TestTheSnapshotCarriesTheCampaignFieldsInPlay(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		bare := &play{t, tx, dbtest.NewRoom(t, tx)}
		state := dbtest.Must[*Loaded](t)(LoadSnapshot(context.Background(), tx, bare.room.ID)).Snapshot.State
		if state.Campaign.Fields == nil || len(state.Campaign.Fields) != 0 {
			t.Fatalf("no ruleset: want {}, got %#v", state.Campaign.Fields)
		}
		body, _ := json.Marshal(state.Campaign)
		var wire map[string]any
		_ = json.Unmarshal(body, &wire)
		if f, ok := wire["fields"].(map[string]any); !ok || len(f) != 0 {
			t.Fatalf("wire: %s", body)
		}

		p := fieldsPlay(t, tx)
		want := func(fields map[string]any) {
			t.Helper()
			got := dbtest.Must[*Loaded](t)(LoadSnapshot(context.Background(), tx, p.room.ID)).Snapshot.State.Campaign.Fields
			a, _ := json.Marshal(got)
			b, _ := json.Marshal(fields)
			if string(a) != string(b) {
				t.Fatalf("want %s, got %s", b, a)
			}
		}
		want(map[string]any{"danger": 2, "edge": "open", "dark": false})
		p.send(p.room.GM(), setField("danger", 4))
		p.send(p.room.GM(), setField("dark", true))
		want(map[string]any{"danger": 4, "edge": "open", "dark": true})

		// Every seat gets it, the screen included.
		screen := p.room.GM()
		screen.Seat = cs.Seat{Kind: cs.SeatToken, Role: "screen", CharacterIDs: []string{}}
		for _, c := range []cs.Ctx{p.room.GM(), p.room.Seat(t, tx, dbtest.User(t, tx, "Pl")), screen} {
			if got := p.seatView(c).State.Campaign.Fields["danger"]; got != 4.0 {
				t.Fatalf("seat view danger: %v", got)
			}
		}
	})
}
