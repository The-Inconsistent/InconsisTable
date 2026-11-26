package eventlog

import (
	"context"
	"encoding/json"
	"time"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// MaxHistory is how many of the running session's actions HISTORY lists, newest first.
//
// ponytail: the newest 100 in every snapshot, fine for a session's play; page it over its own event once a GM needs
// further back.
const MaxHistory = 100

// History is the running session's logged actions for HISTORY (house decision #133), newest first, at most MaxHistory:
// each action that wrote anything, when it was taken, whether it stands undone (Undo, TURN BACK, or an undo by line,
// until a redo), the strike it was and its writes as logged. Nil with no session running. What each seat receives of it
// is internal/view's call.
func History(ctx context.Context, conn core.Conn, campaignID string, sessionID *string) ([]cs.HistoryLine, error) {
	if sessionID == nil {
		return nil, nil
	}
	rows, err := conn.Query(ctx, `WITH a AS (SELECT action_id, min(created_at) AS at, min(id::text) AS first FROM session_event
			WHERE campaign_id = $1 AND session_id = $2 AND type = 'delta' AND action_id IS NOT NULL
			GROUP BY action_id ORDER BY at DESC, first DESC LIMIT $3)
		SELECT e.type, e.action_id::text, a.at, e.undone_by IS NOT NULL, e.payload FROM session_event e JOIN a USING (action_id)
		WHERE e.campaign_id = $1 AND e.type IN ('delta', 'strike') ORDER BY a.at DESC, a.first DESC, e.created_at, e.id`,
		campaignID, *sessionID, MaxHistory)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	lines := []cs.HistoryLine{}
	at := map[string]int{}
	for rows.Next() {
		var kind, actionID string
		var when time.Time
		var undone bool
		var payload []byte
		if err := rows.Scan(&kind, &actionID, &when, &undone, &payload); err != nil {
			return nil, err
		}
		i, seen := at[actionID]
		if !seen {
			i = len(lines)
			at[actionID] = i
			lines = append(lines, cs.HistoryLine{ID: actionID, At: core.ISOTime(when), Writes: []cs.FightLogWrite{}})
		}
		line := &lines[i]
		if kind == "strike" {
			var s cs.FightLogStrike
			if err := json.Unmarshal(payload, &s); err != nil {
				return nil, err
			}
			line.Strike = &s
			continue
		}
		var w cs.FightLogWrite
		if err := json.Unmarshal(payload, &w); err != nil {
			return nil, err
		}
		line.Undone = line.Undone || undone
		line.Writes = append(line.Writes, w)
	}
	return lines, rows.Err()
}
