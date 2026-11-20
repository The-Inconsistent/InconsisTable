package engine

// CodexScope is the scope a codex reminder's `if` reads (house decision #89; codexScope in rules-engine codex.ts):
// `fields`, a record of the kind's fields, a rows field left out. With party, only the `party` fields: a reminder that
// reads a `gm` one does not compile in it.
func CodexScope(fields map[string]FieldDef, party bool) map[string]ExprType {
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
	return map[string]ExprType{"fields": RecordType{record}}
}

// PartyReadsReminder says whether a seat that reads only `party` fields may be shown the reminder: its `if` reads none
// of the `gm` ones (partyReadsReminder in codex.ts).
func PartyReadsReminder(kind CodexKind, reminder CodexReminder) bool {
	_, err := CompileExpr(reminder.If, CodexScope(kind.Fields, true), nil)
	return err == nil
}
