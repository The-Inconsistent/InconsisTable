// Package coreschema is the Go twin of packages/core-schema: refusals, seats, permissions and REST shapes. The web keeps
// the TypeScript one, and vectors/core.ts holds the two equal (docs/adr/0008-go-api.md).
package coreschema

import "encoding/json"

// SeatKind says how someone sits at a table.
type SeatKind string

const (
	// SeatMember is a signed-in user's seat.
	SeatMember SeatKind = "member"
	// SeatToken is a guest's character or the table's TV. Neither is a membership.
	SeatToken SeatKind = "token"
	// SeatAdmin is OPEN AS ADMIN: the admin key at a table, with no user and no seat.
	SeatAdmin SeatKind = "admin"
)

// Seat is who someone is at one table. A seat is per campaign, never per account.
type Seat struct {
	Kind SeatKind
	// Role is gm, cogm or player for a member, player or screen for a token, and empty for an admin.
	Role string
	// Scopes is what the owner handed a co-GM. Only a member has them.
	Scopes       []string
	CharacterIDs []string
}

// MarshalJSON writes the shape the web's Me schema parses, whose fields depend on the kind.
func (s Seat) MarshalJSON() ([]byte, error) {
	characters := s.CharacterIDs
	if characters == nil {
		characters = []string{}
	}
	switch s.Kind {
	case SeatMember:
		scopes := s.Scopes
		if scopes == nil {
			scopes = []string{}
		}
		return json.Marshal(map[string]any{"kind": s.Kind, "role": s.Role, "scopes": scopes, "characterIds": characters})
	case SeatToken:
		return json.Marshal(map[string]any{"kind": s.Kind, "role": s.Role, "characterIds": characters})
	}
	return json.Marshal(map[string]any{"kind": s.Kind})
}

// Ctx is the caller at one table.
type Ctx struct {
	CampaignID string `json:"campaignId"`
	// UserID is nil for token seats and the admin key.
	UserID *string `json:"userId"`
	// CampaignOwnerID is nil while an owner-less room waits for an admin.
	CampaignOwnerID *string `json:"campaignOwnerId"`
	Seat            Seat    `json:"seat"`
}

// SeatRole is the role a seat acts as; an admin acts as a GM.
func (s Seat) SeatRole() string {
	if s.Kind == SeatAdmin {
		return "gm"
	}
	return s.Role
}
