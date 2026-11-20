package eventlog

import (
	"context"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
)

// TurnStep is what TURN BACK takes back (house decision #82): the live logged actions of the running fight, newest
// first, back to and including the newest one that changed who acts or the round.
type TurnStep struct {
	// Actions are action ids, newest first; the last is the step itself.
	Actions []string
	// Kind is "turnStart" (someone began acting), "turnEnd" (whoever acted stopped) or "round" (only the round moved).
	Kind string
	// Holder is the actor the step names: who began acting, or whose turn ended; nil for a round.
	Holder *string
	// Round is the round the step happened in: the one it began, for a step that moved the round.
	Round int
}

// The turn keys that mark a step (internal/encounter/turn; that package sits above this one).
const (
	turnRound   = "round"
	turnCurrent = "currentId"
)

// LastTurnStep is the running fight's newest turn step in the running session's log, or nil when there is none: no fight
// is running, or nothing logged since it began (or since this session started) changed who acts or the round.
func LastTurnStep(ctx context.Context, conn core.Conn, campaignID, sessionID string) (*TurnStep, error) {
	rows, err := conn.Query(ctx, `SELECT e.action_id::text, e.payload, x.round FROM session_event e
		JOIN encounter x ON x.campaign_id = e.campaign_id AND x.active
		WHERE e.campaign_id = $1 AND e.session_id = $2 AND e.type = 'delta' AND e.undone_by IS NULL
		AND e.action_id IS NOT NULL AND e.created_at >= x.created_at
		ORDER BY e.created_at DESC, e.id DESC`, campaignID, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	step := &TurnStep{}
	// One action's writes are read together (they share the action's transaction), then judged as a whole.
	var actionID string
	var writes []Written
	for rows.Next() {
		var id string
		var payload []byte
		if err := rows.Scan(&id, &payload, &step.Round); err != nil {
			return nil, err
		}
		if id != actionID && actionID != "" {
			if step.judge(actionID, writes) {
				return step, nil
			}
			writes = nil
		}
		actionID = id
		w, err := Parse(payload)
		if err != nil {
			return nil, err
		}
		writes = append(writes, w)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if actionID != "" && step.judge(actionID, writes) {
		return step, nil
	}
	return nil, nil
}

// judge adds one action to the step and says whether it is the step itself: it changed who acts or the round.
func (s *TurnStep) judge(actionID string, writes []Written) bool {
	s.Actions = append(s.Actions, actionID)
	var current, round *Written
	for i := range writes {
		switch writes[i].Target.Turn {
		case turnCurrent:
			current = &writes[i]
		case turnRound:
			round = &writes[i]
		}
	}
	if round != nil {
		// Only a step moves the round, so a later action never did: the round now is the step's, unless it moved it.
		s.Round = int(number(round.After))
	}
	if current != nil {
		if after, acts := current.After.(string); acts {
			s.Kind, s.Holder = "turnStart", &after
			return true
		}
		if before, acted := current.Before.(string); acted {
			s.Kind, s.Holder = "turnEnd", &before
			return true
		}
	}
	if round != nil {
		s.Kind = "round"
		return true
	}
	return false
}
