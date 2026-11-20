// Package actor holds actors and their typed value rows (docs/design.md §5.4). This phase ports the reads the table
// snapshot needs; the actor actions move in their own phase.
package actor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
	"sort"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
)

// Row is an actor row, as far as the table reads it.
type Row struct {
	ID          string
	Kind        string
	Name        string
	Status      string
	OwnerUserID *string
	EntityType  string
}

// FieldRow is one actor_field row.
type FieldRow struct {
	FieldID string
	Ordinal int
	Int     *int32
	Text    *string
	Ref     *string
}

// ResourceRow is one actor_resource row.
type ResourceRow struct {
	ResourceID  string
	Value       int32
	MaxOverride *int32
}

// ConditionRow is one actor_condition row.
type ConditionRow struct {
	ID           string
	ConditionID  string
	Stacks       int32
	Source       string
	ExpiresOn    string
	ExpiresAfter *int32
}

// ServedPacks is the SQL condition for the pack versions of a room that may be served to anyone: attached, not taken
// down by an admin, and a `private` pack only while its owner is a GM of the room (CLAUDE.md, principle 4). The one
// place this is decided (it lives here, not in package pack, because pack imports this package). It reads campaign_pack and pack, so the query must join both. campaignParam is the
// placeholder holding the campaign id, such as "$1".
func ServedPacks(campaignParam string) string {
	return fmt.Sprintf(`campaign_pack.campaign_id = %[1]s AND pack.disabled_at IS NULL AND (pack.license <> 'private' OR %[2]s)`,
		campaignParam, runsRoom("pack.owner_user_id", campaignParam))
}

// ServedWorld is the SQL condition under which the room's pinned World reaches its seats (house decision #65): not
// taken down, and its owner still runs the room, the rule a private pack follows (principle 4). The query joins `world`.
func ServedWorld(campaignParam string) string {
	return `world.disabled_at IS NULL AND ` + runsRoom("world.owner_user_id", campaignParam)
}

// runsRoom says the user in ownerColumn runs the room: as a GM of it, or, without a GM, as its owner, who counts as the
// one running it (docs/adr/0009-table-modes.md). Only that user's own content: never served on another user's say-so.
func runsRoom(ownerColumn, campaignParam string) string {
	return fmt.Sprintf(`(EXISTS (
		SELECT 1 FROM membership WHERE membership.campaign_id = %[1]s AND membership.user_id = %[2]s AND membership.role = 'gm'
		) OR EXISTS (
		SELECT 1 FROM campaign WHERE campaign.id = %[1]s AND campaign.table_mode <> 'gm' AND campaign.owner_user_id = %[2]s))`,
		campaignParam, ownerColumn)
}

// ChosenEntry is an attached pack entry an actor holds an actor_choice row for, with the step that row belongs to.
type ChosenEntry struct {
	StepID, Type, Key, Name string
	Effects                 []engine.Effect
}

// Rows is one actor with its value rows.
type Rows struct {
	Actor      Row
	Fields     []FieldRow
	Resources  []ResourceRow
	Conditions []ConditionRow
	// Chosen are the entries the actor chose that the attached packs hold, for Build to match against the ruleset.
	Chosen []ChosenEntry
}

// byActor runs a query whose rows each start with an actor id, and groups what scan reads by that id.
func byActor[T any](ctx context.Context, conn core.Conn, sql, campaignID string, scan func(pgx.Rows) (string, T, error)) (map[string][]T, error) {
	rows, err := conn.Query(ctx, sql, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]T{}
	for rows.Next() {
		actorID, v, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out[actorID] = append(out[actorID], v)
	}
	return out, rows.Err()
}

