package view

import (
	"encoding/json"
	"fmt"
	"slices"
	"testing"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// An exhaustive check of what each seat receives of the actors (CLAUDE.md principle 4, house decision #31, docs/design.md
// §5.5). Every seat a room can hold, in every table mode, with every set of co-GM scopes and every owner relation, is
// run through Of against one snapshot whose actors carry one value of each visibility. The properties:
//
//   - hidden: a `gm` value (or one the manifest never declared) reaches a seat only on the GM side of that actor's kind.
//   - owner: an `owner` value reaches a seat only on the GM side of that kind or holding that actor.
//   - private: an actor's ledger, items, spawn options and owner id reach a seat only on that GM side or holding it.
//   - served: the GM side of a kind does receive the hidden values of every actor of that kind it is sent.
//
// gmSideOf is written from the house decisions, not read from SightOf or CanInCampaign, so a change to either that
// moves a seat to the GM side shows up here.

const (
	seatUser  = "u-seat"
	otherUser = "u-other"
	heldPC    = "pc-held"
)

// gmSideOf: an unseated admin always; without a GM nobody else (docs/adr/0009-table-modes.md); with one the GM, the
// owner, and a co-GM holding `party` for characters and companions or `combat` for every other kind.
func gmSideOf(c cs.Ctx, mode, kind string) bool {
	if c.Seat.Kind == cs.SeatAdmin {
		return true
	}
	if mode != cs.TableModeGM {
		return false
	}
	owner := c.UserID != nil && c.CampaignOwnerID != nil && *c.UserID == *c.CampaignOwnerID
	if c.Seat.Kind != cs.SeatMember {
		return false
	}
	switch {
	case c.Seat.Role == "gm" || owner:
		return true
	case c.Seat.Role == "cogm" && (kind == "pc" || kind == "companion"):
		return slices.Contains(c.Seat.Scopes, "party")
	case c.Seat.Role == "cogm":
		return slices.Contains(c.Seat.Scopes, "combat")
	}
	return false
}

// seatShapes is every seat the server builds (auth.ResolveSocketCtx): a member as gm, cogm or player with any subset of
// the five co-GM scopes and any owner relation; a token as a guest player or the table's screen, with no user; the
// admin key, with no user and no seat.
func seatShapes() []cs.Ctx {
	scopes := []string{"party", "session", "combat", "codex", "codex.secrets"}
	var subsets [][]string
	for mask := 0; mask < 1<<len(scopes); mask++ {
		s := []string{}
		for i, scope := range scopes {
			if mask&(1<<i) != 0 {
				s = append(s, scope)
			}
		}
		subsets = append(subsets, s)
	}
	me, other := seatUser, otherUser
	owners := []*string{&me, &other, nil}
	held := [][]string{{}, {heldPC}}
	var out []cs.Ctx
	for _, role := range []string{"gm", "cogm", "player"} {
		for _, s := range subsets {
			for _, owner := range owners {
				for _, h := range held {
					out = append(out, cs.Ctx{
						CampaignID: "c1", UserID: &me, CampaignOwnerID: owner,
						Seat: cs.Seat{Kind: cs.SeatMember, Role: role, Scopes: s, CharacterIDs: h},
					})
				}
			}
		}
	}
	for _, owner := range owners[1:] {
		for _, h := range held {
			out = append(out, cs.Ctx{CampaignID: "c1", CampaignOwnerID: owner,
				Seat: cs.Seat{Kind: cs.SeatToken, Role: "player", CharacterIDs: h}})
		}
		out = append(out,
			cs.Ctx{CampaignID: "c1", CampaignOwnerID: owner, Seat: cs.Seat{Kind: cs.SeatToken, Role: "screen"}},
			cs.Ctx{CampaignID: "c1", CampaignOwnerID: owner, Seat: cs.Seat{Kind: cs.SeatAdmin}},
		)
	}
	return out
}

// One entity with a field and a resource of each visibility; `loose` is a value the manifest never declares.
const secretsManifest = `{
  "id": "formal-seat", "version": "0.1.0", "core": "^0.1.0",
  "sources": [{ "id": "h", "title": "Homebrew", "license": "homebrew" }],
  "entities": [{ "id": "being", "label": "Being", "base": "actor", "fields": {
    "fPublic": { "type": "int", "label": "Public", "visibility": "public" },
    "fParty":  { "type": "int", "label": "Party",  "visibility": "party" },
    "fOwner":  { "type": "int", "label": "Owner",  "visibility": "owner" },
    "fGm":     { "type": "int", "label": "Gm",     "visibility": "gm" }
  } }],
  "resources": [
    { "id": "rPublic", "label": "Public", "scope": "entity", "visibility": "public" },
    { "id": "rParty",  "label": "Party",  "scope": "entity", "visibility": "party" },
    { "id": "rOwner",  "label": "Owner",  "scope": "entity", "visibility": "owner" },
    { "id": "rGm",     "label": "Gm",     "scope": "entity", "visibility": "gm" }
  ],
  "initiative": { "strategy": "ranked", "score": "1" }
}`

var visibilityOf = map[string]string{
	"fPublic": "public", "fParty": "party", "fOwner": "owner", "fGm": "gm", "loose": "gm",
	"rPublic": "public", "rParty": "party", "rOwner": "owner", "rGm": "gm",
}

// The actors: a character the seat may hold, one it never does, a companion, an NPC the GM shows in full in the
// encounter, and a hidden creature.
func secretsSnapshot(mode string) Snapshot {
	other := otherUser
	actor := func(id, kind string) cs.Actor {
		return cs.Actor{
			ID: id, Kind: kind, Name: id, Status: "active", OwnerUserID: &other, Entity: "being",
			Fields:    map[string]any{"fPublic": 1, "fParty": 2, "fOwner": 3, "fGm": 4, "loose": 5},
			Resources: map[string]float64{"rPublic": 1, "rParty": 2, "rOwner": 3, "rGm": 4},
			Derived:   map[string]float64{}, Conditions: []string{},
			Items:        []cs.ActorItem{{ID: "item-" + id, Kind: "gear"}},
			Ledger:       &cs.ActorLedger{Build: json.RawMessage(`{}`)},
			SpawnOptions: []string{"elite"},
		}
	}
	return Snapshot{State: cs.LiveState{
		Campaign: cs.CampaignInfo{ID: "c1", Name: "Formal", TableMode: mode},
		Actors: []cs.Actor{
			actor(heldPC, "pc"), actor("pc-other", "pc"), actor("companion", "companion"),
			actor("npc", "npc"), actor("creature", "creature"),
		},
		Encounter: &cs.Encounter{ID: "e1", Round: 1, Combatants: []cs.Combatant{
			{ID: "cb-npc", ActorID: "npc", Name: "npc", Side: "threats", Visibility: "full"},
			{ID: "cb-creature", ActorID: "creature", Name: "creature", Side: "threats", Visibility: "hidden"},
		}},
	}}
}

func describe(c cs.Ctx, mode string) string {
	owner := "none"
	if c.CampaignOwnerID != nil {
		owner = *c.CampaignOwnerID
	}
	return fmt.Sprintf("mode=%s seat=%s/%s scopes=%v owner=%s held=%v", mode, c.Seat.Kind, c.Seat.Role, c.Seat.Scopes,
		owner, c.Seat.CharacterIDs)
}

func TestEverySeatReceivesOnlyItsActorValues(t *testing.T) {
	var manifest any
	if err := json.Unmarshal([]byte(secretsManifest), &manifest); err != nil {
		t.Fatal(err)
	}
	compiled, problems := engine.CompileRuleset(manifest)
	if len(problems) > 0 {
		t.Fatalf("the check's manifest does not compile: %v", problems)
	}
	seats := seatShapes()
	modes := []string{cs.TableModeGM, cs.TableModeGMLess, cs.TableModeSolo}
	checked, failures := 0, 0
	fail := func(format string, args ...any) {
		failures++
		if failures <= 20 {
			t.Errorf(format, args...)
		}
	}
	for _, mode := range modes {
		snapshot := secretsSnapshot(mode)
		kindOf := map[string]string{}
		for _, a := range snapshot.State.Actors {
			kindOf[a.ID] = a.Kind
		}
		for _, c := range seats {
			got := Of(secretsSnapshot(mode), compiled, c)
			who := describe(c, mode)
			for _, a := range got.State.Actors {
				checked++
				gmSide := gmSideOf(c, mode, kindOf[a.ID])
				holds := slices.Contains(c.Seat.CharacterIDs, a.ID) && c.Seat.Kind != cs.SeatAdmin
				values := map[string]bool{}
				for id := range a.Fields {
					values[id] = true
				}
				for id := range a.Resources {
					values[id] = true
				}
				for id := range values {
					switch visibilityOf[id] {
					case "gm":
						if !gmSide {
							fail("hidden: %s received %s's gm value %s", who, a.ID, id)
						}
					case "owner":
						if !gmSide && !holds {
							fail("owner: %s received %s's owner value %s", who, a.ID, id)
						}
					}
				}
				if !gmSide && !holds {
					if a.Ledger != nil || len(a.Items) > 0 || len(a.SpawnOptions) > 0 || a.OwnerUserID != nil {
						fail("private: %s received %s's ledger, items, spawn options or owner", who, a.ID)
					}
				}
				if gmSide && (!values["fGm"] || !values["rGm"] || !values["loose"]) {
					fail("served: %s is on the GM side of %s but did not receive its hidden values", who, a.ID)
				}
			}
		}
	}
	if failures > 20 {
		t.Errorf("... and %d more", failures-20)
	}
	// 3 modes × 584 seats gave 8558 actor views at the sync commit; far fewer means seats stopped receiving actors.
	if checked < 8000 {
		t.Fatalf("only %d actor views checked over %d seats: the snapshot or the seats stopped exercising Of", checked, len(seats))
	}
	t.Logf("%d seats × %d modes, %d actor views checked", len(seats), len(modes), checked)
}
