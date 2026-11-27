package table

import (
	"context"
	"errors"
	"log"
	"maps"

	"github.com/zishang520/socket.io/servers/socket/v3"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// ReadHistory is the `session:history` request (house decision #133): the running session's actions as this seat may
// see them, read when HISTORY opens and while it stays open, never pushed with the state. A read: nothing is written.
// The seat needs Undo's permission, checked against the room's row as ApplyAction does.
func ReadHistory(ctx context.Context, conn core.Conn, seated cs.Ctx) ([]cs.HistoryLine, error) {
	loaded, err := LoadSnapshot(ctx, conn, seated.CampaignID)
	if err != nil {
		return nil, err
	}
	if loaded == nil {
		return nil, cs.Fail("gameNotFound")
	}
	c := seated
	c.CampaignOwnerID, c.TableMode = loaded.Snapshot.State.Campaign.OwnerUserID, loaded.Snapshot.State.Campaign.TableMode
	if refusal := cs.RequirePerm(c, cs.ActionPerms["event.undo"], ""); refusal != nil {
		return nil, refusal
	}
	var sessionID *string
	if s := loaded.Snapshot.State.Session; s != nil {
		sessionID = &s.ID
	}
	if loaded.Snapshot.State.History, err = eventlog.History(ctx, conn, c.CampaignID, sessionID); err != nil {
		return nil, err
	}
	lines := view.Of(loaded.Snapshot, loaded.Compiled, c).State.History
	if lines == nil {
		lines = []cs.HistoryLine{}
	}
	return lines, nil
}

// cutRefusal is an undo's refusal as the seat that sent it may read it (house decision #131): one about a value the
// seat does not see says only that something it does not see changed, never which value, which action or what it holds.
// Inside the action's transaction, which is rolled back after.
func cutRefusal(ctx context.Context, conn core.Conn, c cs.Ctx, err error) error {
	var refusal *cs.Error
	if !errors.As(err, &refusal) || refusal.Write == nil || view.SightOf(c).All {
		return err
	}
	switch refusal.Code {
	case "undoChanged", "undoGone", "undoLaterFirst", "redoLaterFirst", "turnBackRefused":
	default:
		return err
	}
	loaded, loadErr := LoadSnapshot(ctx, conn, c.CampaignID)
	if loadErr != nil || loaded == nil {
		return cs.Fail("changedUnseen")
	}
	if view.SeesWrite(loaded.Snapshot, loaded.Compiled, c, *refusal.Write) {
		return err
	}
	if refusal.Code == "turnBackRefused" {
		params := maps.Clone(refusal.Params)
		params["reason"] = cs.RefusalMessage("changedUnseen", nil)
		return cs.Fail("turnBackRefused", params)
	}
	return cs.Fail("changedUnseen")
}

func (g *Gateway) onHistory(s *socket.Socket, ack func(any)) {
	data := seatOf(s)
	if g.sessionEnded(s) || g.history == nil {
		ack(Refused("unauthorized", nil))
		return
	}
	if !g.allowRead.Allow(data.seatKey) {
		ack(Refused("tooManyActions", nil))
		return
	}
	lines, err := g.history(context.Background(), data.ctx)
	var refusal *cs.Error
	if errors.As(err, &refusal) {
		ack(Refused(refusal.Code, refusal.Params))
		return
	}
	if err != nil {
		log.Printf("table: session:history: %v", err)
		ack(Refused("serverError", nil))
		return
	}
	ack(map[string]any{"ok": true, "lines": lines})
}
