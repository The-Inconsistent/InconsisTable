package pack

import (
	"context"
	"maps"
	"regexp"
	"slices"
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

	// The name the creatures take: the caller's, in the entry's place (house decision #75), numbered the same way.
	base := entry.Name
	named := a.Str("name") != ""
	if named {
		base = a.Str("name")
	}
	rows, err := tx.Query(ctx, `SELECT name FROM actor WHERE campaign_id = $1 AND (starts_with(name, $2) OR name = $3)`,
		cid, sliceUnits(base, maxName-4)+" ", base)
	if err != nil {
		return cs.Result{}, err
	}
	taken, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return cs.Result{}, err
	}
	count, _ := a["count"].(float64)
	temporary, _ := a["temporary"].(bool)
	names := SpawnNames(taken, base, int(count))
	// One creature under the caller's name takes it bare while no actor of the room carries it (house decision #78).
	if named && count == 1 && !slices.Contains(taken, base) {
		names = []string{base}
	}
	body := entry.Body
	var members map[string]float64
	// A mob (house decision #66): one actor standing for N members, its start field and members resource at N.
	if mob, isMob := a["mob"].(float64); isMob {
		if count > 1 {
			return cs.Result{}, cs.Fail("badRequest", cs.Params{"detail": "a mob is one actor: spawn it with a count of 1"})
		}
		harm := rules.Ruleset.Health.Harm
		if harm == nil || harm.Mob == nil || !slices.Contains(rules.Entities[entry.Type].Resources, harm.Mob.Members) {
			return cs.Result{}, cs.Fail("noMobsHere", cs.Params{"name": entry.Name})
		}
		n := strconv.FormatFloat(mob, 'f', -1, 64)
		names = []string{sliceUnits(base, maxName-len(n)-2) + " ×" + n}
		body = map[string]any{harm.Mob.Start: mob}
		maps.Copy(body, entry.Body)
		body[harm.Mob.Start] = mob
		members = map[string]float64{harm.Mob.Members: mob}
	}
	made := []string{}
	targets := []actor.StartTarget{}
	for _, name := range names {
		var id string
		if err := tx.QueryRow(ctx, `INSERT INTO actor (campaign_id, kind, entity_type, name, temporary, ruleset_version_id)
			VALUES ($1, 'creature', $2, $3, $4, (SELECT ruleset_version_id FROM campaign WHERE id = $1)) RETURNING id::text`,
			cid, entry.Type, name, temporary).Scan(&id); err != nil {
			return cs.Result{}, err
		}
		made = append(made, id)
		targets = append(targets, actor.StartTarget{ActorID: id, Fields: body, Resources: members})
	}
	id, err := actor.WriteStart(ctx, tx, c, rules, targets)
	if err != nil {
		return cs.Result{}, err
	}
	// A fight is on: the creatures join it as the caller asked the table to see them, hidden unless it said otherwise.
	// With no fight nothing is kept of it: a creature's fight settings are made when it joins one (house decision #75).
	fight, err := turn.Active(ctx, tx, cid)
	if err != nil {
		return cs.Result{}, err
	}
	if fight != nil {
		// A sides order places a creature by its entity type (house decision #60); any other makes it a foe.
		side := "foe"
		if i := rules.Ruleset.Initiative; i != nil && i.Strategy == "sides" {
			side = ""
		}
		if err := encounter.AddCombatants(ctx, tx, cid, fight.ID, made, side, a.Str("visibility")); err != nil {
			return cs.Result{}, err
		}
	}
	return cs.Done(id), nil
}
