package actor

import (
	"context"
	"encoding/json"
	"sort"

	"github.com/jackc/pgx/v5"

	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/campaign/eventlog"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/core"
	cs "github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/coreschema"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/encounter/turn"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/engine"
	"github.com/The-Inconsistent/InconsisTable/apps/api-go/internal/schema"
)

// The one place an actor's value rows are written (docs/design.md §5.4, apps/api/src/actor/actor.delta.ts). A delta goes
// in, the row before and after comes out (Postgres 18 RETURNING OLD/NEW), which is what the session log and undo are
// built on. Nothing else updates actor_resource, actor_field or actor_condition.

// conditionValue is the schema of a condition row as a delta value: one row of actor_condition (its id is the target).
var conditionValue = schema.Object(
	schema.Req("conditionId", schema.String()),
	schema.Req("stacks", schema.Int()),
	schema.Req("source", schema.String()),
	schema.Req("expiresOn", schema.Enum("ownTurnEnd", "roundEnd", "encounterEnd", "manual")),
	schema.Req("expiresAfter", schema.Nullable(schema.Int())),
)

// Write is one delta to write. Resources need the Bounds the caller evaluated; fields the declared (or inferred)
// FieldType, "" reading as text. The row must belong to CampaignID, so a client id
// never reaches another table.
type Write struct {
	CampaignID string
	Delta      engine.Delta
	Bounds     *Bounds
	FieldType  string
	// PoolScope is a pool's scope, copied from the manifest when its row is written.
	PoolScope string
}

// JSONValue turns an engine delta value into decoded JSON, the shape the log stores ([]string becomes []any).
func JSONValue(v any) any {
	if list, isList := v.([]string); isList {
		out := make([]any, len(list))
		for i, s := range list {
			out[i] = s
		}
		return out
	}
	return v
}

// DecodeField is a stored field row as the value a ruleset reads, as decoded JSON.
func DecodeField(fieldType string, i *int32, text, ref *string) any {
	if i == nil && text == nil && ref == nil {
		return nil
	}
	switch fieldType {
	case "bool":
		if i == nil {
			return nil
		}
		return *i == 1
	case "int":
		if i == nil {
			return nil
		}
		return float64(*i)
	case "ref":
		if ref == nil {
			return nil
		}
		return *ref
	}
	if text == nil {
		return nil // text, enum; a list is decoded from its rows
	}
	return *text
}

const mine = `a.id = $1::uuid AND a.campaign_id = $2::uuid`

// A resource row. `add` adds to the stored value, `set` replaces it; both clamp to the bounds in the same statement, so
// two taps at once never overwrite each other. A max below the min collapses to the min.
func writeResource(ctx context.Context, tx core.Conn, w Write) (eventlog.Written, error) {
	t := w.Delta.Target
	if !eventlog.IsWhole(w.Delta.Value) {
		return eventlog.Written{}, cs.Fail("wholeNumber", cs.Params{"what": t.Resource})
	}
	value := int64(w.Delta.Value.(float64))
	ceiling := w.Bounds.Ceiling()
	clamp := func(v string) string {
		floor := "GREATEST(" + v + ", $5::int)"
		if ceiling == nil {
			return floor
		}
		return "LEAST(" + floor + ", GREATEST($5::int, $6::int))"
	}
	update := clamp("$4::int")
	if w.Delta.Kind == "add" {
		update = clamp("r.value + $4::int")
	}
	args := []any{t.ActorID, w.CampaignID, t.Resource, value, int64(w.Bounds.Min)}
	if ceiling != nil {
		args = append(args, int64(*ceiling))
	}
	// The first value of a row that does not exist yet is the delta itself (from nothing).
	var before, after *int32
	err := tx.QueryRow(ctx, `INSERT INTO actor_resource AS r (actor_id, resource_id, value)
		SELECT a.id, $3::text, `+clamp("$4::int")+` FROM actor a WHERE `+mine+`
		ON CONFLICT (actor_id, resource_id) DO UPDATE SET value = `+update+`
		RETURNING OLD.value, NEW.value`, args...).Scan(&before, &after)
	if err == pgx.ErrNoRows {
		return eventlog.Written{}, cs.Fail("characterNotFound")
	}
	if err != nil {
		return eventlog.Written{}, err
	}
	return eventlog.Written{Target: t, Kind: w.Delta.Kind, Before: intValue(before), After: intValue(after)}, nil
}

