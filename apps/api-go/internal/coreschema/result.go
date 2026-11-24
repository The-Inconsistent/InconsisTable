package coreschema

// Result is an accepted action's ack: {ok: true}, with the id it made or the token it issued when it has one.
type Result struct {
	OK    bool   `json:"ok"`
	ID    string `json:"id,omitempty"`
	Token string `json:"token,omitempty"`
	// Notices is what the answer tells its sender (house decision #79), absent when there is none.
	Notices []Notice `json:"notices,omitempty"`
	// Roll is what table.roll drew or read and table.apply applied (house decision #87), absent otherwise.
	Roll *RollAnswer `json:"roll,omitempty"`
	// XCardMode is set by safety.xcard (never sent in the ack): the table mode the card was touched in, so the gateway
	// picks who hears it from the row the action read, not from a socket's stale one.
	XCardMode string `json:"-"`
}

// RollAnswer is a line read on a table: its entry, the dice (Value) and the total the line was read with.
type RollAnswer struct {
	EntryID string `json:"entryId"`
	Value   int    `json:"value"`
	Total   int    `json:"total"`
}

// Done is {ok: true}, with the id when there is one ("" leaves it out).
func Done(id string) Result { return Result{OK: true, ID: id} }
