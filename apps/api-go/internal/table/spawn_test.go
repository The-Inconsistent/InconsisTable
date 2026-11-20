package table

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// actor.spawn's view, name and size (house decision #75).

// The play fixture with Vigour as its health track, so a combatant carries a bar and numbers.
func newHealthPlay(t *testing.T, tx pgx.Tx) *play {
	var m map[string]any
	if err := json.Unmarshal([]byte(playFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	m["health"] = map[string]any{"tracks": []any{map[string]any{"resource": "hp"}}, "states": []any{}, "cite": "Fixture p.9"}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, string(out))
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	return &play{t, tx, room}
}

// Spawned into a running fight at each view: a player receives nothing of a hidden one, a bar and no numbers of a bar
// one, the numbers of a full one; with no view said they arrive hidden, as before.
func TestSpawnJoinsARunningFightAtTheViewItSays(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newHealthPlay(t, tx)
		gm := p.room.GM()
		version := p.attachPack()
		ash := p.character("Ash", 2)
		p.send(gm, map[string]any{"type": "encounter.start"})
		spawn := func(name string, over map[string]any) {
			a := map[string]any{"type": "actor.spawn", "packVersionId": version, "key": "wolf", "count": 1.0, "name": name}
			for k, v := range over {
				a[k] = v
			}
			p.send(gm, a)
		}
		spawn("Lurker", nil)
		spawn("Shade", map[string]any{"visibility": "hidden"})
		spawn("Howler", map[string]any{"visibility": "bar"})
		spawn("Alpha", map[string]any{"visibility": "full"})

		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Pl"), ash)
		got := map[string]cs.Combatant{}
		for _, cb := range p.seatView(player).State.Encounter.Combatants {
			got[cb.Name] = cb
		}
		if len(got) != 2 {
			t.Fatalf("the player receives %d combatants, want the bar one and the full one: %+v", len(got), got)
		}
		if howler, ok := got["Howler 1"]; !ok || howler.Bar == nil || howler.HP != nil || howler.Visibility != "bar" {
			t.Fatalf("the bar creature arrives as %+v (present %v), want a bar and no numbers", howler, ok)
		}
		if alpha, ok := got["Alpha 1"]; !ok || alpha.HP == nil || alpha.Visibility != "full" {
			t.Fatalf("the full creature arrives as %+v (present %v), want its numbers", alpha, ok)
		}
		views := map[string]string{}
		for _, cb := range p.seatView(gm).State.Encounter.Combatants {
			views[cb.Name] = cb.Visibility
		}
		if views["Lurker 1"] != "hidden" || views["Shade 1"] != "hidden" {
			t.Fatalf("the hidden ones are %v", views)
		}
	})
}

// A name stands in for the entry's own and is numbered the same way, after the ones already at the table; with no fight
// the creatures are placed and join nothing.
func TestSpawnTakesANameAndPlacesUpToFifty(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newPlay(t, tx)
		gm := p.room.GM()
		version := p.attachPack()
		spawn := func(count int, over map[string]any) map[string]any {
			a := map[string]any{"type": "actor.spawn", "packVersionId": version, "key": "wolf", "count": float64(count)}
			for k, v := range over {
				a[k] = v
			}
			return a
		}
		named := func(prefix string) int {
			return dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM actor WHERE campaign_id = $1 AND name LIKE $2`,
				p.room.ID, prefix+" %")
		}
		p.send(gm, spawn(2, map[string]any{"name": " Grey Pack ", "visibility": "full"}))
		p.send(gm, spawn(1, map[string]any{"name": "Grey Pack"}))
		for _, name := range []string{"Grey Pack 1", "Grey Pack 2", "Grey Pack 3"} {
			if dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM actor WHERE campaign_id = $1 AND name = $2`, p.room.ID, name) != 1 {
				t.Fatalf("no %q", name)
			}
		}
		if named("wolf") != 0 {
			t.Fatalf("a named spawn took the entry's name")
		}
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM combatant c JOIN encounter e ON e.id = c.encounter_id
			WHERE e.campaign_id = $1`, p.room.ID); n != 0 {
			t.Fatalf("with no fight %d combatants were made", n)
		}

		p.send(gm, spawn(50, nil))
		if named("wolf") != 50 {
			t.Fatalf("50 wolves placed as %d", named("wolf"))
		}
		for _, bad := range []map[string]any{spawn(51, nil), spawn(1, map[string]any{"name": " "}),
			spawn(1, map[string]any{"visibility": "stats"})} {
			if _, issues := cs.ParseAction(bad); len(issues) == 0 {
				t.Fatalf("%v parses", bad)
			}
		}
	})
}
