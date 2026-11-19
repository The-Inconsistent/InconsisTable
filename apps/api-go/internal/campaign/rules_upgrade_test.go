package campaign

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// A compatible upgrade (house decision #51): characters follow the room to another version of the same ruleset when
// nothing stored would change. The manifests are our own invention.

// variant is dbtest.Fixture with a "stunned" condition, then change applied.
func variant(t *testing.T, change func(m map[string]any)) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(dbtest.Fixture), &m); err != nil {
		t.Fatal(err)
	}
	m["conditions"] = []any{map[string]any{"id": "stunned", "label": "Stunned", "duration": "manual", "cite": "Fixture p.9", "effects": []any{}}}
	if change != nil {
		change(m)
	}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

type upgrade struct {
	tx      pgx.Tx
	t       *testing.T
	room    dbtest.Room
	ruleset string
	v1      string
	actor   string
}

// newUpgrade is a room on version 1 with one built character (level 3, a note, hp, stunned) and a builder draft.
func newUpgrade(t *testing.T, tx pgx.Tx) *upgrade {
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, variant(t, nil))
	v1 := dbtest.Scalar[string](t, tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, room.ID)
	rs := dbtest.Scalar[string](t, tx, `SELECT ruleset_id::text FROM ruleset_version WHERE id = $1`, v1)
	a := character(t, tx, room, "Ada", 5)
	dbtest.Exec(t, tx, `INSERT INTO actor_field (actor_id, field_id, ordinal, text_value) VALUES ($1, 'note', 0, 'hello')`, a)
	dbtest.Exec(t, tx, `INSERT INTO actor_condition (actor_id, condition_id) VALUES ($1, 'stunned')`, a)
	dbtest.Exec(t, tx, `UPDATE actor SET ruleset_version_id = $1 WHERE id = $2`, v1, a)
	dbtest.Exec(t, tx, `INSERT INTO builder_draft (user_id, campaign_id, ruleset_version_id, body) VALUES ($1, $2, $3, '{}')`,
		room.Owner, room.ID, v1)
	return &upgrade{tx, t, room, rs, v1, a}
}

func (u *upgrade) add(version string, change func(m map[string]any)) string {
	return u.room.AddVersion(u.t, u.tx, variant(u.t, change), version, u.ruleset)
}

func (u *upgrade) switchTo(version string) error {
	_, err := SetRuleset(context.Background(), u.tx, u.room.GM(), cs.Action{"rulesetVersionId": version})
	return err
}

func (u *upgrade) refused(version, code string) string {
	u.t.Helper()
	var e *cs.Error
	if err := u.switchTo(version); !errors.As(err, &e) || e.Code != code {
		u.t.Fatalf("want %s, got %v", code, err)
	}
	detail, _ := e.Params["detail"].(string)
	return detail
}

func (u *upgrade) unchanged() {
	u.t.Helper()
	pinned := dbtest.Scalar[string](u.t, u.tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, u.room.ID)
	has := dbtest.Scalar[string](u.t, u.tx, `SELECT ruleset_version_id::text FROM actor WHERE id = $1`, u.actor)
	drafts := dbtest.Scalar[int](u.t, u.tx, `SELECT count(*)::int FROM builder_draft WHERE campaign_id = $1`, u.room.ID)
	if pinned != u.v1 || has != u.v1 || drafts != 1 {
		u.t.Fatalf("a refused switch changed something: pin %s, actor %s, drafts %d", pinned, has, drafts)
	}
}

func TestCompatibleUpgradeMovesTheCharacters(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		u := newUpgrade(t, tx)
		v2 := u.add("0.2.0", func(m map[string]any) {
			m["resources"] = append(m["resources"].([]any), map[string]any{"id": "luck", "label": "Luck", "cite": "Fixture p.10",
				"scope": "entity", "max": "5", "visibility": "party"})
			m["tests"] = map[string]any{"check": map[string]any{"kind": "reported", "cite": "Fixture p.11",
				"outcomes": []any{map[string]any{"id": "ok", "label": "Ok", "cite": "Fixture p.11"},
					map[string]any{"id": "no", "label": "No", "cite": "Fixture p.11"}}}}
			ent := m["entities"].([]any)[0].(map[string]any)
			ent["fields"].(map[string]any)["mood"] = map[string]any{"type": "text", "label": "Mood", "visibility": "party"}
		})
		if err := u.switchTo(v2); err != nil {
			t.Fatal(err)
		}
		if got := dbtest.Scalar[string](t, tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, u.room.ID); got != v2 {
			t.Fatalf("room pinned to %s", got)
		}
		if got := dbtest.Scalar[string](t, tx, `SELECT ruleset_version_id::text FROM actor WHERE id = $1`, u.actor); got != v2 {
			t.Fatalf("actor on %s", got)
		}
		if got := dbtest.Scalar[string](t, tx, `SELECT text_value FROM actor_field WHERE actor_id = $1 AND field_id = 'note'`, u.actor); got != "hello" {
			t.Fatalf("note is %q", got)
		}
		if got := hp(t, tx, u.actor); got != 5 {
			t.Fatalf("hp is %d", got)
		}
		if n := dbtest.Scalar[int](t, tx, `SELECT count(*)::int FROM builder_draft WHERE campaign_id = $1`, u.room.ID); n != 0 {
			t.Fatalf("%d drafts left", n)
		}
		// And back to the older version, whose declarations still fit the values.
		if err := u.switchTo(u.v1); err != nil {
			t.Fatal(err)
		}
		if got := dbtest.Scalar[string](t, tx, `SELECT ruleset_version_id::text FROM actor WHERE id = $1`, u.actor); got != u.v1 {
			t.Fatalf("actor on %s", got)
		}
	})
}

