package table

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core/dbtest"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
)

// noticeFixture is the play fixture with notice rules of our own invention (house decision #79): boons left as a session
// starts, a renown step crossed, a line read on a value only the GM sees, and a pool that fills.
func noticeFixture(t *testing.T) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(playFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	res := func(id, editableBy, visibility string, extra map[string]any) map[string]any {
		r := map[string]any{"id": id, "label": id, "cite": "Fixture p.9", "scope": "entity", "min": "0", "max": "12",
			"start": "0", "editableBy": editableBy, "visibility": visibility}
		for k, v := range extra {
			r[k] = v
		}
		return r
	}
	m["resources"] = append(m["resources"].([]any),
		res("boons", "owner", "party", nil),
		res("renown", "owner", "party", map[string]any{"resetOn": []any{map[string]any{"event": "sessionEnd", "to": "max"}}}),
		res("secret", "gm", "gm", nil),
		map[string]any{"id": "stash", "label": "Stash", "cite": "Fixture p.9", "scope": "party", "max": "2", "visibility": "party"},
	)
	rule := func(id, when, cond, text string) map[string]any {
		return map[string]any{"id": id, "when": when, "if": cond, "text": text, "cite": "Fixture p.9"}
	}
	m["notices"] = []any{
		rule("unspent", "sessionStart", "res.boons > 0", "{name} has boons"),
		rule("renowned", "crossed", "floor(res.renown, 4) >= 3", "{name} is renowned"),
		rule("hidden", "crossed", "res.boons >= 1 && res.secret >= 1", "{name} hides something"),
	}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func noticePlay(t *testing.T, tx pgx.Tx) *play {
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, noticeFixture(t))
	return &play{t, tx, room}
}

func adjust(actorID, resource string, delta float64) map[string]any {
	return map[string]any{"type": "rule.op", "primitive": "resource.capped", "op": "adjust",
		"input": map[string]any{"actorId": actorID, "resource": resource, "delta": delta}}
}

func wantNotices(t *testing.T, r Result, want ...cs.Notice) {
	t.Helper()
	if len(want) == 0 && len(r.Notices) == 0 {
		return
	}
	if !reflect.DeepEqual(r.Notices, want) {
		t.Fatalf("notices: want %v, got %v", want, r.Notices)
	}
}

func TestASessionsStartAndEndTellTheGMWhatTheRulesetDeclares(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := noticePlay(t, tx)
		gm := p.room.GM()
		ash, bo := p.character("Ash", 2), p.character("Bo", 1)
		p.counters(ash, map[string]int{"boons": 2, "renown": 0})
		p.counters(bo, map[string]int{"renown": 0})

		// Points left are told at every start, once per actor that has them.
		wantNotices(t, p.send(gm, map[string]any{"type": "session.start"}),
			cs.RuleNotice("unspent", "Ash", "Ash has boons"))
		// The end refills Renown: both cross the top step, once each.
		wantNotices(t, p.send(gm, map[string]any{"type": "session.end", "recap": ""}),
			cs.RuleNotice("renowned", "Ash", "Ash is renowned"), cs.RuleNotice("renowned", "Bo", "Bo is renowned"))
		wantNotices(t, p.send(gm, map[string]any{"type": "session.start"}),
			cs.RuleNotice("unspent", "Ash", "Ash has boons"))
		// Already over the line before the action: nothing is crossed again.
		wantNotices(t, p.send(gm, map[string]any{"type": "session.end", "recap": ""}))
	})
}

func TestACrossedLineIsToldOnlyToTheSeatThatCrossedItAndOnlyIfItMaySeeIt(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := noticePlay(t, tx)
		gm := p.room.GM()
		p.startSession()
		ash := p.character("Ash", 2)
		alice := p.room.Seat(t, tx, dbtest.User(t, tx, "Alice"), ash)
		p.counters(ash, map[string]int{"renown": 8, "secret": 1, "boons": 0})

		wantNotices(t, p.send(alice, adjust(ash, "renown", 3)))
		wantNotices(t, p.send(alice, adjust(ash, "renown", 1)), cs.RuleNotice("renowned", "Ash", "Ash is renowned"))
		// The GM's next answer does not carry the player's line.
		wantNotices(t, p.send(gm, adjust(ash, "renown", 1)))
		// A boon crosses a line that reads a value only the GM sees: the player is not told it.
		wantNotices(t, p.send(alice, adjust(ash, "boons", 1)))
		p.send(gm, adjust(ash, "boons", -1))
		wantNotices(t, p.send(gm, adjust(ash, "boons", 1)), cs.RuleNotice("hidden", "Ash", "Ash hides something"))
	})
}

