package table

import (
	"context"
	"encoding/json"
	"errors"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/zishang520/socket.io/servers/socket/v3"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/recap"
)

// DraftRecap is the `session:draftRecap` request: a plain-text draft of the running session for the GM to edit
// (house decision #45). A read, not an action: nothing is written and nothing is broadcast. The seat is checked against
// the room's row, as ApplyAction does, not the handshake.
func DraftRecap(ctx context.Context, conn core.Conn, seated cs.Ctx) (string, error) {
	c := seated
	err := conn.QueryRow(ctx, `SELECT owner_user_id, table_mode FROM campaign WHERE id = $1`, c.CampaignID).Scan(&c.CampaignOwnerID, &c.TableMode)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", cs.Fail("gameNotFound")
	}
	if err != nil {
		return "", err
	}
	if refusal := cs.RequirePerm(c, "session:run", ""); refusal != nil {
		return "", refusal
	}
	loaded, err := LoadSnapshot(ctx, conn, c.CampaignID)
	if err != nil {
		return "", err
	}
	if loaded == nil || loaded.Snapshot.State.Session == nil {
		return "", cs.Fail("startSessionFirst")
	}
	rows, err := conn.Query(ctx, `SELECT type, payload, undone_by IS NOT NULL FROM session_event
		WHERE campaign_id = $1 AND session_id = $2 ORDER BY created_at, id`, c.CampaignID, loaded.Snapshot.State.Session.ID)
	if err != nil {
		return "", err
	}
	events, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (recap.Event, error) {
		var e recap.Event
		var payload []byte
		if err := r.Scan(&e.Type, &payload, &e.Undone); err != nil {
			return e, err
		}
		return e, json.Unmarshal(payload, &e.Payload)
	})
	if err != nil {
		return "", err
	}
	in := recap.Input{
		Events: events,
		Clocks: loaded.Snapshot.State.Clocks,
		ActorName: func(id string) (string, bool) {
			for _, a := range loaded.Snapshot.State.Actors {
				if a.ID == id && (a.Kind == "pc" || a.Kind == "companion") {
					return a.Name, true
				}
			}
			return "", false
		},
		ResourceLabel: func(id string) (string, bool) {
			if loaded.Compiled == nil {
				return "", false
			}
			for _, r := range loaded.Compiled.Ruleset.Resources {
				if r.ID == id && r.Visibility == "party" {
					return r.Label, true
				}
			}
			return "", false
		},
		OutcomeLabel: func(testID, outcome string) string {
			if loaded.Compiled != nil {
				for _, o := range loaded.Compiled.Ruleset.Tests[testID].Outcomes {
					if o.ID == outcome {
						return o.Label
					}
				}
			}
			return outcome
		},
		EntryTitle: func(id string) (string, bool) {
			for _, e := range loaded.Snapshot.Codex.Entries {
				if e.ID == id {
					return e.Title, e.Visibility != "gm" && e.AudienceMode == "all"
				}
			}
			return "", false
		},
	}
	return recap.Draft(in), nil
}

func (g *Gateway) onDraftRecap(s *socket.Socket, ack func(any)) {
	data := seatOf(s)
	if g.sessionEnded(s) || g.draftRecap == nil {
		ack(Refused("unauthorized", nil))
		return
	}
	if !g.allowAction.Allow(data.seatKey) {
		ack(Refused("tooManyActions", nil))
		return
	}
	text, err := g.draftRecap(context.Background(), data.ctx)
	var refusal *cs.Error
	if errors.As(err, &refusal) {
		ack(Refused(refusal.Code, refusal.Params))
		return
	}
	if err != nil {
		log.Printf("table: session:draftRecap: %v", err)
		ack(Refused("serverError", nil))
		return
	}
	ack(map[string]any{"ok": true, "text": text})
}
