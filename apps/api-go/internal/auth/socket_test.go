package auth

import (
	"context"
	"strings"
	"testing"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
)

// The adminKey handshake opens a room on a LAN or dev api, and is refused once sign-in is on (§7.7).
func TestTheAdminKeyHandshakeIsRefusedWhenSignInIsOn(t *testing.T) {
	db := dbtest.Open(t)
	ctx := context.Background()
	key := strings.Repeat("k", 40)
	t.Setenv("ADMIN_KEY", key)
	var owner, campaignID string
	if err := db.QueryRow(ctx, `INSERT INTO app_user (id, name) VALUES (uuidv7()::text, 'Owner') RETURNING id`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	dropUsers(t, db, owner)
	err := db.QueryRow(ctx, `INSERT INTO campaign (name, owner_user_id) VALUES ('Room', $1) RETURNING id::text`, owner).Scan(&campaignID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), `DELETE FROM campaign WHERE id = $1`, campaignID) })
	handshake := map[string]any{"campaignId": campaignID, "adminKey": key}

	off, err := (&Service{DB: db}).ResolveSocketCtx(ctx, handshake, "")
	if err != nil || off == nil || !off.Script {
		t.Fatalf("sign-in off: want the admin seat, got %+v %v", off, err)
	}
	on, err := (&Service{DB: db, SignIn: true}).ResolveSocketCtx(ctx, handshake, "")
	if err != nil || on != nil {
		t.Fatalf("sign-in on: want unauthorized, got %+v %v", on, err)
	}
}
