package view

import (
	"fmt"
	"strings"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// OwnerStrikeProblems is what an import refuses of a strike its owner sends (house decision #113; vectors/reference
// ownerStrikeProblems): one a player's copy (house decision #101) does not carry as declared, because the cut that makes
// that copy compile took or narrowed it for reading a value players may not read. Each is refused at the strike's path,
// naming where it reads one. The manifest is the normalized one of a ruleset that compiles.
func OwnerStrikeProblems(manifest map[string]any) []engine.Problem {
	var owned []int
	strikes := list(manifest["strikes"])
	for i, s := range strikes {
		if strike, _ := s.(map[string]any); strike["byOwner"] == true {
			owned = append(owned, i)
		}
	}
	if len(owned) == 0 {
		return nil
	}
	player := cs.Ctx{TableMode: cs.TableModeGM, Seat: cs.Seat{Kind: cs.SeatMember, Role: "player"}}
	served := SeatManifest(manifest, player)
	kept := map[string]string{}
	for _, s := range list(served["strikes"]) {
		strike, _ := s.(map[string]any)
		id, _ := strike["id"].(string)
		kept[id] = engine.CanonicalJSON(strike)
	}
	var out []engine.Problem
	for _, i := range owned {
		strike, _ := strikes[i].(map[string]any)
		id, _ := strike["id"].(string)
		if kept[id] == engine.CanonicalJSON(strike) {
			continue
		}
		out = append(out, engine.Problem{
			Path:    fmt.Sprintf("strikes[%d]", i),
			Message: "a strike sent from a phone reads a value players may not read: " + readAt(served, strike, i),
		})
	}
	return out
}

// readAt is where the strike, put back as declared into the player's copy, does not compile: the first problem inside
// it, at the strike's own index. The strike's path when nothing inside it is named.
func readAt(served, strike map[string]any, i int) string {
	trial := make(map[string]any, len(served))
	for k, v := range served {
		trial[k] = v
	}
	others := []any{}
	for _, s := range list(served["strikes"]) {
		if other, _ := s.(map[string]any); other["id"] != strike["id"] {
			others = append(others, s)
		}
	}
	at := fmt.Sprintf("strikes[%d]", len(others))
	trial["strikes"] = append(others, strike)
	for _, p := range problemsOf(trial) {
		if rest, found := strings.CutPrefix(p.Path, at); found && (rest == "" || rest[0] == '.') {
			return fmt.Sprintf("strikes[%d]", i) + rest
		}
	}
	return fmt.Sprintf("strikes[%d]", i)
}
