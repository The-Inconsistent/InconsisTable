package view

import (
	"slices"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// ShowsActorPicture says whether a seat receives the id of an actor's picture (house decision #155): a seat that sees
// the actor, when it holds it or is on its GM side, or once the picture is shown to the table. The picture route serves
// it only then, so the route and seatState never disagree.
func ShowsActorPicture(c cs.Ctx, actorID, kind string, shown bool) bool {
	held := HeldBy(c)
	if !slices.Contains(partyKinds, kind) && !holds(held, actorID) && !SightOf(c).Combat {
		return false
	}
	return shown || holds(held, actorID) || ActorGmSide(c, kind)
}
