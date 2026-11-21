package actor

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// SheetLines are the lines of the actor's saved build an item may be fitted to (house decision #102): each weapon as
// `weapons/<name>`, and the armour worn as `armour/<name>`, in the sheet's order. Empty without a saved build.
func SheetLines(ctx context.Context, conn core.Conn, actorID string) ([]string, error) {
	var sheet []byte
	err := conn.QueryRow(ctx, `SELECT sheet::text FROM actor_build WHERE actor_id = $1 AND sheet IS NOT NULL`, actorID).Scan(&sheet)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return LinesOf(sheet), nil
}

// droppedFittings are the deltas that remove the actor's items fitted to a build line not in lines.
func droppedFittings(ctx context.Context, tx core.Conn, actorID string, lines []string) ([]engine.Delta, error) {
	if lines == nil {
		lines = []string{}
	}
	rows, err := tx.Query(ctx, `SELECT id::text FROM actor_item WHERE actor_id = $1 AND fitted_line IS NOT NULL
		AND NOT fitted_line = ANY($2) ORDER BY ordinal, id`, actorID, lines)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	out := make([]engine.Delta, len(ids))
	for i, id := range ids {
		out[i] = engine.Delta{Target: engine.DeltaTarget{Item: id}, Kind: "set", Value: nil}
	}
	return out, err
}

// LinesOf reads a saved sheet's lines (SheetLines): a weapon by its name, as the source app finds a host (its
// character.actions.ts 222, 668), and the one suit worn. A sheet that does not read gives none.
func LinesOf(sheet []byte) []string {
	var s struct {
		Weapons []struct {
			Name string `json:"name"`
		} `json:"weapons"`
		Armour *struct {
			Name string `json:"name"`
		} `json:"armour"`
	}
	if json.Unmarshal(sheet, &s) != nil {
		return nil
	}
	var out []string
	for _, w := range s.Weapons {
		if w.Name != "" && !slices.Contains(out, "weapons/"+w.Name) {
			out = append(out, "weapons/"+w.Name)
		}
	}
	if s.Armour != nil && s.Armour.Name != "" {
		out = append(out, "armour/"+s.Armour.Name)
	}
	return out
}
