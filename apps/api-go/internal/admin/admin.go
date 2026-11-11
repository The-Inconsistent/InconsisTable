// Package admin holds the admin event log. This phase ports what the table socket writes to it.
package admin

import (
	"context"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
)

// KeyActor names the admin key in admin_event: the key is no user.
const KeyActor = "admin-key"

// LogAdminKey records that the admin key did something: opened a room (room.open) or sent a socket action
// (key.action, detail names it). An empty campaignID logs no room.
func LogAdminKey(ctx context.Context, conn core.Conn, action, campaignID, detail string) error {
	var campaign *string
	if campaignID != "" {
		campaign = &campaignID
	}
	_, err := conn.Exec(ctx, `INSERT INTO admin_event (actor_user_id, action, campaign_id, detail) VALUES ($1, $2, $3, $4)`,
		KeyActor, action, campaign, detail)
	return err
}