// LoadRows reads every actor of the campaign with its value rows. Five queries, each scoped to the campaign.
func LoadRows(ctx context.Context, conn core.Conn, campaignID string) ([]Rows, error) {
	rows, err := conn.Query(ctx, `SELECT id::text, kind, name, status, owner_user_id, entity_type FROM actor
		WHERE campaign_id = $1 ORDER BY created_at, id`, campaignID)
	if err != nil {
		return nil, err
	}
	actors, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Row, error) {
		var a Row
		err := r.Scan(&a.ID, &a.Kind, &a.Name, &a.Status, &a.OwnerUserID, &a.EntityType)
		return a, err
	})
	if err != nil {
		return nil, err
	}
	fields, err := byActor(ctx, conn, `SELECT f.actor_id::text, f.field_id, f.ordinal, f.int_value, f.text_value, f.ref_key
		FROM actor_field f JOIN actor ON actor.id = f.actor_id WHERE actor.campaign_id = $1
		ORDER BY f.field_id, f.ordinal`, campaignID,
		func(r pgx.Rows) (string, FieldRow, error) {
			var id string
			var f FieldRow
			err := r.Scan(&id, &f.FieldID, &f.Ordinal, &f.Int, &f.Text, &f.Ref)
			return id, f, err
		})
	if err != nil {
		return nil, err
	}
	resources, err := byActor(ctx, conn, `SELECT x.actor_id::text, x.resource_id, x.value, x.max_override
		FROM actor_resource x JOIN actor ON actor.id = x.actor_id WHERE actor.campaign_id = $1`, campaignID,
		func(r pgx.Rows) (string, ResourceRow, error) {
			var id string
			var x ResourceRow
			err := r.Scan(&id, &x.ResourceID, &x.Value, &x.MaxOverride)
			return id, x, err
		})
	if err != nil {
		return nil, err
	}
	conditions, err := byActor(ctx, conn, `SELECT c.actor_id::text, c.id::text, c.condition_id, c.stacks, c.source,
		c.expires_on, c.expires_after FROM actor_condition c JOIN actor ON actor.id = c.actor_id
		WHERE actor.campaign_id = $1 ORDER BY c.id`, campaignID,
		func(r pgx.Rows) (string, ConditionRow, error) {
			var id string
			var c ConditionRow
			err := r.Scan(&id, &c.ID, &c.ConditionID, &c.Stacks, &c.Source, &c.ExpiresOn, &c.ExpiresAfter)
			return id, c, err
		})
	if err != nil {
		return nil, err
	}
	// Every entry of the packs the room is served, whoever looks and whatever the entry's visibility: what a chosen
	// entry adds is in the number for every seat (house decision #61). A pack taken down, or a private one whose owner
	// no longer runs the room, stops adding (principle 4). The first entry per key wins, by pack slug, as in the served
	// lookup.
	chosen, err := byActor(ctx, conn, `SELECT c.actor_id::text, c.step_id, e.type, e.key, e.name, e.effects
		FROM actor_choice c JOIN actor ON actor.id = c.actor_id
		JOIN campaign_pack ON campaign_pack.campaign_id = actor.campaign_id
		JOIN pack_entry e ON e.pack_version_id = campaign_pack.pack_version_id AND e.key = c.option_key
		JOIN pack_version ON pack_version.id = e.pack_version_id JOIN pack ON pack.id = pack_version.pack_id
		WHERE actor.campaign_id = $1 AND `+ServedPacks("$1")+` ORDER BY c.actor_id, c.step_id, c.ordinal, pack.slug, e.key`, campaignID,
		func(r pgx.Rows) (string, ChosenEntry, error) {
			var id string
			var x ChosenEntry
			var effects []byte
			if err := r.Scan(&id, &x.StepID, &x.Type, &x.Key, &x.Name, &effects); err != nil {
				return "", x, err
			}
			return id, x, json.Unmarshal(effects, &x.Effects)
		})
	if err != nil {
		return nil, err
	}
	out := make([]Rows, len(actors))
	for i, a := range actors {
		out[i] = Rows{a, fields[a.ID], resources[a.ID], conditions[a.ID], chosen[a.ID]}
	}
	return out, nil
}

// Bounds are a resource's evaluated limits for one actor. Max is nil when there is no ceiling.
type Bounds struct {
	Min float64
	// Max is the resource's maximum as the table shows it, or nil when it has none.
	Max *float64
	// Uncapped is a resource declared `capped: false`: its value may run past Max, so nothing clamps it there.
	Uncapped bool
}

// Ceiling is what a write clamps to: Max, or nil when the value may pass it or there is none.
func (b Bounds) Ceiling() *float64 {
	if b.Uncapped {
		return nil
	}
	return b.Max
}

// Built is one actor as the engine and the snapshot read it.
type Built struct {
	Row Row
	// Entity is the ruleset's entity type, or "" when the actor has none (or none the pinned ruleset knows).
	Entity    string
	Fields    map[string]any
	Resources map[string]float64
	Derived   map[string]float64
	// Conditions holds the actor_condition rows in the order they were applied.
	Conditions []ConditionRow
	// Entries are the pack entries the actor chose in a choose step of the ruleset (house decision #61).
	Entries []engine.ActiveEntry
	// Bounds holds the resources whose bounds evaluate now.
	Bounds map[string]Bounds
	// State is the actor as the ops read it: values with the bounds evaluated now. A resource whose bounds can't be
	// evaluated yet is left out.
	State *engine.ActorState
	// Scope is the expression scope (effects applied), or nil when it can't be evaluated.
	Scope *engine.Record
	// Problem is why Scope is nil for an actor that has an entity: the expression error.
	Problem string
}

