package campaign

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/codex"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// An archived room takes no spotlight.clear, so archiving takes the card down (house decision #139).
func TestArchiveTakesTheSpotlightDown(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		ctx, room := context.Background(), dbtest.NewRoom(t, tx)
		entry := dbtest.Must[cs.Result](t)(codex.Save(ctx, tx, room.GM(), cs.Action{"type": "codex.save", "kind": "npc", "title": "Keeper"})).ID
		dbtest.Must[cs.Result](t)(codex.ShowSpotlight(ctx, tx, room.GM(), cs.Action{"type": "spotlight.show", "entryId": entry, "audience": []any{}}))
		dbtest.Must[cs.Result](t)(Archive(ctx, tx, room.GM(), cs.Action{"type": "campaign.archive"}))
		if n := dbtest.Scalar[int64](t, tx, `SELECT count(*) FROM spotlight WHERE campaign_id = $1`, room.ID); n != 0 {
			t.Fatal("archived with the card still up")
		}
	})
}
