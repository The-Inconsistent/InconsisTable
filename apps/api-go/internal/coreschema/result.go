package coreschema

// Result is an accepted action's ack: {ok: true}, with the id it made or the token it issued when it has one.
type Result struct {
	OK    bool   `json:"ok"`
	ID    string `json:"id,omitempty"`
	Token string `json:"token,omitempty"`
}

// Done is {ok: true}, with the id when there is one ("" leaves it out).
func Done(id string) Result { return Result{OK: true, ID: id} }
