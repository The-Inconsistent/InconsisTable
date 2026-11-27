package view

import (
	"testing"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// A seat receives the id of an actor's picture exactly when the picture route would serve it (house decision #155): a
// player never the id of a picture held back on a character it does not hold.
func TestAnActorsPictureIdReachesOnlyWhoMaySeeIt(t *testing.T) {
	held, shown, hidden, creature := "p-held", "p-shown", "p-hidden", "p-creature"
	state := cs.LiveState{Actors: []cs.Actor{
		{ID: "a-mine", Kind: "pc", ImageID: &held},
		{ID: "a-shown", Kind: "pc", ImageID: &shown, ImageRevealed: true},
		{ID: "a-hidden", Kind: "pc", ImageID: &hidden},
		{ID: "a-creature", Kind: "creature", ImageID: &creature},
	}}
	owner := "owner"
	player := cs.Ctx{CampaignID: "c", CampaignOwnerID: &owner, TableMode: cs.TableModeGM,
		Seat: cs.Seat{Kind: cs.SeatMember, Role: "player", Scopes: []string{}, CharacterIDs: []string{"a-mine"}}}
	gm := cs.Ctx{CampaignID: "c", UserID: &owner, CampaignOwnerID: &owner, TableMode: cs.TableModeGM,
		Seat: cs.Seat{Kind: cs.SeatMember, Role: "gm"}}
	screen := cs.Ctx{CampaignID: "c", CampaignOwnerID: &owner, TableMode: cs.TableModeGM, Seat: cs.Seat{Kind: cs.SeatToken, Role: "screen"}}
	for name, tc := range map[string]struct {
		c    cs.Ctx
		want []string
	}{
		"player": {player, []string{held, shown}},
		"gm":     {gm, []string{held, shown, hidden, creature}},
		"screen": {screen, []string{shown}},
	} {
		got := []string{}
		for _, a := range seatState(state, nil, tc.c, SightOf(tc.c)).Actors {
			if a.ImageID != nil {
				got = append(got, *a.ImageID)
			}
			if (a.ImageID != nil) != ShowsActorPicture(tc.c, a.ID, a.Kind, a.ImageRevealed) {
				t.Errorf("%s: the view and the route disagree on %s", name, a.ID)
			}
		}
		if len(got) != len(tc.want) {
			t.Errorf("%s: received %v, want %v", name, got, tc.want)
			continue
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Errorf("%s: received %v, want %v", name, got, tc.want)
			}
		}
	}
}