func TestAPoolThatCannotTakeTheWholeChangeSaysSo(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := noticePlay(t, tx)
		gm := p.room.GM()
		p.startSession()
		wantNotices(t, p.send(gm, adjustPool("stash", 1)))
		wantNotices(t, p.send(gm, adjustPool("stash", 3)), cs.PoolFull("Stash", 2))
		wantPool(t, p, "stash", 2)
		wantNotices(t, p.send(gm, adjustPool("stash", -1)))
	})
}

// moreNotices is the notice fixture with house decision #168's rules instead: a renown step with its number, raised as
// it rises; every character holding boons as a session starts; any character over a line that reads a value only the GM
// sees.
func moreNotices(t *testing.T, tx pgx.Tx) *play {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(noticeFixture(t)), &m); err != nil {
		t.Fatal(err)
	}
	m["notices"] = []any{
		map[string]any{"id": "step", "when": "crossed", "if": "res.renown > 0", "rises": "floor(res.renown, 4)",
			"params": map[string]any{"step": "floor(res.renown, 4)", "left": "12 - res.renown"},
			"text":   "{name} reached step {step}, {left} to go", "cite": "Fixture p.9"},
		map[string]any{"id": "crew", "when": "sessionStart", "group": "every", "if": "res.boons > 0",
			"text": "Everyone holds boons", "cite": "Fixture p.9"},
		map[string]any{"id": "secrets", "when": "crossed", "group": "any", "if": "res.boons + res.secret > 4",
			"text": "Someone hides something", "cite": "Fixture p.9"},
	}
	out, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	room := dbtest.NewRoom(t, tx)
	room.Pin(t, tx, string(out))
	return &play{t, tx, room}
}

func TestANoticeCarriesItsNumbersRisesStepByStepAndSpeaksForTheGroup(t *testing.T) {
	dbtest.Tx(t, dbtest.Open(t), func(tx pgx.Tx) {
		p := moreNotices(t, tx)
		gm := p.room.GM()
		ash, bo := p.character("Ash", 2), p.character("Bo", 1)
		alice := p.room.Seat(t, tx, dbtest.User(t, tx, "Alice"), ash)
		p.counters(ash, map[string]int{"boons": 2, "renown": 0, "secret": 0})
		p.counters(bo, map[string]int{"boons": 0, "renown": 0, "secret": 0})

		// Not everyone holds boons: no line about the group. Once Bo does, one line, with no name.
		wantNotices(t, p.send(gm, map[string]any{"type": "session.start"}))
		p.send(gm, map[string]any{"type": "session.end", "recap": ""}) // both renown refill to 12 here
		p.send(gm, adjust(bo, "boons", 1))
		wantNotices(t, p.send(gm, map[string]any{"type": "session.start"}), cs.RuleNotice("crew", "", "Everyone holds boons"))

		// Renown rises a step at a time: each step up says its number, a step down or a rise within a step says nothing.
		dbtest.Exec(t, tx, `UPDATE actor_resource SET value = 3 WHERE actor_id = $1 AND resource_id = 'renown'`, ash)
		wantNotices(t, p.send(alice, adjust(ash, "renown", 1)), cs.RuleNotice("step", "Ash", "Ash reached step 1, 8 to go"))
		wantNotices(t, p.send(alice, adjust(ash, "renown", 2)))
		wantNotices(t, p.send(alice, adjust(ash, "renown", -3)))
		wantNotices(t, p.send(alice, adjust(ash, "renown", 5)), cs.RuleNotice("step", "Ash", "Ash reached step 2, 4 to go"))

		// A group line that reads a value only the GM sees reaches the GM side; a player's action that crosses it is not
		// told it.
		wantNotices(t, p.send(alice, adjust(ash, "boons", 3)))
		p.send(gm, adjust(ash, "boons", -3))
		wantNotices(t, p.send(gm, adjust(ash, "boons", 3)), cs.RuleNotice("secrets", "", "Someone hides something"))
		wantNotices(t, p.send(gm, adjust(bo, "secret", 5))) // one already does: the group crossed nothing
	})
}
