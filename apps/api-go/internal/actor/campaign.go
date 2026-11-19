package actor

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// The values of the campaign fields a ruleset declares (house decision #58): one campaign_field row each, none until the
// value is set.

// CampaignRow is one campaign_field row.
type CampaignRow struct {
	FieldID string
	Int     *int32
	Text    *string
}

// LoadCampaignRows reads the room's campaign_field rows.
func LoadCampaignRows(ctx context.Context, conn core.Conn, campaignID string) ([]CampaignRow, error) {
	rows, err := conn.Query(ctx, `SELECT field_id, int_value, text_value FROM campaign_field WHERE campaign_id = $1`, campaignID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (CampaignRow, error) {
		var c CampaignRow
		return c, r.Scan(&c.FieldID, &c.Int, &c.Text)
	})
}

// Value is the row as the engine reads it for a field of this definition: a number, a word or a bool.
func (r CampaignRow) Value(def *engine.CampaignFieldDef) any {
	switch {
	case r.Text != nil:
		return *r.Text
	case r.Int == nil:
		return nil
	case def.Type == "bool":
		return *r.Int != 0
	}
	return float64(*r.Int)
}

// StoredCampaign is the room's stored values by field id; a row the ruleset no longer declares is left out.
func StoredCampaign(compiled *engine.CompiledRuleset, rows []CampaignRow) map[string]any {
	out := map[string]any{}
	for _, r := range rows {
		if def, ok := compiled.Ruleset.CampaignFields[r.FieldID]; ok {
			out[r.FieldID] = r.Value(&def)
		}
	}
	return out
}

// LoadCampaign is the campaign record in play: each declared field's stored value when it fits, else its default
// (engine.CampaignValues). Nil without a ruleset.
func LoadCampaign(ctx context.Context, conn core.Conn, campaignID string, compiled *engine.CompiledRuleset) (map[string]any, error) {
	if compiled == nil {
		return nil, nil
	}
	rows, err := LoadCampaignRows(ctx, conn, campaignID)
	if err != nil {
		return nil, err
	}
	return engine.CampaignValues(compiled, StoredCampaign(compiled, rows)), nil
}
