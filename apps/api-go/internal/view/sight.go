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
	// TableRun is a player seat of a room without a GM: it sees the whole Encounter and every Test call, since nothing
	// is hidden there (docs/adr/0009-table-modes.md). It sees none of the GM side: no `gm` entry, note, pack entry,
	// field or hidden target, whatever it is allowed to run.
	TableRun bool
}

// RunsAsGm says whether the seat runs the room as its GM. An admin who opened it does not: they see all, run nothing.
// Without a GM nobody does.
func RunsAsGm(c cs.Ctx) bool { return c.HasGM() && c.Seat.Kind == cs.SeatMember && c.Seat.Role == "gm" }

func isOwner(c cs.Ctx) bool {
	return c.UserID != nil && c.CampaignOwnerID != nil && *c.UserID == *c.CampaignOwnerID
}

// IsOwner says whether the seat is the room's owner.
func IsOwner(c cs.Ctx) bool { return isOwner(c) }

// SightOf is the seat's sight. The co-GM scopes are asked of CanInCampaign, which also decides actions, not copied.
//
// Without a GM the table permissions (session:run, encounter:run, test:call, codex:write...) go to every player, so the
// sight is NOT read from them: that would hand every player the GM side. Only an unseated admin sees all there.
func SightOf(c cs.Ctx) Sight {
	if !c.HasGM() && c.Seat.Kind != cs.SeatAdmin {
		player := c.Role() == "player"
		return Sight{TableRun: player, Combat: player}
	}
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
	if !c.HasGM() {
		return SightOf(c).All // nobody is on the GM side of anything
	}
	return SightOf(c).All || cs.CanInCampaign(c, cs.GMPermOf(kind), "")
}

// ActorWriteSide says whether the seat writes a value of this visibility on an actor of this kind, whatever its
// editableBy. A co-GM outside the kind's GM side still writes what everyone sees.
func ActorWriteSide(c cs.Ctx, kind, visibility string) bool {
	return ActorGmSide(c, kind) ||
		(c.Seat.Kind == cs.SeatMember && c.Role() == "cogm" && (visibility == "public" || visibility == "party"))
}

// ReadableEntryVisibilities is the visibilities of pack entries the seat may read.
func ReadableEntryVisibilities(c cs.Ctx) []string {
	if ReadsGM(c) {
		return []string{"public", "party", "gm"}
	}
	return []string{"public", "party"}
}

// ReadsGM says whether the seat reads `gm` pack entries and the `gm` definitions of the manifest. Without a GM nobody
// does, whatever the seat runs.
func ReadsGM(c cs.Ctx) bool {
	sight := SightOf(c)
	return sight.All || (c.HasGM() && sight.Combat)
}

func isScreen(c cs.Ctx) bool { return c.Seat.Kind == cs.SeatToken && c.Seat.Role == "screen" }

func holds(held []string, id string) bool { return slices.Contains(held, id) }
