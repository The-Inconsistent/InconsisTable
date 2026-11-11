package coreschema

import "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"

// DisplayNameMax bounds the name a user goes by at every table.
const DisplayNameMax = 40

// REST shapes, written out from packages/core-schema and apps/api/src/campaign/campaign.controller.ts.
var (
	campaignName = schema.String().Trim().Min(1).Max(100)

	// CampaignID is a campaign id in a route.
	CampaignID = schema.UUID()
	// CreateGame is the body of POST /api/campaigns.
	CreateGame = schema.Object(
		schema.Req("name", campaignName),
		schema.Opt("rulesetVersionId", schema.UUID()),
	)
	// AdminCreate is the same body from a script, naming the device user who will own the new room.
	AdminCreate = schema.Object(
		schema.Req("name", campaignName),
		schema.Opt("rulesetVersionId", schema.UUID()),
		schema.Opt("ownerUserId", schema.String().Min(1).Max(100)),
	)
	// Rename is the body of PATCH /api/me.
	Rename = schema.Object(schema.Req("name", schema.String().Trim().Min(1).Max(DisplayNameMax)))
	// RenameAccount is the body of PATCH /api/account: the account's name at the identity provider. It is also the name
	// tables see, so it keeps the same bound.
	RenameAccount = schema.Object(schema.Req("displayName", schema.String().Trim().Min(1).Max(DisplayNameMax)))
	// Join is the body of POST /api/join.
	Join = schema.Object(schema.Req("token", schema.String().Min(1).Max(200)))
	// InviteCode is an invite's code in a route.
	InviteCode = schema.String().Min(1).Max(200)
	// AcceptInvite is the body of POST /api/invites/{code}/accept: a character to claim or one to start, as a guest or
	// as the signed-in user.
	AcceptInvite = schema.Object(
		schema.Opt("actorId", schema.UUID()),
		schema.Opt("newCharacterName", schema.String().Trim().Min(1).Max(100)),
		schema.Def("asGuest", schema.Bool(), false),
	)
)
