package table

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// Records a hero gains in play (house decision #88), on the harm fixture with what sample-harm 0.1.3 adds: growths kept
// in the hero's `growths` list, seen by name only by its player and the GM side; the Omen picks the Lesser or the
// Greater table, the Lesser adds 10 per growth held and its top line sends the GM on to the Greater.

const heldParts = `{
	"growth": {"id": "growth", "label": "Growth", "base": "ability", "fields": {}},
	"held": {"growth": {"label": "Growths", "entry": "growth", "field": "growths", "entities": ["hero"], "unseen": "Unseen",
		"max": 2, "cite": "Fixture p.11"}},
	"tables": {
		"omen": {"title": "Omen", "die": "d6", "visibility": "gm", "cite": "Fixture p.11", "entries": [
			{"id": "faint", "label": "Faint", "range": [1, 3], "next": "lesser"},
			{"id": "stark", "label": "Stark", "range": [4, 6], "next": "greater"}]},
		"lesser": {"title": "Lesser Growths", "die": "d66", "visibility": "gm", "cite": "Fixture p.12", "entities": ["hero"],
			"modifier": "count(growths) * 10", "entries": [
			{"id": "horn", "label": "Horn", "range": [11, 36], "apply": [{"kind": "grant", "held": "growth", "entry": "horn"}]},
			{"id": "scales", "label": "Scales", "range": [41, 56], "apply": [{"kind": "grant", "held": "growth", "entry": "scales"}]},
			{"id": "worse", "label": "Worse", "range": [61], "next": "greater"}]},
		"greater": {"title": "Greater Growths", "die": "d6", "visibility": "gm", "cite": "Fixture p.13", "entities": ["hero"],
			"entries": [
			{"id": "wings", "label": "Wings", "range": [1, 3], "apply": [{"kind": "grant", "held": "growth", "entry": "wings"}]},
			{"id": "eye", "label": "Third Eye", "range": [4, 6], "apply": [{"kind": "grant", "held": "growth", "entry": "third-eye"}]}]}
	}
}`

func newHeldPlay(t *testing.T, tx pgx.Tx, tweaks ...func(m map[string]any)) *play {
	var m, extra map[string]any
	if err := json.Unmarshal([]byte(harmFixture), &m); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(heldParts), &extra); err != nil {
		t.Fatal(err)
	}
	entities := m["entities"].([]any)
	hero := entities[0].(map[string]any)
	hero["fields"].(map[string]any)["growths"] = map[string]any{"type": "list", "label": "Growths", "visibility": "owner"}
	m["entities"] = append(entities, extra["growth"])
	m["held"], m["tables"] = extra["held"], extra["tables"]
	for _, tweak := range tweaks {
		tweak(m)
	}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, string(out))
	dbtest.Exec(t, tx, `INSERT INTO session (campaign_id, number) VALUES ($1, 1)`, room.ID)
	p := &play{t, tx, room}
	p.attachGrowths()
	return p
}

// attachGrowths attaches a pack of growths, each adding to a hero's wound limit; Third Eye is left out of it.
func (p *play) attachGrowths() {
	p.t.Helper()
	tx, room := p.tx, p.room
	rulesetVersion := dbtest.Scalar[string](p.t, tx, `SELECT ruleset_version_id::text FROM campaign WHERE id = $1`, room.ID)
	rs := dbtest.Scalar[string](p.t, tx, `SELECT ruleset_id::text FROM ruleset_version WHERE id = $1`, rulesetVersion)
	pack := dbtest.Scalar[string](p.t, tx, `INSERT INTO pack (owner_user_id, slug, ruleset_id, license) VALUES ($1, 'p-growths', $2, 'private')
		RETURNING id::text`, room.Owner, rs)
	version := dbtest.Scalar[string](p.t, tx, `INSERT INTO pack_version (pack_id, version, hash, ruleset_version_id, ruleset_range, sources, entry_count, bytes)
		VALUES ($1, '1.0.0', 'h', $2, '^1', '[]', 3, 0) RETURNING id::text`, pack, rulesetVersion)
	for key, add := range map[string]int{"horn": 1, "scales": 2, "wings": 1} {
		effects := `[{"path": "derived.limit", "mode": "add", "value": "` + string(rune('0'+add)) + `", "phase": "derived"}]`
		dbtest.Exec(p.t, tx, `INSERT INTO pack_entry (pack_version_id, key, type, name, tags, visibility, cite, content_hash, body, effects)
			VALUES ($1, $2, 'growth', initcap($2), '{}', 'gm', 'Fixture p.14', 'h', '{}', $3)`, version, key, effects)
	}
	dbtest.Exec(p.t, tx, `INSERT INTO campaign_pack (campaign_id, pack_version_id) VALUES ($1, $2)`, room.ID, version)
}