// A field's rows as one value. A declared type decides; an undeclared (engine-owned) field is read by its shape.
func fieldValue(def *engine.FieldDef, rows []FieldRow) any {
	if (def != nil && def.Type == "list") || (def == nil && len(rows) > 1) {
		sorted := slices.Clone(rows)
		sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Ordinal < sorted[j].Ordinal })
		out := make([]any, len(sorted))
		for i, r := range sorted {
			out[i] = ""
			if r.Text != nil {
				out[i] = *r.Text
			}
		}
		return out
	}
	if len(rows) == 0 {
		return nil
	}
	row := rows[0]
	kind := "text"
	switch {
	case def != nil:
		kind = def.Type
	case row.Int != nil:
		kind = "int"
	case row.Ref != nil:
		kind = "ref"
	}
	if row.Int == nil && row.Text == nil && row.Ref == nil {
		return nil
	}
	switch kind {
	case "bool":
		if row.Int == nil {
			return nil
		}
		return *row.Int == 1
	case "int":
		if row.Int == nil {
			return nil
		}
		return float64(*row.Int)
	case "ref":
		if row.Ref == nil {
			return nil
		}
		return *row.Ref
	}
	if row.Text == nil {
		return nil
	}
	return *row.Text // text, enum
}

func activeIDs(conditions []ConditionRow) []string {
	out := make([]string, len(conditions))
	for i, c := range conditions {
		out[i] = c.ConditionID
	}
	return out
}

// ChosenIn keeps the entries whose row belongs to a choose step of the ruleset that picks their type, once each. An
// entry the attached packs no longer hold was never loaded, so it adds nothing.
func ChosenIn(compiled *engine.CompiledRuleset, chosen []ChosenEntry) []engine.ActiveEntry {
	var out []engine.ActiveEntry
	seen := map[[2]string]bool{}
	for _, x := range chosen {
		step := slices.IndexFunc(compiled.Ruleset.Creation, func(s engine.CreationStep) bool {
			return s.ID == x.StepID && s.Kind == "choose" && s.Pick == x.Type
		})
		if step < 0 || len(x.Effects) == 0 || seen[[2]string{x.StepID, x.Key}] {
			continue
		}
		seen[[2]string{x.StepID, x.Key}] = true
		out = append(out, engine.ActiveEntry{Type: x.Type, Key: x.Key, Name: x.Name, Effects: x.Effects})
	}
	return out
}

// CountCharacters is `party.characters`: the active player characters at the table.
func CountCharacters(rows []Rows) float64 {
	n := 0.0
	for _, r := range rows {
		if r.Actor.Kind == "pc" && r.Actor.Status == "active" {
			n++
		}
	}
	return n
}

