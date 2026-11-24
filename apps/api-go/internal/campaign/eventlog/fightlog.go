package eventlog

import (
	"context"
	"encoding/json"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// MaxFightLog is how many of the running fight's actions the GM's log shows, newest first.
const MaxFightLog = 40

// FightLog is the running fight's log for the GM's tracker (house decision #100): each logged action of the running
// session since the active encounter began, newest first, at most MaxFightLog, with the round it left and who it left
// acting (read from the turn writes as they come), whether Undo or TURN BACK took it back, the strike it was (when it
// was one) and its writes as logged. Nil with no session running or nothing logged in the fight.
func FightLog(ctx context.Context, conn core.Conn, campaignID string) ([]cs.FightLogLine, error) {
	sessionID, err := RunningSessionID(ctx, conn, campaignID)
	if err != nil || sessionID == nil {
		return nil, err
	}
	rows, err := conn.Query(ctx, `SELECT e.type, e.action_id::text, e.undone_by IS NOT NULL, e.payload FROM session_event e
		JOIN encounter x ON x.campaign_id = e.campaign_id AND x.active
		WHERE e.campaign_id = $1 AND e.session_id = $2 AND e.type IN ('delta', 'strike') AND e.action_id IS NOT NULL
		AND e.created_at >= x.created_at ORDER BY e.created_at, e.id`, campaignID, *sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	lines := []cs.FightLogLine{}
	at := map[string]int{}
	round, acting := 1, (*string)(nil)
	for rows.Next() {
		var kind, actionID string
		var undone bool
		var payload []byte
		if err := rows.Scan(&kind, &actionID, &undone, &payload); err != nil {
			return nil, err
		}
		i, seen := at[actionID]
		if !seen {
			i = len(lines)
			at[actionID] = i
			lines = append(lines, cs.FightLogLine{ID: actionID, Writes: []cs.FightLogWrite{}})
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
		switch w.Target["turn"] {
		case turnRound:
			if n, ok := w.After.(float64); ok && !undone {
				round = int(n)
			}
		case turnCurrent:
			if !undone {
				acting = nil
				if id, ok := w.After.(string); ok {
					acting = &id
				}
			}
		}
		line.Round, line.ActorID = round, acting
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := []cs.FightLogLine{}
	for i := len(lines) - 1; i >= 0 && len(out) < MaxFightLog; i-- {
		out = append(out, lines[i])
	}
	return out, nil
}
