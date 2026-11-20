package table

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/pack"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/world"
)

// A room's World (house decision #65): pinned by the one running the room, from their own Worlds, and served to every
// seat of that room alike while it is served.

func (p *play) importWorld(owner, slug, version string) string {
	p.t.Helper()
	doc := map[string]any{"id": slug, "version": version, "core": "^1.0.0", "name": "Tide",
		"theme": map[string]any{"schemes": map[string]any{"dark": map[string]any{"accent": "#5fc1c9"}}, "texture": "paper"}}
	return dbtest.Must[*world.Imported](p.t)(world.ImportTx(context.Background(), p.tx, owner, doc)).VersionID
}

func setWorld(versionID string) map[string]any {
	return map[string]any{"type": "campaign.setWorld", "worldVersionId": versionID}
}

// served is the World a seat reads with the room's rules, or nil.
func (p *play) served(c cs.Ctx) map[string]any {
	p.t.Helper()
	rules := dbtest.Must[*pack.Rules](p.t)(pack.ReadRules(context.Background(), p.tx, c, pack.RulesQuery{Limit: 10}))
	raw, err := json.Marshal(rules)
	if err != nil {
		p.t.Fatal(err)
	}
	var out struct {
		World map[string]any `json:"world"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		p.t.Fatal(err)
	}
	return out.World
}

func TestTheRoomRunnerPinsTheirOwnWorldAndEverySeatReadsIt(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newPlay(t, tx)
		gm := p.room.GM()
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Alice"))
		screen := gm
		screen.UserID = nil
		screen.Seat = cs.Seat{Kind: cs.SeatToken, Role: "screen", CharacterIDs: []string{}}

		if p.served(gm) != nil || p.seatView(gm).State.Campaign.WorldVersionID != nil {
			t.Fatal("a room starts without a World")
		}
		first := p.importWorld(p.room.Owner, "tide", "1.0.0")
		p.send(gm, setWorld(first))
		for name, seat := range map[string]cs.Ctx{"the GM": gm, "a player": player, "the table screen": screen} {
			w := p.served(seat)
			if w == nil || w["versionId"] != first || w["slug"] != "tide" || w["version"] != "1.0.0" || w["name"] != "Tide" {
				t.Fatalf("%s reads the World: %v", name, w)
			}
			theme, _ := w["theme"].(map[string]any)
			if theme["texture"] != "paper" {
				t.Fatalf("%s reads the theme as stored: %v", name, theme)
			}
			if w["handouts"] != nil {
				t.Fatalf("%s reads no handout layouts from a World without them: %v", name, w["handouts"])
			}
			if got := p.seatView(seat).State.Campaign.WorldVersionID; got == nil || *got != first {
				t.Fatalf("%s's state names the pinned World: %v", name, got)
			}
		}

		// Changed mid-session (the play room has one running), and to the same version again.
		// This one offers two handout layouts (house decision #72), read by every seat with the World.
		doc := map[string]any{"id": "tide", "version": "1.1.0", "core": "^1.0.0", "name": "Tide",
			"theme":    map[string]any{"schemes": map[string]any{"dark": map[string]any{}}},
			"handouts": map[string]any{"layouts": []any{"form", "plain"}, "names": map[string]any{"form": "Ledger"}}}
		second := dbtest.Must[*world.Imported](t)(world.ImportTx(context.Background(), tx, p.room.Owner, doc)).VersionID
		p.send(gm, setWorld(second))
		p.send(gm, setWorld(second))
		if w := p.served(player); w == nil || w["versionId"] != second {
			t.Fatalf("the new version is served: %v", w)
		}
		for _, seat := range []cs.Ctx{player, screen} {
			want := `{"layouts":["form","plain"],"names":{"form":"Ledger"}}`
			if got, _ := json.Marshal(p.served(seat)["handouts"]); string(got) != want {
				t.Fatalf("handouts: want %s, got %s", want, got)
			}
		}

		// A seat of another room reads that room's rules, which have no World.
		other := dbtest.NewRoom(t, tx)
		if p.served(other.GM()) != nil {
			t.Fatal("another room's seat reads this room's World")
		}

		p.send(gm, map[string]any{"type": "campaign.unsetWorld"})
		if p.served(gm) != nil || p.seatView(player).State.Campaign.WorldVersionID != nil {
			t.Fatal("an unset World is gone")
		}
		p.send(gm, map[string]any{"type": "campaign.unsetWorld"})
	})
}

func TestPinningRefusesWhatIsNotTheRunnersToPin(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newPlay(t, tx)
		gm := p.room.GM()
		p.refused(gm, setWorld("0190a000-0000-7000-8000-000000000999"), "worldNotFound")
		// A second owner's World reads as missing to the first.
		p.refused(gm, setWorld(p.importWorld(dbtest.User(t, tx, "Other"), "tide", "1.0.0")), "worldNotFound")

		down := p.importWorld(p.room.Owner, "down", "1.0.0")
		dbtest.Exec(t, tx, `UPDATE world SET disabled_at = now() WHERE slug = 'down'`)
		p.refused(gm, setWorld(down), "worldTakenDown")
		gone := p.importWorld(p.room.Owner, "gone", "1.0.0")
		dbtest.Exec(t, tx, `UPDATE world SET hidden_at = now() WHERE slug = 'gone'`)
		p.refused(gm, setWorld(gone), "worldDeleted")

		mine := p.importWorld(p.room.Owner, "mine", "1.0.0")
		// The owner on a seat that does not run the room (a GM room, sitting as a player) pins nothing.
		asPlayer := gm
		asPlayer.Seat = cs.Seat{Kind: cs.SeatMember, Role: "player", Scopes: []string{}, CharacterIDs: []string{}}
		p.refused(asPlayer, setWorld(mine), "worldRunnersOnly")
		// A player who does not own the room has no say in it at all.
		alice := p.room.Seat(t, tx, dbtest.User(t, tx, "Alice"))
		p.refused(alice, setWorld(p.importWorld(*alice.UserID, "hers", "1.0.0")), "noPermission")
		p.refused(alice, map[string]any{"type": "campaign.unsetWorld"}, "noPermission")
	})
}

func TestTheOwnerOfARoomWithoutAGMPinsTheirWorld(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := anyModes(t, tx)
		gm := p.room.GM()
		p.setMode(gm, "gmless")
		owner := gm
		owner.Seat = cs.Seat{Kind: cs.SeatMember, Role: "player", Scopes: []string{}, CharacterIDs: []string{}}
		p.send(owner, setWorld(p.importWorld(p.room.Owner, "tide", "1.0.0")))
		if p.served(owner) == nil {
			t.Fatal("the owner runs a room without a GM: their World is served")
		}
	})
}

func TestAWorldStopsBeingServedWhenTakenDownOrWhenItsOwnerNoLongerRunsTheRoom(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newPlay(t, tx)
		gm := p.room.GM()
		p.send(gm, setWorld(p.importWorld(p.room.Owner, "tide", "1.0.0")))
		dbtest.Exec(t, tx, `UPDATE world SET disabled_at = now() WHERE owner_user_id = $1`, p.room.Owner)
		if p.served(gm) != nil {
			t.Fatal("a taken-down World is still served")
		}
		dbtest.Exec(t, tx, `UPDATE world SET disabled_at = NULL WHERE owner_user_id = $1`, p.room.Owner)
		if p.served(gm) == nil {
			t.Fatal("a World put back is served again")
		}
		// Hidden by its owner, a pinned World keeps the room's look.
		dbtest.Exec(t, tx, `UPDATE world SET hidden_at = now() WHERE owner_user_id = $1`, p.room.Owner)
		if p.served(gm) == nil {
			t.Fatal("a hidden but pinned World is served")
		}
		// The owner no longer runs the room: their World is not served on anyone else's say-so.
		dbtest.Exec(t, tx, `UPDATE membership SET role = 'player' WHERE campaign_id = $1`, p.room.ID)
		if p.served(gm) != nil {
			t.Fatal("a World is served where its owner runs nothing")
		}
	})
}
