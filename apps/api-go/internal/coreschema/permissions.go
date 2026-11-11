package coreschema

import (
	"slices"
	"strings"
)

// Permissions are data: every action declares the one it needs, and authorize asks CanInCampaign before the action's
// own validator runs.
var (
	// Only the room owner or an admin who opened the room as admin.
	ownerOnly = []string{"campaign:delete", "campaign:transfer", "campaign:ruleset", "member:appoint"}
	// Only an admin: giving a user a seat they weren't invited to.
	adminOnly = []string{"member:seat"}
	gmGrants  = []string{
		"campaign:update", "campaign:archive", "member:invite", "member:remove", "seat:leave", "session:run", "encounter:run",
		"test:call", "codex:read", "codex:write", "codex:read_secret", "codex:reveal", "character:create",
		"character:edit:any", "token:issue", "request:resolve",
	}
	// What each seat may do anywhere in its room. :own permissions are in ownGrants: they need a target the seat holds.
	seatGrants = map[string][]string{
		"gm": gmGrants,
		// A co-GM holds the GM's permissions that a scope covers, never campaign settings.
		"cogm": slices.DeleteFunc(slices.Clone(gmGrants), func(p string) bool {
			return p == "campaign:update" || p == "campaign:archive"
		}),
		"player": {"codex:read", "request:send", "safety:signal", "seat:leave"},
		"screen": {"codex:read"},
	}
	ownGrants = map[string][]string{"player": {"character:edit:own", "test:report:own", "phase:done:own"}}
	// The scopes that unlock a GM permission for a co-GM. Reading the revealed codex and leaving need none.
	cogmScopesFor = map[string][]string{
		"member:invite":      {"party"},
		"member:remove":      {"party"},
		"character:create":   {"party"},
		"character:edit:any": {"party"},
		"token:issue":        {"party"},
		"session:run":        {"session"},
		"test:call":          {"session"},
		"request:resolve":    {"session"},
		"encounter:run":      {"combat"},
		"codex:write":        {"codex"},
		"codex:reveal":       {"codex"},
		"codex:read_secret":  {"codex.secrets"},
	}
)

func (c Ctx) isOwner() bool {
	return c.UserID != nil && c.CampaignOwnerID != nil && *c.UserID == *c.CampaignOwnerID
}

// CanInCampaign is the seat's permission in its own room. An empty targetActorID means no target.
func CanInCampaign(c Ctx, perm, targetActorID string) bool {
	if c.Seat.Kind == SeatAdmin {
		return true // OPEN AS ADMIN; logged as admin_event
	}
	if slices.Contains(adminOnly, perm) {
		return false
	}
	if slices.Contains(ownerOnly, perm) {
		return c.isOwner()
	}
	role := c.Seat.Role
	if strings.HasSuffix(perm, ":own") {
		// "Mine" means a character this seat holds, never a match on userId: a guest has none, and someone who left the
		// room still owns the retired character but has no seat.
		return targetActorID != "" && slices.Contains(ownGrants[role], perm) && slices.Contains(c.Seat.CharacterIDs, targetActorID)
	}
	if !slices.Contains(seatGrants[role], perm) {
		return false
	}
	if c.Seat.Kind != SeatMember || role != "cogm" {
		return true
	}
	scopes, scoped := cogmScopesFor[perm]
	if !scoped {
		return true
	}
	return slices.ContainsFunc(scopes, func(s string) bool { return slices.Contains(c.Seat.Scopes, s) })
}

// RequirePerm is can(perm) for an action or an op (docs/design.md §5.3, step 3): the permission itself, or the GM-side
// one an :own permission falls back to. It returns the refusal the sender reads, or nil.
func RequirePerm(c Ctx, perm, targetActorID string) *Error {
	if CanInCampaign(c, perm, targetActorID) {
		return nil
	}
	if fallback, ok := OwnFallback[perm]; ok && CanInCampaign(c, fallback, targetActorID) {
		return nil
	}
	if c.Seat.Kind == SeatToken && c.Seat.Role == "screen" {
		return Fail("screenReadOnly")
	}
	if strings.HasSuffix(perm, ":own") {
		return Fail("notYourCharacter")
	}
	return Fail("noPermission")
}

// CanActOnMember says whether the seat may act on another member's seat. A GM or co-GM acts on players only; only the
// owner acts on a GM or co-GM, and nobody on the owner, who hands the room on instead.
func CanActOnMember(c Ctx, targetUserID, targetRole string) bool {
	if c.CampaignOwnerID != nil && targetUserID == *c.CampaignOwnerID {
		return false
	}
	if c.Seat.Kind == SeatAdmin || c.isOwner() {
		return true
	}
	return c.Seat.Kind == SeatMember && c.Seat.Role != "player" && targetRole == "player"
}

// CanGrantRole says whether the seat may hand out role. Players only, unless you own the room.
func CanGrantRole(c Ctx, role string) bool {
	if c.Seat.Kind == SeatAdmin || c.isOwner() {
		return true
	}
	return role == "player" && CanInCampaign(c, "member:invite", "")
}

// GMPermOf is the permission that puts a seat on the GM side of one actor: the party scope for the party's characters,
// combat for every other kind (house decision #31).
func GMPermOf(kind string) string {
	if kind == "pc" || kind == "companion" {
		return "character:edit:any"
	}
	return "encounter:run"
}
