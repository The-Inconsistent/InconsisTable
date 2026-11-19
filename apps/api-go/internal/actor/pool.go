package actor

import (
	"context"
	"errors"
	"sort"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Shared pools (house decisions #54 and #56): resources of scope party, gm or campaign, one resource_pool row each.

// PoolRow is one resource_pool row.
type PoolRow struct {
	ResourceID string
	Value      int32
}

// Pool is a declared pool as the table holds it now.
type Pool struct {
	ID, Scope string
	Bounds    Bounds
	// State is what the ops read: the value (the minimum when the pool has no row), the bounds and the resets.
	State engine.ResourceState
}

// LoadPools reads the room's pool rows.
func LoadPools(ctx context.Context, conn core.Conn, campaignID string) ([]PoolRow, error) {
	rows, err := conn.Query(ctx, `SELECT resource_id, value FROM resource_pool WHERE campaign_id = $1`, campaignID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PoolRow, error) {
		var p PoolRow
		return p, r.Scan(&p.ResourceID, &p.Value)
	})
}

// PoolScope is the scope a pool's bounds are evaluated in: `party.characters` and the campaign record (nil leaves
// `campaign` out).
func PoolScope(characters float64, campaign map[string]any) *engine.Record {
	scope := &engine.Record{Fields: map[string]any{"party": &engine.Record{Fields: map[string]any{"characters": characters}}}}
	if campaign != nil {
		scope.Fields["campaign"] = &engine.Record{Fields: campaign}
	}
	return scope
}

// BuildPool is one declared pool with its bounds and resets, or false when the resource is not a pool or a bound
// cannot be evaluated. value is the stored one, nil with no row (then the minimum).
func BuildPool(compiled *engine.CompiledRuleset, id string, value *int32, characters float64, campaign map[string]any) (Pool, bool, error) {
	cr, declared := compiled.Resources[id]
	if !declared || cr.Def.Scope == "entity" {
		return Pool{}, false, nil
	}
	scope := PoolScope(characters, campaign)
	var exprErr engine.ExprError
	bounds, err := compiled.ResourceBounds(id, scope)
	if errors.As(err, &exprErr) {
		return Pool{}, false, nil
	}
	if err != nil {
		return Pool{}, false, err
	}
	reset, err := compiled.ResetValues(id, scope)
	if errors.As(err, &exprErr) {
		return Pool{}, false, nil
	}
	if err != nil {
		return Pool{}, false, err
	}
	held := Bounds{bounds.Min, bounds.Max, !bounds.Capped}
	now := bounds.Min
	if value != nil {
		now = float64(*value)
	}
	return Pool{ID: id, Scope: cr.Def.Scope, Bounds: held, State: engine.ResourceState{
		Value: now, Min: bounds.Min, Max: held.Ceiling(), Reset: reset,
	}}, true, nil
}

// BuildPools is every pool the manifest declares, sorted by id, with the rows' values (the minimum without a row).
func BuildPools(compiled *engine.CompiledRuleset, rows []PoolRow, characters float64, campaign map[string]any) ([]Pool, error) {
	stored := map[string]int32{}
	for _, r := range rows {
		stored[r.ResourceID] = r.Value
	}
	ids := make([]string, 0, len(compiled.Resources))
	for id := range compiled.Resources {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := []Pool{}
	for _, id := range ids {
		var value *int32
		if v, has := stored[id]; has {
			value = &v
		}
		pool, ok, err := BuildPool(compiled, id, value, characters, campaign)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, pool)
		}
	}
	return out, nil
}
