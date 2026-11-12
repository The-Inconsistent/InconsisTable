// Package view is the Seat view (CONTEXT.md): the one place that decides what a seat receives, sees and may write. It
// is pure, with no database, and is the Go twin of apps/api/src/view; vectors/table.ts holds the two equal.
package view

import (
	"slices"

	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Sight is what a seat may see of the parts of the table hidden from players. "Is this seat on the GM side?" has one
// answer per part of the table (house decision #31).
type Sight struct {
	// All is the GM, the owner, an unseated admin: everything, whatever a scope says.
	All bool
	// Combat is hidden Combatants, Creature and NPC values, the whole Encounter, gm pack entries.
	Combat bool
	// Session is hidden Test targets and inputs, the session notes.
	Session bool
	// Secrets is secret codex entries and the notes on them.
	Secrets bool
	// Codex is every codex entry, gm ones and each entry's audience (not the notes: those are Secrets).
	Codex bool
	// Clocks is the `gm` clocks.
	Clocks bool
	// Requests is every player's pending spend requests: the side that answers them.
	Requests bool
	// Party is the gm fields and resources of the party's Characters.
	Party bool
}

// RunsAsGm says whether the seat runs the room as its GM. An admin who opened it does not: they see all, run nothing.
func RunsAsGm(c cs.Ctx) bool { return c.Seat.Kind == cs.SeatMember && c.Seat.Role == "gm" }

func isOwner(c cs.Ctx) bool {
	return c.UserID != nil && c.CampaignOwnerID != nil && *c.UserID == *c.CampaignOwnerID
}

// SightOf is the seat's sight. The co-GM scopes are asked of CanInCampaign, which also decides actions, not copied.
func SightOf(c cs.Ctx) Sight {
	all := c.Seat.Kind == cs.SeatAdmin || RunsAsGm(c) || isOwner(c)
	can := func(perm string) bool { return all || cs.CanInCampaign(c, perm, "") }
	return Sight{
		All:     all,
		Combat:  can("encounter:run"),
		Session: can("test:call"),
		Secrets: can("codex:read_secret"),
		Codex:   can("codex:write"),
		Party:   can("character:edit:any"),
		Clocks:  can("clock:run"),

		Requests: can("request:resolve"),
	}
}

// HeldBy is the characters this seat holds. An admin who opened the room holds none.
func HeldBy(c cs.Ctx) []string {
	if c.Seat.Kind == cs.SeatAdmin || c.Seat.CharacterIDs == nil {
		return []string{}
	}
	return c.Seat.CharacterIDs
}

// ActorGmSide says whether the seat sees and writes every value of an actor of this kind: party covers the party,
// combat the rest.
func ActorGmSide(c cs.Ctx, kind string) bool {
	return SightOf(c).All || cs.CanInCampaign(c, cs.GMPermOf(kind), "")
}

// ActorWriteSide says whether the seat writes a value of this visibility on an actor of this kind, whatever its
// editableBy. A co-GM outside the kind's GM side still writes what everyone sees.
func ActorWriteSide(c cs.Ctx, kind, visibility string) bool {
	return ActorGmSide(c, kind) ||
		(c.Seat.Kind == cs.SeatMember && c.Seat.Role == "cogm" && (visibility == "public" || visibility == "party"))
}

// ReadableEntryVisibilities is the visibilities of pack entries the seat may read.
func ReadableEntryVisibilities(c cs.Ctx) []string {
	if SightOf(c).Combat {
		return []string{"public", "party", "gm"}
	}
	return []string{"public", "party"}
}

func isScreen(c cs.Ctx) bool { return c.Seat.Kind == cs.SeatToken && c.Seat.Role == "screen" }

func holds(held []string, id string) bool { return slices.Contains(held, id) }
