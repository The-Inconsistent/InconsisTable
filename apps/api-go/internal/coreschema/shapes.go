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
	// Join is the body of POST /api/join.
	Join = schema.Object(schema.Req("token", schema.String().Min(1).Max(200)))
)