func (p *play) growths(id string) []string {
	return dbtest.Scalar[[]string](p.t, p.tx, `SELECT coalesce(array_agg(text_value ORDER BY ordinal), '{}') FROM actor_field
		WHERE actor_id = $1 AND field_id = 'growths'`, id)
}

func (p *play) limit(c cs.Ctx, id string) float64 {
	p.t.Helper()
	for _, a := range p.seatView(c).State.Actors {
		if a.ID == id {
			return a.Derived["limit"]
		}
	}
	p.t.Fatalf("no actor %s in the view", id)
	return 0
}

func grant(table, actorID string, result int) map[string]any {
	return map[string]any{"type": "table.apply", "tableId": table, "result": float64(result), "actorId": actorID}
}

func TestAChainEndsInAGrantThatFeedsTheNumbersAndUndoTakesBack(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newHeldPlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		// Grit 2: a wound limit of 5. The Omen sends the GM to the Lesser table; reading it grants nothing.
		r := p.send(gm, map[string]any{"type": "table.roll", "tableId": "omen", "result": 2.0})
		if r.Roll.EntryID != "faint" || len(p.growths(hal)) != 0 {
			t.Fatalf("want Faint and nothing held, got %+v and %v", r.Roll, p.growths(hal))
		}
		// 23 on the Lesser: Horn, held at the end of the list, and the limit is 6.
		r = p.send(gm, grant("lesser", hal, 23))
		if r.Roll.EntryID != "horn" || strings.Join(p.growths(hal), ",") != "horn" || p.limit(gm, hal) != 6 {
			t.Fatalf("want Horn held and a limit of 6, got %+v, %v, %v", r.Roll, p.growths(hal), p.limit(gm, hal))
		}
		// One held: 43 reads 53, Scales.
		r = p.send(gm, grant("lesser", hal, 43))
		if r.Roll.Total != 53 || strings.Join(p.growths(hal), ",") != "horn,scales" || p.limit(gm, hal) != 8 {
			t.Fatalf("want Scales at 53 and a limit of 8, got %+v, %v, %v", r.Roll, p.growths(hal), p.limit(gm, hal))
		}
		// Undo takes the grant back, and the number with it.
		p.send(gm, undo)
		if strings.Join(p.growths(hal), ",") != "horn" || p.limit(gm, hal) != 6 {
			t.Fatalf("undo left %v and a limit of %v", p.growths(hal), p.limit(gm, hal))
		}
	})
}

func TestAGrantIsRefusedForADuplicateAFullKindOrAnEntryNotServed(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newHeldPlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		p.send(gm, grant("greater", hal, 2))
		// Wings again: the GM rolls again on that table.
		_, err := p.try(gm, grant("greater", hal, 1))
		refusal, ok := err.(*cs.Error)
		if !ok || refusal.Code != "heldAlready" || refusal.Params["entry"] != "Wings" || refusal.Params["name"] != "Hal" {
			t.Fatalf("want heldAlready naming Hal and Wings, got %v", err)
		}
		p.refused(gm, grant("greater", hal, 5), "heldNoEntry")
		p.send(gm, grant("lesser", hal, 13))
		p.refused(gm, grant("lesser", hal, 31), "heldFull")
		if strings.Join(p.growths(hal), ",") != "wings,horn" {
			t.Fatalf("a refusal wrote: %v", p.growths(hal))
		}
	})
}

