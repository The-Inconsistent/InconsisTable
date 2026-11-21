package engine

// CodexScope is the scope a codex reminder's `if` reads (house decision #89; codexScope in rules-engine codex.ts):
// `fields`, a record of the kind's fields, a rows field left out, and `campaign`, the campaign fields every seat reads
// (house decision #97), when the manifest declares any. With party, only the `party` fields: a reminder that reads a
// `gm` one does not compile in it.
func CodexScope(fields map[string]FieldDef, party bool, campaign map[string]CampaignFieldDef) map[string]ExprType {
	record := map[string]ExprType{}
	for id, def := range fields {
		if party && def.Visibility != "party" {
			continue
		}
		switch def.Type {
		case "int":
			record[id] = intType
		case "bool":
			record[id] = boolType
		case "tags":
			record[id] = ListType{textType}
		case "rows":
		default:
			record[id] = textType
		}
	}
	scope := map[string]ExprType{"fields": RecordType{record}}
	if campaign != nil {
		scope["campaign"] = campaignScope(&Ruleset{CampaignFields: campaign})
	}
	return scope
}

// PartyReadsReminder says whether a seat that reads only `party` fields may be shown the reminder: its `if` reads none
// of the `gm` ones (partyReadsReminder in codex.ts).
func PartyReadsReminder(kind CodexKind, reminder CodexReminder, campaign map[string]CampaignFieldDef) bool {
	_, err := CompileExpr(reminder.If, CodexScope(kind.Fields, true, campaign), nil)
	return err == nil
}
