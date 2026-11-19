package campaign

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Campaign values and a change of version (house decision #58). The manifests are our own invention.

// withFields declares the campaign fields every test below starts from.
func withFields(m map[string]any) {
	m["campaignFields"] = map[string]any{
		"danger": map[string]any{"type": "int", "label": "Danger", "min": 1, "max": 5, "default": 2, "cite": "Fixture p.4"},
		"edge":   map[string]any{"type": "enum", "label": "Edge", "values": []any{"open", "closed"}, "default": "open", "cite": "Fixture p.4"},
		"dark":   map[string]any{"type": "bool", "label": "Dark", "default": false, "cite": "Fixture p.4"},
		"luck":   map[string]any{"type": "int", "label": "Luck", "min": 0, "max": 9, "default": 0, "cite": "Fixture p.4"},
	}
}

func storeFields(t *testing.T, tx pgx.Tx, room dbtest.Room) {
	t.Helper()
	dbtest.Exec(t, tx, `INSERT INTO campaign_field (campaign_id, field_id, int_value) VALUES ($1, 'danger', 4), ($1, 'dark', 1), ($1, 'luck', 5)`, room.ID)
	dbtest.Exec(t, tx, `INSERT INTO campaign_field (campaign_id, field_id, text_value) VALUES ($1, 'edge', 'closed')`, room.ID)
}

func fieldIDs(t *testing.T, tx pgx.Tx, room dbtest.Room) string {
	t.Helper()
	return dbtest.Scalar[string](t, tx, `SELECT coalesce(string_agg(field_id, ',' ORDER BY field_id), '') FROM campaign_field WHERE campaign_id = $1`, room.ID)
}

func TestAVersionThatCannotHoldACampaignValueIsRefused(t *testing.T) {
	db := dbtest.Open(t)
	cases := []struct {
		name, want string
		change     func(f map[string]any)
	}{
		{"gone", `table: campaign field "danger" is gone`, func(f map[string]any) { delete(f, "danger") }},
		{"type changed", `table: campaign field "danger" changed type`, func(f map[string]any) {
			f["danger"] = map[string]any{"type": "enum", "label": "Danger", "values": []any{"low", "high"}, "default": "low", "cite": "Fixture p.4"}
		}},
		{"no longer fits", `table: campaign field "danger": above the maximum of 3`, func(f map[string]any) {
			f["danger"].(map[string]any)["max"] = 3
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dbtest.Tx(t, db, func(tx pgx.Tx) {
				u := newUpgrade(t, tx)
				a := u.add("0.2.0", withFields)
				if err := u.switchTo(a); err != nil {
					t.Fatal(err)
				}
				storeFields(t, tx, u.room)
				b := u.add("0.3.0", func(m map[string]any) {
					withFields(m)
					c.change(m["campaignFields"].(map[string]any))
				})
				if detail := u.refused(b, "versionNotCompatible"); !strings.Contains(detail, c.want) {
					t.Fatalf("detail %q lacks %q", detail, c.want)
				}
				if got := dbtest.Scalar[string](t, tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, u.room.ID); got != a {
					t.Fatalf("a refused switch moved the pin to %s", got)
				}
				if got := fieldIDs(t, tx, u.room); got != "danger,dark,edge,luck" {
					t.Fatalf("a refused switch changed the values: %s", got)
				}
			})
		})
	}
}

func TestARoomWithNoCharacterDropsTheValuesTheNewVersionCannotHold(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, variant(t, withFields))
		storeFields(t, tx, room)
		v1 := dbtest.Scalar[string](t, tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, room.ID)
		rs := dbtest.Scalar[string](t, tx, `SELECT ruleset_id::text FROM ruleset_version WHERE id = $1`, v1)
		v2 := room.AddVersion(t, tx, variant(t, func(m map[string]any) {
			withFields(m)
			f := m["campaignFields"].(map[string]any)
			f["danger"].(map[string]any)["max"] = 3                      // 4 no longer fits
			f["edge"].(map[string]any)["values"] = []any{"open", "ajar"} // "closed" no longer fits
			delete(f, "dark")                                            // gone
		}), "0.2.0", rs)
		if _, err := SetRuleset(context.Background(), tx, room.GM(), cs.Action{"rulesetVersionId": v2}); err != nil {
			t.Fatal(err)
		}
		if got := fieldIDs(t, tx, room); got != "luck" {
			t.Fatalf("want only luck left, got %s", got)
		}
	})
}

func TestUnpinningTheRulesetDeletesTheCampaignValues(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		room := dbtest.NewRoom(t, tx)
		room.Pin(t, tx, variant(t, withFields))
		storeFields(t, tx, room)
		if _, err := UnpinRuleset(context.Background(), tx, room.GM(), cs.Action{}); err != nil {
			t.Fatal(err)
		}
		if got := fieldIDs(t, tx, room); got != "" {
			t.Fatalf("values left: %s", got)
		}
	})
}
