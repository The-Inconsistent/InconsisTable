package campaign

import (
	"context"
	"fmt"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

// SetField is campaign.setField (house decision #58): the table's value for a campaign field the pinned ruleset
// declares. Allowed at any time, with or without a session or a fight; logged as an event while a session runs, and
// never undone. Setting the value in play again changes nothing.
func SetField(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid, id := c.CampaignID, a.Str("fieldId")
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if rules == nil {
		return cs.Result{}, cs.Fail("pickRulesetFirst")
	}
	def, declared := rules.Ruleset.CampaignFields[id]
	if !declared {
		return cs.Result{}, cs.Fail("unknownCampaignField")
	}
	value := a["value"]
	if bad := engine.CheckCampaignValue(&def, value); bad != "" {
		return cs.Result{}, cs.Fail("campaignFieldValue", cs.Params{"detail": bad})
	}
	before, err := actor.LoadCampaign(ctx, tx, cid, rules)
	if err != nil {
		return cs.Result{}, err
	}
	if before[id] == value {
		return cs.Done(""), nil
	}
	var asInt *int32
	var asText *string
	switch v := value.(type) {
	case string:
		asText = &v
	case bool:
		n := int32(0)
		if v {
			n = 1
		}
		asInt = &n
	case float64:
		n := int32(v)
		asInt = &n
	}
	if _, err := tx.Exec(ctx, `INSERT INTO campaign_field (campaign_id, field_id, int_value, text_value) VALUES ($1, $2, $3, $4)
		ON CONFLICT (campaign_id, field_id) DO UPDATE SET int_value = EXCLUDED.int_value, text_value = EXCLUDED.text_value`,
		cid, id, asInt, asText); err != nil {
		return cs.Result{}, err
	}
	return cs.Done(""), eventlog.LogEvent(ctx, tx, c, "campaign.field", map[string]any{"fieldId": id, "from": before[id], "to": value})
}

// fieldProblem says why a stored campaign value cannot move from the old version to the next, or returns "".
func fieldProblem(old, next *engine.CompiledRuleset, r actor.CampaignRow) string {
	n, ok := next.Ruleset.CampaignFields[r.FieldID]
	if !ok {
		return fmt.Sprintf(`campaign field "%s" is gone`, r.FieldID)
	}
	if o, was := old.Ruleset.CampaignFields[r.FieldID]; was && o.Type != n.Type {
		return fmt.Sprintf(`campaign field "%s" changed type`, r.FieldID)
	}
	if bad := engine.CheckCampaignValue(&n, r.Value(&n)); bad != "" {
		return fmt.Sprintf(`campaign field "%s": %s`, r.FieldID, bad)
	}
	return ""
}

// dropCampaignFields deletes the room's campaign values the next version does not declare or that do not fit it, for a
// room with no built character that moves to that version.
func dropCampaignFields(ctx context.Context, tx core.Conn, cid string, old, next *engine.CompiledRuleset) error {
	rows, err := actor.LoadCampaignRows(ctx, tx, cid)
	if err != nil {
		return err
	}
	for _, r := range rows {
		if fieldProblem(old, next, r) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `DELETE FROM campaign_field WHERE campaign_id = $1 AND field_id = $2`, cid, r.FieldID); err != nil {
			return err
		}
	}
	return nil
}