// A shared pool: `add` only. A pool has no row until its first change, and then it starts from its minimum; the
// statement adds to the stored value and clamps, so two taps at once never overwrite each other.
func writePool(ctx context.Context, tx core.Conn, w Write) (eventlog.Written, error) {
	t := w.Delta.Target
	if w.Delta.Kind != "add" {
		return eventlog.Written{}, cs.Fail("cannotWrite")
	}
	if !eventlog.IsWhole(w.Delta.Value) {
		return eventlog.Written{}, cs.Fail("wholeNumber", cs.Params{"what": t.Pool})
	}
	ceiling := w.Bounds.Ceiling()
	clamp := func(v string) string {
		floor := "GREATEST(" + v + ", $5::int)"
		if ceiling == nil {
			return floor
		}
		return "LEAST(" + floor + ", GREATEST($5::int, $6::int))"
	}
	args := []any{w.CampaignID, w.PoolScope, t.Pool, int64(w.Delta.Value.(float64)), int64(w.Bounds.Min)}
	if ceiling != nil {
		args = append(args, int64(*ceiling))
	}
	var before, after int32
	err := tx.QueryRow(ctx, `INSERT INTO resource_pool AS r (campaign_id, scope, resource_id, value)
		VALUES ($1::uuid, $2::text, $3::text, `+clamp("$5::int + $4::int")+`)
		ON CONFLICT (campaign_id, scope, resource_id) DO UPDATE SET value = `+clamp("r.value + $4::int")+`
		RETURNING COALESCE(OLD.value, $5::int), NEW.value`, args...).Scan(&before, &after)
	if err != nil {
		return eventlog.Written{}, err
	}
	return eventlog.Written{Target: t, Kind: "add", Before: float64(before), After: float64(after)}, nil
}

func intValue(n *int32) any {
	if n == nil {
		return nil
	}
	return float64(*n)
}

type fieldRow struct {
	ordinal   int
	i         *int32
	text, ref *string
}

// A field. Scalars upsert one row (ordinal 0); a list replaces its rows. A null value unsets the field.
func writeField(ctx context.Context, tx core.Conn, w Write) (eventlog.Written, error) {
	t, kind := w.Delta.Target, w.FieldType
	if kind == "" {
		kind = "text"
	}
	if w.Delta.Kind != "set" {
		return eventlog.Written{}, cs.Fail("setNotAdjusted", cs.Params{"what": t.Field})
	}
	next := w.Delta.Value
	// An empty list is an unset field: it has no rows.
	list, isList := next.([]any)
	if isList && len(list) == 0 {
		next = nil
	}
	if kind == "list" && next != nil && !isList {
		return eventlog.Written{}, cs.Fail("takesList", cs.Params{"field": t.Field})
	}
	written := func(before, after any) eventlog.Written {
		return eventlog.Written{Target: t, Kind: "set", Before: before, After: after}
	}

	if next == nil || kind == "list" {
		rows, err := tx.Query(ctx, `DELETE FROM actor_field f USING actor a
			WHERE f.actor_id = a.id AND `+mine+` AND f.field_id = $3::text
			RETURNING f.ordinal, f.int_value, f.text_value, f.ref_key`, t.ActorID, w.CampaignID, t.Field)
		if err != nil {
			return eventlog.Written{}, err
		}
		removed, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (fieldRow, error) {
			var f fieldRow
			return f, r.Scan(&f.ordinal, &f.i, &f.text, &f.ref)
		})
		if err != nil {
			return eventlog.Written{}, err
		}
		sort.SliceStable(removed, func(i, j int) bool { return removed[i].ordinal < removed[j].ordinal })
		var before any
		switch {
		case kind == "list" && len(removed) > 0:
			items := make([]any, len(removed))
			for i, r := range removed {
				items[i] = ""
				if r.text != nil {
					items[i] = *r.text
				}
			}
			before = items
		case kind != "list" && len(removed) > 0:
			before = DecodeField(kind, removed[0].i, removed[0].text, removed[0].ref)
		}
		if next == nil || !isList {
			return written(before, nil), nil
		}
		raw, err := json.Marshal(list)
		if err != nil {
			return eventlog.Written{}, err
		}
		tag, err := tx.Exec(ctx, `INSERT INTO actor_field (actor_id, field_id, ordinal, text_value)
			SELECT a.id, $3::text, (u.ord - 1)::int, u.v FROM actor a,
				jsonb_array_elements_text($4::jsonb) WITH ORDINALITY AS u(v, ord)
			WHERE `+mine, t.ActorID, w.CampaignID, t.Field, string(raw))
		if err != nil {
			return eventlog.Written{}, err
		}
		if tag.RowsAffected() != int64(len(list)) {
			return eventlog.Written{}, cs.Fail("characterNotFound")
		}
		return written(before, next), nil
	}

	var i *int64
	var text, ref *string
	switch v := next.(type) {
	case bool:
		n := int64(0)
		if v {
			n = 1
		}
		i = &n
	case float64:
		n := int64(v)
		i = &n
	case string:
		if kind == "ref" {
			ref = &v
		} else {
			text = &v
		}
	}
	if i == nil && text == nil && ref == nil {
		return eventlog.Written{}, cs.Fail("badFieldValue", cs.Params{"field": t.Field})
	}
	var bi, ai *int32
	var bt, br, at, ar *string
	err := tx.QueryRow(ctx, `INSERT INTO actor_field AS f (actor_id, field_id, ordinal, int_value, text_value, ref_key)
		SELECT a.id, $3::text, 0, $4::int, $5::text, $6::text FROM actor a WHERE `+mine+`
		ON CONFLICT (actor_id, field_id, ordinal) DO UPDATE
			SET int_value = EXCLUDED.int_value, text_value = EXCLUDED.text_value, ref_key = EXCLUDED.ref_key
		RETURNING OLD.int_value, OLD.text_value, OLD.ref_key, NEW.int_value, NEW.text_value, NEW.ref_key`,
		t.ActorID, w.CampaignID, t.Field, i, text, ref).Scan(&bi, &bt, &br, &ai, &at, &ar)
	if err == pgx.ErrNoRows {
		return eventlog.Written{}, cs.Fail("characterNotFound")
	}
	if err != nil {
		return eventlog.Written{}, err
	}
	return written(DecodeField(kind, bi, bt, br), DecodeField(kind, ai, at, ar)), nil
}

