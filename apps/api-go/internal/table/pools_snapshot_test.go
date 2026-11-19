package table

import (
	"context"
	"slices"
	"sort"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// A room's snapshot lists its pools in manifest order, with the stored value or the minimum, and a player's view of it
// lacks the hidden one (house decision #59).
func TestSnapshotListsPoolsAndASeatSeesOnlyItsOwn(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, poolFixture(t))
		p := &play{t, tx, room}
		p.character("Ash", 3)
		dbtest.Exec(t, tx, `INSERT INTO resource_pool (campaign_id, scope, resource_id, value) VALUES ($1, 'party', 'partyGm', 4)`, room.ID)
		state, compiled, drafts, err := LoadLive(context.Background(), tx, room.ID)
		if err != nil || state == nil {
			t.Fatalf("load: %v", err)
		}
		var want []string
		for _, r := range compiled.Ruleset.Resources {
			if r.Scope != "entity" {
				want = append(want, r.ID)
			}
		}
		got := map[string]float64{}
		var ids []string
		for _, pl := range state.Pools {
			ids = append(ids, pl.ID)
			got[pl.ID] = pl.Value
		}
		if !slices.Equal(ids, want) || sort.StringsAreSorted(ids) {
			t.Fatalf("pools in manifest order: want %v (not sorted), got %v", want, ids)
		}
		if got["partyGm"] != 4 || got["capped"] != 1 || got["partyOwner"] != 0 {
			t.Fatalf("a stored value, then the minimum: %v", got)
		}
		for _, pl := range state.Pools {
			if pl.ID == "capped" && (pl.Max == nil || *pl.Max != 5 || !pl.Capped || pl.Min != 1 || pl.Label != "capped") {
				t.Fatalf("capped is self-describing: %+v", pl)
			}
			if pl.ID == "free" && (pl.Max == nil || *pl.Max != 5 || pl.Capped) {
				t.Fatalf("free has a maximum it does not stop at: %+v", pl)
			}
		}
		snap := view.Snapshot{State: *state, Drafts: drafts}
		poolIDs := func(v view.SeatView) []string {
			var out []string
			for _, pl := range v.State.Pools {
				out = append(out, pl.ID)
			}
			return out
		}
		if gm := poolIDs(view.Of(snap, compiled, room.GM())); !slices.Contains(gm, "hidden") || len(gm) != len(want) {
			t.Fatalf("the GM receives every pool: %v", gm)
		}
		alice := room.Seat(t, tx, dbtest.User(t, tx, "Alice"))
		if pl := poolIDs(view.Of(snap, compiled, alice)); slices.Contains(pl, "hidden") || slices.Contains(pl, "stashGm") || len(pl) != len(want)-2 {
			t.Fatalf("a player never receives a gm pool: %v", pl)
		}
	})
}
