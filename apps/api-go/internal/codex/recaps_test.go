package codex

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

func TestRecapsAreEndedNonEmptyNewestFirstAndCapped(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		for n := 1; n <= maxRecaps+5; n++ {
			dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number, ended_at, recap, notes) VALUES ($1, $2, now(), $3, 'secret')`,
				room.ID, n, "recap")
		}
		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number, ended_at, recap) VALUES ($1, 100, now(), '  ')`, room.ID)
		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number, recap) VALUES ($1, 101, 'still running')`, room.ID)
		got, err := loadRecaps(context.Background(), tx, room.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != maxRecaps || got[0].Number != maxRecaps+5 || got[len(got)-1].Number != 6 {
			t.Fatalf("want %d recaps from %d down to 6, got %d from %d", maxRecaps, maxRecaps+5, len(got), got[0].Number)
		}
	})
}