// A returned condition row (nil when the row did not exist on that side) as the value the log keeps.
type conditionScan struct {
	conditionID, source, expiresOn *string
	stacks, expiresAfter           *int32
}

func (c *conditionScan) targets() []any {
	return []any{&c.conditionID, &c.stacks, &c.source, &c.expiresOn, &c.expiresAfter}
}

func (c *conditionScan) value() any {
	if c.stacks == nil {
		return nil
	}
	return map[string]any{
		"conditionId": *c.conditionID, "stacks": float64(*c.stacks), "source": *c.source, "expiresOn": *c.expiresOn,
		"expiresAfter": intValue(c.expiresAfter),
	}
}

const conditionOldNew = ` RETURNING OLD.condition_id, OLD.stacks, OLD.source, OLD.expires_on, OLD.expires_after,
	NEW.condition_id, NEW.stacks, NEW.source, NEW.expires_on, NEW.expires_after`

func scanOldNew(row pgx.Row) (before, after any, err error) {
	var b, a conditionScan
	if err := row.Scan(append(b.targets(), a.targets()...)...); err != nil {
		return nil, nil, err
	}
	return b.value(), a.value(), nil
}

// A condition row, named by its own id. `add` counts its expiresAfter (an uncounted row reads as 1, house decision
// #14); `set` with a row writes it whole (a new row, or putting a removed one back); `set` with null removes it.
func writeCondition(ctx context.Context, tx core.Conn, w Write) (eventlog.Written, error) {
	t := w.Delta.Target
	if _, issues := schema.Parse(schema.UUID(), t.Condition); len(issues) > 0 {
		return eventlog.Written{}, cs.Fail("notConditionHere")
	}
	out := func(before, after any) eventlog.Written {
		return eventlog.Written{Target: t, Kind: w.Delta.Kind, Before: before, After: after}
	}
	if w.Delta.Kind == "add" {
		if !eventlog.IsWhole(w.Delta.Value) {
			return eventlog.Written{}, cs.Fail("countWholeNumber")
		}
		before, after, err := scanOldNew(tx.QueryRow(ctx, `UPDATE actor_condition AS c
			SET expires_after = COALESCE(c.expires_after, 1) + $4::int
			FROM actor a WHERE c.id = $3::uuid AND c.actor_id = a.id AND `+mine+conditionOldNew,
			t.ActorID, w.CampaignID, t.Condition, int64(w.Delta.Value.(float64))))
		if err == pgx.ErrNoRows {
			return eventlog.Written{}, cs.Fail("conditionGone")
		}
		return out(before, after), err
	}
	if w.Delta.Value == nil {
		var b conditionScan
		err := tx.QueryRow(ctx, `DELETE FROM actor_condition AS c USING actor a
			WHERE c.id = $3::uuid AND c.actor_id = a.id AND `+mine+`
			RETURNING c.condition_id, c.stacks, c.source, c.expires_on, c.expires_after`,
			t.ActorID, w.CampaignID, t.Condition).Scan(b.targets()...)
		if err != nil && err != pgx.ErrNoRows {
			return eventlog.Written{}, err
		}
		return out(b.value(), nil), nil
	}
	parsed, issues := schema.Parse(conditionValue, w.Delta.Value)
	if len(issues) > 0 {
		return eventlog.Written{}, cs.Fail("notACondition")
	}
	c := parsed.(map[string]any)
	var after *int64
	if n, counted := c["expiresAfter"].(float64); counted {
		m := int64(n)
		after = &m
	}
	before, written, err := scanOldNew(tx.QueryRow(ctx, `INSERT INTO actor_condition AS c
			(id, actor_id, condition_id, stacks, source, expires_on, expires_after)
		SELECT $3::uuid, a.id, $4::text, $5::int, $6::text, $7::text, $8::int FROM actor a WHERE `+mine+`
		ON CONFLICT (id) DO UPDATE
			SET stacks = EXCLUDED.stacks, source = EXCLUDED.source, expires_on = EXCLUDED.expires_on,
				expires_after = EXCLUDED.expires_after
			WHERE c.actor_id = EXCLUDED.actor_id AND c.condition_id = EXCLUDED.condition_id`+conditionOldNew,
		t.ActorID, w.CampaignID, t.Condition, c["conditionId"], int64(c["stacks"].(float64)), c["source"], c["expiresOn"], after))
	if err == pgx.ErrNoRows {
		return eventlog.Written{}, cs.Fail("characterNotFound")
	}
	return out(before, written), err
}

