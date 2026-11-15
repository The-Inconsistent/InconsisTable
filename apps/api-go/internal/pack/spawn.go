package pack

import (
	"context"
	"regexp"
	"strconv"
	"unicode/utf16"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/actor"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter/turn"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/view"
)

// actor.spawn (apps/api/src/actor/actor.spawn.ts). It lives here, not in internal/actor, because it reads the served
// entries and joins the fight, and both of those packages import actor.

const maxName = 100

// The first n UTF-16 units of s, as JavaScript's slice counts them.
func sliceUnits(s string, n int) string {
	units := utf16.Encode([]rune(s))
	if len(units) <= n {
		return s
	}
	return string(utf16.Decode(units[:n]))
}

// SpawnNames is "<base> 1".."<base> N", continuing after the highest number already used with that base name.
func SpawnNames(existing []string, base string, count int) []string {
	stem := sliceUnits(base, maxName-4)
	pattern := regexp.MustCompile(`^` + regexp.QuoteMeta(stem) + ` ([0-9]+)$`)
	last := 0.0
	for _, name := range existing {
		if m := pattern.FindStringSubmatch(name); m != nil {
			n, _ := strconv.ParseFloat(m[1], 64)
			last = max(last, n)
		}
	}
	names := make([]string, count)
	for i := range names {
		names[i] = stem + " " + strconv.FormatFloat(last+float64(i)+1, 'f', -1, 64)
	}
	return names
}

// Spawn is actor.spawn: N creatures from one entry of a pack attached to this room. A pack version never changes, so
// the rows copied from its body are the snapshot (no stat block column); later edits to the creature are its own.
func Spawn(ctx context.Context, tx core.Conn, c cs.Ctx, a cs.Action) (cs.Result, error) {
	cid := c.CampaignID
	rules, err := compiled.Load(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if rules == nil {
		return cs.Result{}, cs.Fail("noRuleset")
	}
	entries, err := LoadServedEntries(ctx, tx, cid, ServedOptions{PackVersionID: a.Str("packVersionId")})
	if err != nil {
		return cs.Result{}, err
	}
	var stored *StoredEntry
	for i := range entries {
		if entries[i].Key == a.Str("key") {
			stored = &entries[i]
			break
		}
	}
	if stored == nil {
		return cs.Result{}, cs.Fail("entryNotInPack")
	}
	// A gm entry the seat cannot read is told as absent, so the reply does not reveal which gm keys exist.
	entry := EntryLookup([]StoredEntry{*stored}, view.ReadsGM(c))(stored.Type, stored.Key)
	if entry == nil {
		return cs.Result{}, cs.Fail("entryNotInPack")
	}
	if ce, ok := rules.Entities[entry.Type]; !ok || ce.Def.Base != "actor" {
		return cs.Result{}, cs.Fail("notPlaceable", cs.Params{"name": entry.Name})
	}

	rows, err := tx.Query(ctx, `SELECT name FROM actor WHERE campaign_id = $1 AND starts_with(name, $2)`,
		cid, sliceUnits(entry.Name, maxName-4)+" ")
	if err != nil {
		return cs.Result{}, err
	}
	taken, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return cs.Result{}, err
	}
	count, _ := a["count"].(float64)
	temporary, _ := a["temporary"].(bool)
	made := []string{}
	targets := []actor.StartTarget{}
	for _, name := range SpawnNames(taken, entry.Name, int(count)) {
		var id string
		if err := tx.QueryRow(ctx, `INSERT INTO actor (campaign_id, kind, entity_type, name, temporary, ruleset_version_id)
			VALUES ($1, 'creature', $2, $3, $4, (SELECT ruleset_version_id FROM campaign WHERE id = $1)) RETURNING id::text`,
			cid, entry.Type, name, temporary).Scan(&id); err != nil {
			return cs.Result{}, err
		}
		made = append(made, id)
		targets = append(targets, actor.StartTarget{ActorID: id, Fields: entry.Body})
	}
	id, err := actor.WriteStart(ctx, tx, c, rules, targets)
	if err != nil {
		return cs.Result{}, err
	}
	// A fight is on: the creatures join it, unseen by the table until the GM shows them.
	fight, err := turn.Active(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if fight != nil {
		if err := encounter.AddCombatants(ctx, tx, cid, fight.ID, made, "foe", "hidden"); err != nil {
			return cs.Result{}, err
		}
	}
	return cs.Done(id), nil
}
