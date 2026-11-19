package encounter

import (
	"context"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/ruleset/compiled"
)

// The tracker's rows (apps/api/src/encounter/encounter.combatants.ts).

// Ranked is one combatant as the tracker orders it.
type Ranked struct {
	ID, ActorID     string
	InitiativeScore *int
	Ord             int
}

// ordered is the combatants of one encounter in turn order.
func ordered(ctx context.Context, conn core.Conn, encounterID string) ([]Ranked, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, actor_id::text, initiative_score, ord FROM combatant WHERE encounter_id = $1
		ORDER BY ord, id`, encounterID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Ranked, error) {
		var c Ranked
		return c, r.Scan(&c.ID, &c.ActorID, &c.InitiativeScore, &c.Ord)
	})
}

// renumber writes `ord` 0..n-1 in the order given.
func renumber(ctx context.Context, tx core.Conn, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `UPDATE combatant c SET ord = u.n::int - 1
		FROM unnest($1::uuid[]) WITH ORDINALITY AS u(v, n) WHERE c.id = u.v`, ids)
	return err
}

// rerank ranks the whole encounter again by initiative (those without one last) and numbers it.
func rerank(ctx context.Context, tx core.Conn, encounterID string) error {
	rows, err := ordered(ctx, tx, encounterID)
	if err != nil {
		return err
	}
	return renumber(ctx, tx, RankIDs(rows))
}

// sideFor is the side an actor joins (house decision #60). With a sides order a given side must be one of the manifest's;
// none given, the actor joins the side that lists its entity type, and one on no side is refused by name. With any other
// order the side must be party, foe or other.
func sideFor(rules *engine.CompiledRuleset, given, entity, name string) (string, error) {
	var init *engine.Initiative
	if rules != nil {
		init = rules.Ruleset.Initiative
	}
	if init == nil || init.Strategy != "sides" {
		if !slices.Contains([]string{"party", "foe", "other"}, given) {
			return "", cs.Fail("badInput", cs.Params{"detail": "side is party, foe or other"})
		}
		return given, nil
	}
	if given != "" {
		if !slices.ContainsFunc(init.Sides, func(s engine.Side) bool { return s.ID == given }) {
			return "", cs.Fail("badInput", cs.Params{"detail": `"` + given + `" is not a side of this game`})
		}
		return given, nil
	}
	for _, s := range init.Sides {
		if s.Entities != nil && slices.Contains(*s.Entities, entity) {
			return s.ID, nil
		}
	}
	return "", cs.Fail("wrongState", cs.Params{"detail": name + " is on no side"})
}

// AddCombatants puts actors of this campaign into an encounter. The caller has checked the encounter is the campaign's;
// the actors are looked up here against campaignID, never trusted from the client. side is "" to let a sides order place
// each actor by its entity type.
func AddCombatants(ctx context.Context, tx core.Conn, campaignID, encounterID string, actorIDs []string, side, visibility string) error {
	wanted := []string{}
	for _, id := range actorIDs {
		if !slices.Contains(wanted, id) {
			wanted = append(wanted, id)
		}
	}
	rows, err := tx.Query(ctx, `SELECT id::text, name, coalesce(entity_type, '') FROM actor WHERE campaign_id = $1 AND id = ANY($2::uuid[])`, campaignID, wanted)
	if err != nil {
		return err
	}
	type found struct{ id, name, entity string }
	actors, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (found, error) {
		var f found
		return f, r.Scan(&f.id, &f.name, &f.entity)
	})
	if err != nil {
		return err
	}
	if len(actors) != len(wanted) {
		return cs.Fail("characterNotFound")
	}
	present, err := ordered(ctx, tx, encounterID)
	if err != nil {
		return err
	}
	next := 0
	for _, c := range present {
		next = max(next, c.Ord+1)
	}
	for _, a := range actors {
		if slices.ContainsFunc(present, func(c Ranked) bool { return c.ActorID == a.id }) {
			return cs.Fail("alreadyInFight", cs.Params{"name": a.name})
		}
	}
	rules, err := compiled.Load(ctx, tx, campaignID)
	if err != nil {
		return err
	}
	sides := map[string]string{}
	for _, a := range actors {
		if sides[a.id], err = sideFor(rules, side, a.entity, a.name); err != nil {
			return err
		}
	}
	for i, actorID := range wanted {
		if _, err := tx.Exec(ctx, `INSERT INTO combatant (encounter_id, actor_id, side, visibility, ord) VALUES ($1, $2, $3, $4, $5)`,
			encounterID, actorID, sides[actorID], visibility, next+i); err != nil {
			return err
		}
	}
	return rerank(ctx, tx, encounterID)
}

// ownCombatant is one combatant of the campaign's running encounter, or a refusal: its id and its encounter's.
func ownCombatant(ctx context.Context, conn core.Conn, campaignID, id string) (string, error) {
	var encounterID string
	err := conn.QueryRow(ctx, `SELECT c.encounter_id::text FROM combatant c JOIN encounter e ON e.id = c.encounter_id
		WHERE c.id = $1 AND e.campaign_id = $2 AND e.active`, id, campaignID).Scan(&encounterID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", cs.Fail("notInFight")
	}
	return encounterID, err
}