// WriteDelta writes one delta and says what it changed.
func WriteDelta(ctx context.Context, tx core.Conn, w Write) (eventlog.Written, error) {
	w.Delta.Value = JSONValue(w.Delta.Value)
	t := w.Delta.Target
	switch {
	case t.Item != "":
		return writeItem(ctx, tx, w)
	case t.Pool != "":
		if w.Bounds == nil || w.PoolScope == "" {
			return eventlog.Written{}, cs.Fail("noBounds", cs.Params{"resource": t.Pool})
		}
		return writePool(ctx, tx, w)
	case t.Resource != "":
		if w.Bounds == nil {
			return eventlog.Written{}, cs.Fail("noBounds", cs.Params{"resource": t.Resource})
		}
		return writeResource(ctx, tx, w)
	case t.Field != "":
		return writeField(ctx, tx, w)
	case t.Condition != "":
		return writeCondition(ctx, tx, w)
	case t.Turn != "":
		// The round and whose turn it is live on the encounter row; they are `set` like any field, so they log and undo.
		if w.Delta.Kind != "set" {
			return eventlog.Written{}, cs.Fail("turnSetNotAdjusted", cs.Params{"turn": t.Turn})
		}
		before, after, err := turn.Write(ctx, tx, w.CampaignID, t.Turn, w.Delta.Value)
		return eventlog.Written{Target: t, Kind: "set", Before: before, After: after}, err
	}
	// ponytail: Test values live in test_call; no op writes them as deltas yet, so one that tries is refused here.
	return eventlog.Written{}, cs.Fail("cannotWrite")
}

// ReadTarget is the value a target holds now, as decoded JSON, for undo to compare with what a delta left behind.
// Resources are never compared.
func ReadTarget(ctx context.Context, tx core.Conn, campaignID string, t engine.DeltaTarget, fieldType string) (any, error) {
	switch {
	case t.Item != "":
		return ItemValue(ctx, tx, campaignID, t.Item)
	case t.Condition != "":
		var c conditionScan
		err := tx.QueryRow(ctx, `SELECT c.condition_id, c.stacks, c.source, c.expires_on, c.expires_after
			FROM actor_condition c JOIN actor a ON a.id = c.actor_id WHERE `+mine+` AND c.id = $3::uuid`,
			t.ActorID, campaignID, t.Condition).Scan(c.targets()...)
		if err != nil && err != pgx.ErrNoRows {
			return nil, err
		}
		return c.value(), nil
	case t.Turn != "":
		return turn.Read(ctx, tx, campaignID, t.Turn)
	case t.Field == "":
		return nil, cs.Fail("cannotRead")
	}
	if fieldType == "" {
		fieldType = "text"
	}
	rows, err := tx.Query(ctx, `SELECT f.ordinal, f.int_value, f.text_value, f.ref_key
		FROM actor_field f JOIN actor a ON a.id = f.actor_id WHERE `+mine+` AND f.field_id = $3::text
		ORDER BY f.ordinal`, t.ActorID, campaignID, t.Field)
	if err != nil {
		return nil, err
	}
	found, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (fieldRow, error) {
		var f fieldRow
		return f, r.Scan(&f.ordinal, &f.i, &f.text, &f.ref)
	})
	if err != nil || len(found) == 0 {
		return nil, err
	}
	if fieldType == "list" {
		items := make([]any, len(found))
		for i, r := range found {
			items[i] = ""
			if r.text != nil {
				items[i] = *r.text
			}
		}
		return items, nil
	}
	return DecodeField(fieldType, found[0].i, found[0].text, found[0].ref), nil
}
