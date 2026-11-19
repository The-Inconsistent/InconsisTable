// Package eventlog is the session log (docs/design.md §5.4): one `delta` row per write, which is what undo reads back
// (apps/api/src/campaign/event.log.ts and event.undo.ts). It sits below the campaign package, not in it: the delta
// pipeline writes the log, and the campaign actions call the pipeline, so a shared package would be an import cycle.
//
// Values are decoded JSON throughout (float64, string, bool, []any, map[string]any, nil): what the log stores is what
// undo compares, so a condition row is the map {conditionId, stacks, source, expiresOn, expiresAfter}.
package eventlog

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Written is what a write did: the value before (nil when the row was new) and after (nil when it was removed).
type Written struct {
	Target engine.DeltaTarget `json:"target"`
	Kind   string             `json:"kind"`
	Before any                `json:"before"`
	After  any                `json:"after"`
}

// RunningSessionID is the session being played, or nil between sessions (nothing logged then can be undone).
func RunningSessionID(ctx context.Context, conn core.Conn, campaignID string) (*string, error) {
	var id string
	err := conn.QueryRow(ctx, `SELECT id::text FROM session WHERE campaign_id = $1 AND ended_at IS NULL`, campaignID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// SameValue says whether two stored values are the same, whatever order an object's keys came in.
func SameValue(a, b any) bool { return engine.CanonicalJSON(a) == engine.CanonicalJSON(b) }

// Record logs what an action wrote under actionID and says whether it wrote anything. A write that changed nothing
// leaves no row.
func Record(ctx context.Context, tx core.Conn, c cs.Ctx, actionID string, written []Written) (bool, error) {
	changed := []Written{}
	for _, w := range written {
		if !SameValue(w.Before, w.After) {
			changed = append(changed, w)
		}
	}
	if len(changed) == 0 {
		return false, nil
	}
	sessionID, err := RunningSessionID(ctx, tx, c.CampaignID)
	if err != nil {
		return false, err
	}
	for _, w := range changed {
		payload, err := json.Marshal(w)
		if err != nil {
			return false, err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO session_event (campaign_id, session_id, type, action_id, seat_user_id, payload)
			VALUES ($1, $2, 'delta', $3, $4, $5)`, c.CampaignID, sessionID, actionID, c.UserID, payload); err != nil {
			return false, err
		}
	}
	return true, nil
}

// Parse reads a logged delta back. The payload is a JSONB document read whole.
func Parse(payload []byte) (Written, error) {
	var w Written
	err := json.Unmarshal(payload, &w)
	return w, err
}

// DescribeTarget is a target in words, for a refusal the GM reads.
func DescribeTarget(t engine.DeltaTarget) string {
	switch {
	case t.Clock != "":
		return "that clock"
	case t.Resource != "":
		return `resource "` + t.Resource + `"`
	case t.Pool != "":
		return `pool "` + t.Pool + `"`
	case t.Field != "":
		return `field "` + t.Field + `"`
	case t.Condition != "":
		return `condition "` + t.Condition + `"`
	case t.Turn != "":
		return `turn "` + t.Turn + `"`
	}
	return `test "` + t.Test + `"`
}

// Text is a value as JSON.stringify writes it: a condition row keeps its fields' order, the rest are canonical.
func Text(v any) string {
	row, isRow := v.(map[string]any)
	if !isRow {
		return engine.CanonicalJSON(v)
	}
	parts := []string{}
	for _, k := range []string{"conditionId", "stacks", "source", "expiresOn", "expiresAfter"} {
		if x, ok := row[k]; ok {
			parts = append(parts, engine.CanonicalJSON(k)+":"+engine.CanonicalJSON(x))
		}
	}
	return "{" + strings.Join(parts, ",") + "}"
}

func number(v any) float64 {
	n, _ := v.(float64)
	return n
}

// Turns or rounds a condition row has left; an uncounted row reads as 1 (house decision #14). ok is false for no row.
func left(v any) (float64, bool) {
	row, isRow := v.(map[string]any)
	if !isRow {
		return 0, false
	}
	if n, counted := row["expiresAfter"].(float64); counted {
		return n, true
	}
	return 1, true
}

// Invert is the delta that takes a logged one back (nil when there is nothing to put back), or why it can't
// (docs/design.md §5.4). current is the value now; a resource's is not needed.
//   - A resource is counted, so the inverse is the change that was made (before − after), never a set to before: a delta
//     written since keeps its effect. The server clamps it like any other.
//   - Anything else (field, condition, turn) is set. It is undone only while it still holds what the step left (after);
//     once a later step changed it, undoing this one would silently overwrite that step.
func Invert(logged Written, current any) (*engine.Delta, *cs.Error) {
	t := logged.Target
	if t.Resource != "" || t.Pool != "" || t.Clock != "" {
		change := number(logged.Before) - number(logged.After)
		if change == 0 {
			return nil, nil
		}
		return &engine.Delta{Target: t, Kind: "add", Value: change}, nil
	}
	// A condition's count is counted too: a tick down is undone by the tick back, whatever else happened to the row.
	if t.Condition != "" && logged.Kind == "add" {
		was, hadRow := left(logged.Before)
		now, hasRow := left(logged.After)
		if !hadRow || !hasRow {
			return nil, cs.Fail("undoGone", cs.Params{"target": DescribeTarget(t)})
		}
		if was == now {
			return nil, nil
		}
		return &engine.Delta{Target: t, Kind: "add", Value: was - now}, nil
	}
	if !SameValue(current, logged.After) {
		return nil, cs.Fail("undoChanged", cs.Params{"target": DescribeTarget(t), "now": Text(current), "left": Text(logged.After)})
	}
	return &engine.Delta{Target: t, Kind: "set", Value: logged.Before}, nil
}

// IsWhole says whether a value is a JavaScript safe integer.
func IsWhole(v any) bool {
	n, isNumber := v.(float64)
	return isNumber && n == math.Trunc(n) && math.Abs(n) <= 9007199254740991
}

// LogEvent writes an event of its own kind (not a delta, so Undo never takes it back) into the running session's log.
// It is what the recap draft reads (internal/recap); a write outside a session is not logged.
func LogEvent(ctx context.Context, tx core.Conn, c cs.Ctx, kind string, payload map[string]any) error {
	sessionID, err := RunningSessionID(ctx, tx, c.CampaignID)
	if err != nil || sessionID == nil {
		return err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO session_event (campaign_id, session_id, type, seat_user_id, payload) VALUES ($1, $2, $3, $4, $5)`,
		c.CampaignID, *sessionID, kind, c.UserID, body)
	return err
}