func TestIncompatibleVersionsAreRefusedAndNothingChanges(t *testing.T) {
	db := dbtest.Open(t)
	fields := func(m map[string]any) map[string]any {
		return m["entities"].([]any)[0].(map[string]any)["fields"].(map[string]any)
	}
	cases := []struct {
		name, want string
		change     func(m map[string]any)
	}{
		{"field removed", `Ada: field "note" is gone`, func(m map[string]any) { delete(fields(m), "note") }},
		{"max lowered", `Ada: field "level": above the maximum of 2`, func(m map[string]any) { fields(m)["level"].(map[string]any)["max"] = 2 }},
		{"type changed", `Ada: field "level" changed type`, func(m map[string]any) {
			fields(m)["level"] = map[string]any{"type": "text", "label": "Level", "visibility": "party"}
			// the derived max and initiative read level as a number
			m["entities"].([]any)[0].(map[string]any)["derived"] = []any{}
			m["resources"].([]any)[0].(map[string]any)["max"] = "10"
			delete(m, "initiative")
		}},
		{"condition removed", `Ada: condition "stunned" is gone`, func(m map[string]any) { m["conditions"] = []any{} }},
		{"resource removed", `Ada: resource "focus" is gone`, func(m map[string]any) {
			m["resources"] = m["resources"].([]any)[:1]
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dbtest.Tx(t, db, func(tx pgx.Tx) {
				u := newUpgrade(t, tx)
				dbtest.Exec(t, tx, `INSERT INTO actor_resource (actor_id, resource_id, value) VALUES ($1, 'focus', 1)`, u.actor)
				v2 := u.add("0.2.0", c.change)
				if detail := u.refused(v2, "versionNotCompatible"); !strings.Contains(detail, c.want) {
					t.Fatalf("detail %q lacks %q", detail, c.want)
				}
				u.unchanged()
			})
		})
	}
}

func TestOtherRulesetStillRefusedWhileCharactersAreBuilt(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		u := newUpgrade(t, tx)
		other := u.room.AddVersion(t, tx, strings.Replace(variant(t, nil), `"go-fixture"`, `"go-other"`, 1), "0.1.0", "")
		u.refused(other, "charactersUseOtherVersion")
		u.unchanged()
	})
}

func TestUpgradeWaitsForTheSessionAndTheEncounter(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		u := newUpgrade(t, tx)
		v2 := u.add("0.2.0", nil)
		dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, u.room.ID)
		u.refused(v2, "changeBetweenSessions")
		dbtest.Exec(t, tx, `UPDATE session SET ended_at = now() WHERE campaign_id = $1`, u.room.ID)
		dbtest.Exec(t, tx, `INSERT INTO encounter (campaign_id) VALUES ($1)`, u.room.ID)
		u.refused(v2, "endEncounterFirst")
		u.unchanged()
	})
}

func TestMoreThanFiveProblemsAreCounted(t *testing.T) {
	db := dbtest.Open(t)
	dbtest.Tx(t, db, func(tx pgx.Tx) {
		u := newUpgrade(t, tx)
		for _, n := range []string{"Bo", "Cy", "Di", "Ed"} {
			id := character(t, tx, u.room, n, 1)
			dbtest.Exec(t, tx, `INSERT INTO actor_condition (actor_id, condition_id) VALUES ($1, 'stunned')`, id)
			dbtest.Exec(t, tx, `UPDATE actor SET ruleset_version_id = $1 WHERE id = $2`, u.v1, id)
		}
		v2 := u.add("0.2.0", func(m map[string]any) { m["conditions"] = []any{} })
		// Five characters each miss "stunned": 5 lines, then a sixth from one open Test call.
		dbtest.Exec(t, tx, `INSERT INTO test_call (campaign_id, test_id, inputs, hide_target, show_outcome) VALUES ($1, 'gone', '{}', false, false)`, u.room.ID)
		detail := u.refused(v2, "versionNotCompatible")
		if !strings.HasSuffix(detail, "; and 1 more") || strings.Count(detail, "; ") != 5 {
			t.Fatalf("detail %q", detail)
		}
	})
}