func TestTheGmCutsARecordOffAndUndoGivesItBack(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newHeldPlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		player := p.room.Seat(t, tx, dbtest.User(t, tx, "Ana"), hal)
		p.send(gm, grant("lesser", hal, 23))
		cut := map[string]any{"type": "held.remove", "actorId": hal, "held": "growth", "entry": "horn"}
		p.refused(player, cut, "noPermission")
		p.refused(gm, map[string]any{"type": "held.remove", "actorId": hal, "held": "nope", "entry": "horn"}, "noHeldKind")
		p.refused(gm, map[string]any{"type": "held.remove", "actorId": hal, "held": "growth", "entry": "wings"}, "heldNotHeld")
		p.send(gm, cut)
		if len(p.growths(hal)) != 0 || p.limit(gm, hal) != 5 {
			t.Fatalf("want nothing held and a limit of 5, got %v, %v", p.growths(hal), p.limit(gm, hal))
		}
		p.send(gm, undo)
		if strings.Join(p.growths(hal), ",") != "horn" || p.limit(gm, hal) != 6 {
			t.Fatalf("undo left %v and a limit of %v", p.growths(hal), p.limit(gm, hal))
		}
	})
}

func TestAnotherSeatSeesTheNumbersButNotTheName(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newHeldPlay(t, tx)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		pip := p.hero("Pip", 0, 0)
		ana := p.room.Seat(t, tx, dbtest.User(t, tx, "Ana"), hal)
		bo := p.room.Seat(t, tx, dbtest.User(t, tx, "Bo"), pip)
		p.send(gm, grant("lesser", hal, 43))
		heldOf := func(c cs.Ctx) []cs.HeldRecord {
			for _, a := range p.seatView(c).State.Actors {
				if a.ID == hal {
					return a.Held
				}
			}
			return nil
		}
		for _, c := range []cs.Ctx{gm, ana} {
			if h := heldOf(c); len(h) != 1 || h[0].Name != "Scales" || h[0].Key == nil || *h[0].Key != "scales" {
				t.Fatalf("the holder and the GM read the name: %+v", h)
			}
		}
		h := heldOf(bo)
		if len(h) != 1 || h[0].Name != "Unseen" || h[0].Key != nil || h[0].Cite != nil || len(h[0].Effects) != 1 {
			t.Fatalf("another player reads the word and the effects only: %+v", h)
		}
		if p.limit(bo, hal) != p.limit(gm, hal) {
			t.Fatalf("the numbers differ: %v and %v", p.limit(bo, hal), p.limit(gm, hal))
		}
		whole, err := json.Marshal(p.seatView(bo))
		if err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{"Scales", `"scales"`, "Fixture p.14"} {
			if strings.Contains(string(whole), secret) {
				t.Fatalf("another player's seat received %s", secret)
			}
		}
	})
}

