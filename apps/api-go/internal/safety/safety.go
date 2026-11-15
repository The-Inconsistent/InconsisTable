// Package safety holds Session Zero (docs/p2-plan.md group E, docs/design.md §1.4): a table's lines and veils, and the
// anonymous X-Card. A table tool, not a book rule, so there is no cite.
//
// Nothing here says who asked. A suggestion is appended to the list with no author, and the X-Card is not stored, not
// logged and not counted: the handler only checks that the card is on and names the mode, and the gateway tells the
// seats that hear it (table/gateway.go). The state version bump every action makes is the only trace.
package safety

import (
	"context"
	"encoding/json"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

func strings(v any) []string {
	items, _ := v.([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		s, _ := item.(string)
		out = append(out, s)
	}
	return out
}

// load reads the document under the campaign row the action's transaction already holds.
func load(ctx context.Context, tx core.Conn, campaignID string) (cs.Safety, error) {
	var s cs.Safety
	err := tx.QueryRow(ctx, `SELECT safety FROM campaign WHERE id = $1`, campaignID).Scan(&s)
	return s.Whole(), err
}

func save(ctx context.Context, tx core.Conn, campaignID string, s cs.Safety) error {
	doc, err := json.Marshal(s.Whole())
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE campaign SET safety = $2 WHERE id = $1`, campaignID, doc)
	return err
}

// Set is campaign.setSafety: the lists and the switch, whole.
func Set(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	xCard, _ := a["xCard"].(bool)
	return cs.Done(""), save(ctx, tx, c.CampaignID, cs.Safety{Lines: strings(a["lines"]), Veils: strings(a["veils"]), XCard: xCard})
}

// Suggest is safety.suggest: one more line or veil, from any player seat, with no author kept. A full list refuses.
func Suggest(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	s, err := load(ctx, tx, c.CampaignID)
	if err != nil {
		return cs.Result{}, err
	}
	list := &s.Lines
	if a.Str("kind") == "veil" {
		list = &s.Veils
	}
	if len(*list) >= cs.MaxSafetyItems {
		return cs.Result{}, cs.Fail("safetyListFull")
	}
	*list = append(*list, a.Str("text"))
	return cs.Done(""), save(ctx, tx, c.CampaignID, s)
}

// XCard is safety.xcard: refused when the table turned it off, otherwise it writes nothing. The result names the mode so
// the gateway knows who hears it.
func XCard(ctx context.Context, tx core.Conn, c cs.Ctx, _ cs.Action) (cs.Result, error) {
	s, err := load(ctx, tx, c.CampaignID)
	if err != nil {
		return cs.Result{}, err
	}
	if !s.XCard {
		return cs.Result{}, cs.Fail("xcardOff")
	}
	return cs.Result{OK: true, XCardMode: c.Mode()}, nil
}