// Build reads each actor's rows into what the engine reads: fields, resources with their evaluated bounds, conditions,
// derived values. A half-built actor (a field an expression needs is not set yet) shows no derived values and no
// bounds; Problem says what is missing. campaign is the record in play (LoadCampaign), nil without a ruleset.
func Build(compiled *engine.CompiledRuleset, rows []Rows, campaign map[string]any) (map[string]*Built, error) {
	characters := CountCharacters(rows)
	out := make(map[string]*Built, len(rows))
	for _, r := range rows {
		var ce *engine.CompiledEntity
		if compiled != nil {
			ce = compiled.Entities[r.Actor.EntityType]
		}
		b := &Built{
			Row: r.Actor, Fields: map[string]any{}, Resources: map[string]float64{}, Derived: map[string]float64{},
			Conditions: []ConditionRow{}, Bounds: map[string]Bounds{},
		}
		out[r.Actor.ID] = b
		b.State = &engine.ActorState{ID: r.Actor.ID, Fields: b.Fields, Resources: []engine.NamedResource{}, Conditions: []engine.ConditionState{}}
		if ce == nil {
			continue
		}
		b.Entity = r.Actor.EntityType
		byField := map[string][]FieldRow{}
		for _, f := range r.Fields {
			byField[f.FieldID] = append(byField[f.FieldID], f)
		}
		for id, fs := range byField {
			var def *engine.FieldDef
			if d, ok := ce.Def.Fields[id]; ok {
				def = &d
			}
			b.Fields[id] = fieldValue(def, fs)
		}
		for _, x := range r.Resources {
			b.Resources[x.ResourceID] = float64(x.Value)
		}
		b.Conditions = append(b.Conditions, r.Conditions...)
		b.Entries = ChosenIn(compiled, r.Chosen)
		for _, c := range b.Conditions {
			var after *float64
			if c.ExpiresAfter != nil {
				n := float64(*c.ExpiresAfter)
				after = &n
			}
			b.State.Conditions = append(b.State.Conditions, engine.ConditionState{ID: c.ID, ExpiresOn: c.ExpiresOn, ExpiresAfter: after})
		}
		values := engine.ActorValues{
			Fields: b.Fields, Resources: b.Resources, Conditions: activeIDs(b.Conditions), Entries: b.Entries, Characters: characters, Campaign: campaign,
		}
		var exprErr engine.ExprError
		derived, err := compiled.DeriveValues(b.Entity, values)
		if errors.As(err, &exprErr) {
			b.Problem = exprErr.Message
			continue
		}
		if err != nil {
			return nil, err
		}
		fields, err := compiled.ApplyBaseEffects(b.Entity, values)
		if errors.As(err, &exprErr) {
			b.Problem = exprErr.Message
			continue
		}
		if err != nil {
			return nil, err
		}
		b.Derived = derived
		live := &engine.Record{Fields: make(map[string]any, len(derived))}
		for k, v := range derived {
			live.Fields[k] = v
		}
		b.Scope = engine.ActorScopeWith(fields, live, b.Resources, characters, campaign, nil)
		for _, x := range r.Resources {
			if !slices.Contains(ce.Resources, x.ResourceID) {
				continue
			}
			bounds, err := compiled.ResourceBounds(x.ResourceID, b.Scope)
			if errors.As(err, &exprErr) {
				continue
			}
			if err != nil {
				return nil, err
			}
			max := bounds.Max
			if x.MaxOverride != nil {
				m := math.Max(bounds.Min, float64(*x.MaxOverride))
				max = &m
			}
			held := Bounds{bounds.Min, max, !bounds.Capped}
			b.Bounds[x.ResourceID] = held
			reset, err := compiled.ResetValues(x.ResourceID, b.Scope)
			if errors.As(err, &exprErr) {
				continue
			}
			if err != nil {
				return nil, err
			}
			death, err := compiled.InstantDeathAt(x.ResourceID, b.Scope)
			if errors.As(err, &exprErr) {
				continue
			}
			if err != nil {
				return nil, err
			}
			b.State.Resources = append(b.State.Resources, engine.NamedResource{Name: x.ResourceID, State: engine.ResourceState{
				Value: float64(x.Value), Min: bounds.Min, Max: held.Ceiling(), Reset: reset, InstantDeathAt: death,
			}})
		}
	}
	return out, nil
}

// ToLive is the actor as the live snapshot carries it, before any seat's filter.
func ToLive(b *Built) cs.Actor {
	timers := make([]cs.ConditionTimer, len(b.Conditions))
	for i, c := range b.Conditions {
		var after *int
		if c.ExpiresAfter != nil {
			n := int(*c.ExpiresAfter)
			after = &n
		}
		timers[i] = cs.ConditionTimer{ID: c.ConditionID, ExpiresOn: c.ExpiresOn, ExpiresAfter: after}
	}
	return cs.Actor{
		ID: b.Row.ID, Kind: b.Row.Kind, Name: b.Row.Name, Status: b.Row.Status, OwnerUserID: b.Row.OwnerUserID,
		Entity: b.Entity, Fields: b.Fields, Resources: b.Resources, Derived: b.Derived,
		Conditions: activeIDs(b.Conditions), ConditionTimers: timers,
	}
}

// LoadDrafts is the room's builder drafts by user, decoded JSON: only those written under the ruleset pinned now.
func LoadDrafts(ctx context.Context, conn core.Conn, campaignID string) (map[string]any, error) {
	rows, err := conn.Query(ctx, `SELECT d.user_id, d.body FROM builder_draft d JOIN campaign ON campaign.id = d.campaign_id
		WHERE d.campaign_id = $1 AND d.ruleset_version_id = campaign.ruleset_version_id`, campaignID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]any{}
	for rows.Next() {
		var userID string
		var body any
		if err := rows.Scan(&userID, &body); err != nil {
			return nil, err
		}
		out[userID] = body
	}
	return out, rows.Err()
}
