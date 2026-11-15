package view

import (
	"testing"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

func toAny(list []string) any {
	out := make([]any, len(list))
	for i, s := range list {
		out[i] = s
	}
	return out
}

// Without a GM nobody is on the GM side: no seat receives a `gm` codex entry, a note for the GM, a `gm` pack entry, a
// `gm` clock, the session notes or a hidden Test target, whoever it is and whatever it is allowed to run. Only an admin
// who opened the room without a seat sees all. This asserts it on every seat kind of the vectors
// (docs/adr/0009-table-modes.md).
func assertNothingForTheGM(t *testing.T, name, mode string, seat cs.SeatKind, got SeatView, packVisibilities []string) {
	t.Helper()
	if mode == cs.TableModeGM || seat == cs.SeatAdmin {
		return
	}
	for _, e := range got.Codex.Entries {
		if e.Visibility == "gm" || e.GMNotes != "" || len(e.PlannedTests) > 0 {
			t.Errorf("%s: sent codex entry %s with GM-side content (visibility %s)", name, e.ID, e.Visibility)
		}
	}
	for _, v := range packVisibilities {
		if v == "gm" {
			t.Errorf("%s: may read gm pack entries", name)
		}
	}
	for _, k := range got.State.Clocks {
		if k.Visibility == "gm" {
			t.Errorf("%s: sent the gm clock %s", name, k.ID)
		}
	}
	if got.State.Session != nil && got.State.Session.Notes != "" {
		t.Errorf("%s: sent the session notes", name)
	}
	for _, r := range got.State.Rolls {
		if r.Visibility != "party" {
			t.Errorf("%s: sent the %s roll %s", name, r.Visibility, r.ID)
		}
	}
	for _, d := range got.State.Dealt {
		if d.Visibility == "gm" {
			t.Errorf("%s: sent a gm card of %s", name, d.ActorID)
		}
	}
	for _, call := range got.State.Tests {
		if len(call.SecretInputs) > 0 {
			t.Errorf("%s: call %s has secret inputs", name, call.ID)
		}
		for _, target := range call.Targets {
			if !call.ShowTarget && target.Target != nil {
				t.Errorf("%s: call %s sends a hidden target", name, call.ID)
			}
		}
	}
}

// The sight of a room without a GM is the player's, whoever sits there.
func TestSightWithoutAGM(t *testing.T) {
	owner := "owner"
	seats := map[string]cs.Seat{
		"gm":     {Kind: cs.SeatMember, Role: "gm"},
		"cogm":   {Kind: cs.SeatMember, Role: "cogm", Scopes: []string{"combat", "codex", "codex.secrets", "party", "session"}},
		"player": {Kind: cs.SeatMember, Role: "player"},
		"guest":  {Kind: cs.SeatToken, Role: "player"},
	}
	for _, mode := range []string{cs.TableModeGMLess, cs.TableModeSolo} {
		for name, seat := range seats {
			for _, user := range []*string{&owner, nil} {
				c := cs.Ctx{UserID: user, CampaignOwnerID: &owner, TableMode: mode, Seat: seat}
				s := SightOf(c)
				if s.All || s.Session || s.Secrets || s.Codex || s.Party || s.Clocks || s.Requests || s.Tables {
					t.Errorf("%s %s: sees the GM side: %+v", mode, name, s)
				}
				if !s.TableRun || !s.Combat {
					t.Errorf("%s %s: should run the table: %+v", mode, name, s)
				}
				if ReadsGM(c) {
					t.Errorf("%s %s: reads gm pack entries", mode, name)
				}
			}
		}
		screen := cs.Ctx{TableMode: mode, Seat: cs.Seat{Kind: cs.SeatToken, Role: "screen"}}
		if s := SightOf(screen); s != (Sight{}) {
			t.Errorf("%s screen: %+v", mode, s)
		}
	}
	// With a GM the owner still sees all, as before.
	if !SightOf(cs.Ctx{UserID: &owner, CampaignOwnerID: &owner, TableMode: cs.TableModeGM, Seat: seats["player"]}).All {
		t.Error("the owner of a room with a GM sees all")
	}
}
