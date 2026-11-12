package table

import (
	"context"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// mayServeBooks says whether the seat may announce a book source as served from its device. With a GM that is the GM
// side; without one the room's owner alone, so no other player's device is asked for pages that stand for the owner's
// book (docs/adr/0009-table-modes.md). The ctx carries the mode and owner of the campaign row, not the handshake.
func mayServeBooks(c cs.Ctx) bool {
	if c.HasGM() {
		return cs.CanInCampaign(c, "codex:write", "")
	}
	return c.Seat.Kind == cs.SeatMember && view.IsOwner(c)
}

// ponytail: reads the whole snapshot for the mode and the owner, once per book:serving; a campaign-row query when it shows.
func (g *Gateway) mayServeBooks(c cs.Ctx) bool {
	loaded, err := g.load(context.Background(), c.CampaignID)
	if err != nil || loaded == nil {
		return false
	}
	info := loaded.Snapshot.State.Campaign
	c.TableMode, c.CampaignOwnerID = info.TableMode, info.OwnerUserID
	return mayServeBooks(c)
}
