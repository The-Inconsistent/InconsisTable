// Package game holds ended games and their results (house decisions #38-#40). This phase ports the snapshot's read.
package game

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Load is the campaign's ended games, newest first, each with its rows in place order (a cooperative game's by name).
// Every seat is sent them all (house decision #40).
//
// ponytail: last 20 games only, paginate when a campaign keeps more.
func Load(ctx context.Context, conn core.Conn, campaignID string) ([]cs.Game, error) {
	rows, err := conn.Query(ctx, `SELECT encounter_id::text, max(created_at) FROM session_result WHERE campaign_id = $1
		GROUP BY encounter_id ORDER BY max(created_at) DESC LIMIT 20`, campaignID)
	if err != nil {
		return nil, err
	}
	type recent struct {
		encounterID string
		endedAt     time.Time
	}
	games, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (recent, error) {
		var g recent
		err := r.Scan(&g.encounterID, &g.endedAt)
		return g, err
	})
	if err != nil || len(games) == 0 {
		return []cs.Game{}, err
	}
	ids := make([]string, len(games))
	for i, g := range games {
		ids[i] = g.encounterID
	}
	rows, err = conn.Query(ctx, `SELECT id::text, encounter_id::text, actor_id::text, name, score, tiebreaks, place, outcome,
		ended_early FROM session_result WHERE campaign_id = $1 AND encounter_id = ANY($2::uuid[])
		ORDER BY place ASC NULLS LAST, name, id`, campaignID, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	byGame := map[string][]cs.GameResult{}
	endedEarly := map[string]bool{}
	coop := map[string]bool{}
	for rows.Next() {
		var encounterID string
		var early bool
		var r cs.GameResult
		if err := rows.Scan(&r.ResultID, &encounterID, &r.ActorID, &r.Name, &r.Score, &r.Tiebreaks, &r.Place, &r.Outcome, &early); err != nil {
			return nil, err
		}
		if r.Tiebreaks == nil {
			r.Tiebreaks = []int{}
		}
		if len(byGame[encounterID]) == 0 {
			endedEarly[encounterID], coop[encounterID] = early, r.Outcome != nil
		}
		byGame[encounterID] = append(byGame[encounterID], r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := []cs.Game{}
	for _, g := range games {
		mine := byGame[g.encounterID]
		if len(mine) == 0 {
			continue
		}
		mode := "compete"
		if coop[g.encounterID] {
			mode = "coop"
		}
		out = append(out, cs.Game{
			EncounterID: g.encounterID, EndedAt: core.ISOTime(g.endedAt), EndedEarly: endedEarly[g.encounterID],
			Mode: mode, Rows: mine,
		})
	}
	return out, nil
}
