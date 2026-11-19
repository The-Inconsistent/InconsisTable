package table

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// poolFixture is the mode fixture with shared pools of our own invention: one per editableBy of a party pool, a gm
// and a campaign pool, a pool only the GM sees, two that clamp, and four that refill on an event.
func poolFixture(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(modeFixture(t, "gm", "gmless", "solo")), &m); err != nil {
		t.Fatal(err)
	}
	pool := func(id, scope, editableBy, visibility string, extra map[string]any) map[string]any {
		r := map[string]any{"id": id, "label": id, "cite": "Fixture p.7", "scope": scope, "min": "0", "max": "10",
			"editableBy": editableBy, "visibility": visibility}
		for k, v := range extra {
			r[k] = v
		}
		return r
	}
	refill := func(event, to string) map[string]any {
		return map[string]any{"resetOn": []any{map[string]any{"event": event, "to": to}}}
	}
	m["resources"] = append(m["resources"].([]any),
		pool("partyGm", "party", "gm", "party", nil),
		pool("partyOwner", "party", "owner", "party", nil),
		pool("partySpend", "party", "ownerSpendOnly", "party", nil),
		pool("gmOwn", "gm", "owner", "party", nil),
		pool("campOwn", "campaign", "owner", "party", nil),
		pool("hidden", "party", "owner", "gm", nil),
		pool("capped", "party", "gm", "party", map[string]any{"min": "1", "max": "5"}),
		pool("free", "party", "gm", "party", map[string]any{"max": "5", "capped": false}),
		pool("stashSession", "party", "gm", "party", refill("sessionStart", "party.characters")),
		pool("stashGm", "gm", "gm", "gm", refill("sessionStart", "2")),
		pool("stashFight", "party", "gm", "party", refill("encounterEnd", "1")),
		pool("stashRest", "party", "gm", "party", refill("longRest", "4")),
	)
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func poolValue(p *play, id string) (int, bool) {
	rows := dbtest.Scalar[int](p.t, p.tx, `SELECT count(*) FROM resource_pool WHERE campaign_id = $1 AND resource_id = $2`, p.room.ID, id)
	if rows == 0 {
		return 0, false
	}
	return dbtest.Scalar[int](p.t, p.tx, `SELECT value FROM resource_pool WHERE campaign_id = $1 AND resource_id = $2`, p.room.ID, id), true
}

func adjustPool(pool string, delta float64) map[string]any {
	return map[string]any{"type": "rule.op", "primitive": "resource.capped", "op": "adjustPool",
		"input": map[string]any{"resource": pool, "delta": delta}}
}

func wantPool(t *testing.T, p *play, id string, want int) {
	t.Helper()
	if got, _ := poolValue(p, id); got != want {
		t.Fatalf("pool %s: want %d, got %d", id, want, got)
	}
}

func TestAPoolStartsFromItsMinimumAndClamps(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, poolFixture(t))
		p := &play{t, tx, room}
		gm := room.GM()
		p.character("Ash", 3)
		p.startSession()

		if _, has := poolValue(p, "capped"); has {
			t.Fatal("a pool has no row before its first change")
		}
		p.send(gm, adjustPool("capped", 2)) // from the minimum 1
		wantPool(t, p, "capped", 3)
		p.send(gm, adjustPool("capped", 1))
		wantPool(t, p, "capped", 4)
		p.send(gm, adjustPool("capped", 9))
		wantPool(t, p, "capped", 5)
		p.send(gm, adjustPool("capped", -9))
		wantPool(t, p, "capped", 1)

		p.send(gm, adjustPool("free", 9))
		wantPool(t, p, "free", 9)
		p.send(gm, adjustPool("free", -20))
		wantPool(t, p, "free", 0)

		// A first adjust that clamps at the minimum still makes the row.
		p.send(gm, adjustPool("partyGm", -3))
		wantPool(t, p, "partyGm", 0)
	})
}

func TestTwoPoolWritesInOneTransactionAdd(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, poolFixture(t))
		p := &play{t, tx, room}
		max := 10.0
		w := actor.Write{CampaignID: room.ID, PoolScope: "party", Bounds: &actor.Bounds{Min: 0, Max: &max}}
		for _, by := range []float64{2, 3} {
			w.Delta = engine.Delta{Target: engine.DeltaTarget{Pool: "partyGm"}, Kind: "add", Value: by}
			if _, err := actor.WriteDelta(context.Background(), tx, w); err != nil {
				t.Fatal(err)
			}
		}
		wantPool(t, p, "partyGm", 5)
	})
}