// A record that brings others with it (house decision #165): Scales includes Horn, Wings and a growth the room is not
// served; a grant of Scales adds Wings, skips the Horn already held and the one not served, and Scales twice is refused.
func TestAGrantBringsTheRecordsItIncludesThatAreNotHeld(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newHeldPlay(t, tx, func(m map[string]any) {
			kind := m["held"].(map[string]any)["growth"].(map[string]any)
			kind["includes"], kind["max"] = "with", 3.0
			for _, e := range m["entities"].([]any) {
				if e := e.(map[string]any); e["id"] == "growth" {
					e["fields"] = map[string]any{"with": map[string]any{"type": "list", "label": "With"}}
				}
			}
		})
		dbtest.Exec(t, tx, `UPDATE pack_entry SET body = '{"with": ["horn", "wings", "gone", "scales"]}' WHERE key = 'scales'`)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		p.send(gm, grant("lesser", hal, 13))
		p.send(gm, grant("lesser", hal, 31)) // 31 and one growth held read 41: Scales
		if got := strings.Join(p.growths(hal), ","); got != "horn,scales,wings" {
			t.Fatalf("want horn,scales,wings, got %s", got)
		}
		p.refused(gm, grant("lesser", hal, 21), "heldAlready") // 21 and three held read 51: Scales again
		if got := strings.Join(p.growths(hal), ","); got != "horn,scales,wings" {
			t.Fatalf("a refusal wrote: %s", got)
		}
	})
}

// A record's extras (house decision #191): Scales asks for two more rolls and brings a claw the hero then carries (a
// second claw, and an arm the room is not served, add nothing); a unique arm held already is not given again.
func TestAGrantGivesTheRecordsGearAndSaysHowManyMoreToRoll(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := newHeldPlay(t, tx, func(m map[string]any) {
			kind := m["held"].(map[string]any)["growth"].(map[string]any)
			kind["extraRolls"], kind["gear"] = "more", map[string]any{"field": "arms", "kind": "carried"}
			for _, e := range m["entities"].([]any) {
				if e := e.(map[string]any); e["id"] == "growth" {
					e["fields"] = map[string]any{"more": map[string]any{"type": "int", "label": "More"},
						"arms": map[string]any{"type": "list", "label": "Arms"}}
				}
			}
			m["entities"] = append(m["entities"].([]any), map[string]any{"id": "arm", "label": "Arm", "base": "item", "fields": map[string]any{}})
			m["items"] = map[string]any{"kinds": []any{map[string]any{"id": "carried", "label": "Carried arms", "entry": "arm",
				"entities": []any{"hero"}, "unique": true, "cite": "Fixture p.17"}}}
		})
		version := dbtest.Scalar[string](t, tx, `SELECT pack_version_id::text FROM pack_entry WHERE key = 'scales'`)
		dbtest.Exec(t, tx, `INSERT INTO pack_entry (pack_version_id, key, type, name, tags, visibility, cite, content_hash, body)
			VALUES ($1, 'claw', 'arm', 'Claw', '{}', 'gm', 'Fixture p.17', 'h', '{}')`, version)
		dbtest.Exec(t, tx, `UPDATE pack_entry SET body = '{"more": 2, "arms": ["claw", "claw", "gone"]}' WHERE key = 'scales'`)
		dbtest.Exec(t, tx, `UPDATE pack_entry SET body = '{"arms": ["claw"]}' WHERE key = 'horn'`)
		gm := p.room.GM()
		hal := p.hero("Hal", 0, 0)
		r := p.send(gm, grant("lesser", hal, 41))
		if len(r.Notices) != 1 || r.Notices[0].Code != "extraRolls" || r.Notices[0].Params["entry"] != "Scales" ||
			r.Notices[0].Params["count"] != 2 {
			t.Fatalf("want one extraRolls notice for Scales, 2, got %+v", r.Notices)
		}
		carried := func() string {
			return strings.Join(dbtest.Scalar[[]string](t, tx, `SELECT coalesce(array_agg(entry_key ORDER BY ordinal), '{}')
				FROM actor_item WHERE actor_id = $1 AND kind = 'carried'`, hal), ",")
		}
		if got := carried(); got != "claw" {
			t.Fatalf("want one claw carried, got %q", got)
		}
		// Horn brings a claw too: already held, so nothing more, and no notice without extra rolls.
		if r := p.send(gm, grant("lesser", hal, 13)); len(r.Notices) != 0 || carried() != "claw" {
			t.Fatalf("want nothing more, got %q and %+v", carried(), r.Notices)
		}
	})
}
