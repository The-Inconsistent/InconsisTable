package coreschema

// Result is an accepted action's ack: {ok: true}, with the id it made or the token it issued when it has one.
type Result struct {
	OK    bool   `json:"ok"`
	ID    string `json:"id,omitempty"`
	Token string `json:"token,omitempty"`
	// Notices is what the answer tells its sender (house decision #79), absent when there is none.
	Notices []Notice `json:"notices,omitempty"`
	// Skipped names the actors a rest of everyone left out (house decision #81); absent when none.
	Skipped []string `json:"skipped,omitempty"`
	// XCardMode is set by safety.xcard (never sent in the ack): the table mode the card was touched in, so the gateway
	// picks who hears it from the row the action read, not from a socket's stale one.
	XCardMode string `json:"-"`
}

// Done is {ok: true}, with the id when there is one ("" leaves it out).
func Done(id string) Result { return Result{OK: true, ID: id} }
